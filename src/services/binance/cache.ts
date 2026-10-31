/**
 * Market-data cache with "serve stale on failure" semantics.
 *
 * Layer 1: in-process memory (fast, per serverless instance).
 * Layer 2 (optional): a persistent store (MongoDB) so a cold instance can still show the
 *          last successfully retrieved data while Binance is unreachable.
 *
 * A result always says when its data was fetched and whether it is stale. Stale data is
 * only returned when a live refresh failed; it is never presented as live.
 */
export interface MarketResult<T> {
  data: T;
  fetchedAt: number;
  stale: boolean;
  source: "live" | "memory" | "persisted";
}

export interface PersistentStore {
  read(key: string): Promise<{ data: unknown; fetchedAt: number } | null>;
  write(key: string, data: unknown, fetchedAt: number): Promise<void>;
}

interface Entry {
  data: unknown;
  fetchedAt: number;
}

export class MarketCache {
  private readonly memory = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<MarketResult<unknown>>>();
  private readonly lastPersistAt = new Map<string, number>();

  constructor(
    private readonly store: PersistentStore | null,
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 500,
  ) {}

  async get<T>(
    key: string,
    ttlSeconds: number,
    fetcher: () => Promise<T>,
    options: { persist?: boolean; persistEverySeconds?: number } = {},
  ): Promise<MarketResult<T>> {
    const hit = this.memory.get(key);
    if (hit && this.now() - hit.fetchedAt < ttlSeconds * 1000) {
      return { data: hit.data as T, fetchedAt: hit.fetchedAt, stale: false, source: "memory" };
    }

    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<MarketResult<T>>;

    const promise = this.refresh(key, fetcher, options).finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise as Promise<MarketResult<unknown>>);
    return promise;
  }

  private async refresh<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: { persist?: boolean; persistEverySeconds?: number },
  ): Promise<MarketResult<T>> {
    try {
      const data = await fetcher();
      const fetchedAt = this.now();
      this.set(key, data, fetchedAt);
      if (options.persist && this.store) {
        const last = this.lastPersistAt.get(key) ?? 0;
        if (fetchedAt - last >= (options.persistEverySeconds ?? 60) * 1000) {
          this.lastPersistAt.set(key, fetchedAt);
          this.store.write(key, data, fetchedAt).catch(() => {
            /* persistence is best-effort */
          });
        }
      }
      return { data, fetchedAt, stale: false, source: "live" };
    } catch (err) {
      const hit = this.memory.get(key);
      if (hit) return { data: hit.data as T, fetchedAt: hit.fetchedAt, stale: true, source: "memory" };
      if (options.persist && this.store) {
        const persisted = await this.store.read(key).catch(() => null);
        if (persisted) {
          this.set(key, persisted.data, persisted.fetchedAt);
          return { data: persisted.data as T, fetchedAt: persisted.fetchedAt, stale: true, source: "persisted" };
        }
      }
      throw err;
    }
  }

  private set(key: string, data: unknown, fetchedAt: number) {
    if (this.memory.size >= this.maxEntries && !this.memory.has(key)) {
      const oldest = this.memory.keys().next().value;
      if (oldest !== undefined) this.memory.delete(oldest);
    }
    this.memory.delete(key);
    this.memory.set(key, { data, fetchedAt });
  }

  /** For tests and diagnostics. */
  peek(key: string): Entry | undefined {
    return this.memory.get(key);
  }
}
