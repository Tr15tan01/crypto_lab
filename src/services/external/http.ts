import "server-only";
import { MarketUnavailableError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { mongoStore } from "@/services/binance";
import { MarketCache } from "@/services/binance/cache";

/**
 * Minimal JSON client for the optional third-party data sources (Binance futures data,
 * binance.com copy-trading pages, Fear & Greed). One retry on network errors and 5xx; every
 * failure becomes a MarketUnavailableError so callers can degrade gracefully.
 */
export class ExternalHttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "ExternalHttpError";
  }
}

export async function fetchJson(
  url: string,
  /** `quiet`: an expected failure (e.g. "no perpetual for this pair") that should not be logged. */
  opts: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number; retries?: number; quiet?: boolean } = {},
): Promise<unknown> {
  const retries = opts.retries ?? 1;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400 + Math.random() * 300));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        signal: controller.signal,
        cache: "no-store",
        headers: {
          Accept: "application/json",
          ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
          // Some endpoints reject requests without a browser-like agent.
          "User-Agent": "Mozilla/5.0 (compatible; crypto-lab)",
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      if (res.status >= 500) {
        lastError = new ExternalHttpError(`server error ${res.status}`, res.status);
        continue;
      }
      if (!res.ok) throw new ExternalHttpError(`http ${res.status}`, res.status);
      return await res.json();
    } catch (err) {
      lastError = err;
      if (err instanceof ExternalHttpError) break;
    } finally {
      clearTimeout(timer);
    }
  }
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return "unknown";
    }
  })();
  if (!opts.quiet) logger.warn("external.request_failed", { host, error: lastError });
  throw new MarketUnavailableError(`Data source ${host} is unavailable right now.`, lastError);
}

const globalForExternal = globalThis as unknown as { __cryptoLabExternalCache?: MarketCache };

/** Shared cache for the optional sources; last good copies are persisted like market data. */
export function externalCache(): MarketCache {
  globalForExternal.__cryptoLabExternalCache ??= new MarketCache(mongoStore, Date.now, 800);
  return globalForExternal.__cryptoLabExternalCache;
}
