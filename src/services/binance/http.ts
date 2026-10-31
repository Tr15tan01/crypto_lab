import { MarketUnavailableError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Low-level HTTP client for Binance public market-data endpoints.
 *
 * - Request timeout via AbortController.
 * - Retries network errors and 5xx responses with exponential backoff + jitter.
 * - Honours HTTP 429 / 418 (rate limited / IP banned) and the `Retry-After` header by pausing
 *   all requests until the ban expires, instead of hammering the API.
 * - Watches `X-MBX-USED-WEIGHT-1M` and backs off before the 6000/min weight limit is reached.
 * - Never exposes upstream error bodies to callers; they get a MarketUnavailableError.
 */
export interface BinanceHttpOptions {
  baseUrl: string;
  timeoutMs: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const WEIGHT_SOFT_LIMIT = 5000;

export class BinanceHttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "BinanceHttpError";
  }
}

export class BinanceHttpClient {
  private pausedUntil = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly maxRetries: number;
  lastUsedWeight: number | null = null;

  constructor(private readonly options: BinanceHttpOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = options.now ?? Date.now;
    this.maxRetries = options.maxRetries ?? 2;
  }

  get isPaused(): boolean {
    return this.now() < this.pausedUntil;
  }

  get pausedUntilMs(): number {
    return this.pausedUntil;
  }

  private pause(ms: number, reason: string) {
    const until = this.now() + ms;
    if (until > this.pausedUntil) {
      this.pausedUntil = until;
      logger.warn("binance.paused", { reason, seconds: Math.round(ms / 1000) });
    }
  }

  async getJson(path: string, params: Record<string, string | number | undefined> = {}): Promise<unknown> {
    if (this.isPaused) {
      throw new MarketUnavailableError("Binance requests are paused because of rate limits. Showing cached data.");
    }

    const url = new URL(path, this.options.baseUrl);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const backoff = Math.min(4000, 300 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 200);
        await this.sleep(backoff);
      }
      try {
        return await this.request(url);
      } catch (err) {
        lastError = err;
        if (!(err instanceof BinanceHttpError) || !err.retryable) break;
      }
    }

    const status = lastError instanceof BinanceHttpError ? lastError.status : null;
    logger.warn("binance.request_failed", { path, status, error: lastError });
    throw new MarketUnavailableError(undefined, lastError);
  }

  private async request(url: URL): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
    } catch (err) {
      const timedOut = controller.signal.aborted;
      throw new BinanceHttpError(timedOut ? "timeout" : `network: ${(err as Error)?.message ?? "error"}`, null, true);
    } finally {
      clearTimeout(timer);
    }

    const weight = Number(res.headers.get("x-mbx-used-weight-1m"));
    if (Number.isFinite(weight) && weight > 0) {
      this.lastUsedWeight = weight;
      if (weight >= WEIGHT_SOFT_LIMIT) {
        const msToNextMinute = 60_000 - (this.now() % 60_000) + 1000;
        this.pause(msToNextMinute, "weight_soft_limit");
      }
    }

    if (res.status === 429 || res.status === 418) {
      const retryAfter = Number(res.headers.get("retry-after"));
      this.pause((Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60) * 1000, `http_${res.status}`);
      throw new BinanceHttpError(`rate limited (${res.status})`, res.status, false);
    }
    if (res.status === 451) {
      throw new BinanceHttpError("unavailable for legal reasons (region blocked) — check BINANCE_API_BASE", 451, false);
    }
    if (res.status >= 500) throw new BinanceHttpError(`server error ${res.status}`, res.status, true);
    if (!res.ok) throw new BinanceHttpError(`http ${res.status}`, res.status, false);

    try {
      return await res.json();
    } catch {
      throw new BinanceHttpError("invalid JSON", res.status, true);
    }
  }
}
