import { describe, expect, it, vi } from "vitest";
import { BinanceHttpClient } from "@/services/binance/http";
import { MarketCache, type PersistentStore } from "@/services/binance/cache";
import { BinanceMarketData } from "@/services/binance/market-data";
import { MarketUnavailableError } from "@/lib/errors";

const noSleep = () => Promise.resolve();

function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

const EXCHANGE_INFO = {
  serverTime: 1,
  symbols: [
    { symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT", isSpotTradingAllowed: true },
    { symbol: "ETHUSDT", status: "TRADING", baseAsset: "ETH", quoteAsset: "USDT", isSpotTradingAllowed: true },
    { symbol: "OLDUSDT", status: "BREAK", baseAsset: "OLD", quoteAsset: "USDT", isSpotTradingAllowed: false },
  ],
};

const ticker = (symbol: string, lastPrice: string) => ({
  symbol,
  priceChange: "1",
  priceChangePercent: "2.5",
  weightedAvgPrice: lastPrice,
  openPrice: lastPrice,
  highPrice: lastPrice,
  lowPrice: lastPrice,
  lastPrice,
  volume: "10",
  quoteVolume: "1000",
  openTime: 0,
  closeTime: 1,
  count: 5,
});

function router(handlers: Record<string, () => Response | Promise<Response>>) {
  return vi.fn(async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    const key = url.pathname + (url.searchParams.get("symbol") ? `?${url.searchParams.get("symbol")}` : "");
    const h = handlers[key] ?? handlers[url.pathname];
    if (!h) throw new Error(`unexpected ${key}`);
    return h();
  });
}

describe("BinanceHttpClient", () => {
  it("retries transient 5xx errors with backoff", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => (++calls < 3 ? json({}, { status: 503 }) : json({ ok: true })));
    const c = new BinanceHttpClient({ baseUrl: "https://x.test", timeoutMs: 1000, fetchImpl, sleep: noSleep });
    await expect(c.getJson("/api/v3/ping")).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not retry 4xx and raises a safe error", async () => {
    const fetchImpl = vi.fn(async () => json({ msg: "secret upstream detail" }, { status: 400 }));
    const c = new BinanceHttpClient({ baseUrl: "https://x.test", timeoutMs: 1000, fetchImpl, sleep: noSleep });
    const err = (await c.getJson("/x").catch((e: unknown) => e)) as MarketUnavailableError;
    expect(err).toBeInstanceOf(MarketUnavailableError);
    expect(err.publicMessage).not.toContain("secret");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("pauses all requests after HTTP 429 using Retry-After", async () => {
    let now = 1_000_000;
    const fetchImpl = vi.fn(async () => json({}, { status: 429, headers: { "retry-after": "30" } }));
    const c = new BinanceHttpClient({ baseUrl: "https://x.test", timeoutMs: 1000, fetchImpl, sleep: noSleep, now: () => now });
    await expect(c.getJson("/x")).rejects.toBeInstanceOf(MarketUnavailableError);
    expect(c.isPaused).toBe(true);
    await expect(c.getJson("/x")).rejects.toBeInstanceOf(MarketUnavailableError);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // second call never hit the network
    now += 31_000;
    expect(c.isPaused).toBe(false);
  });

  it("backs off when used weight approaches the limit", async () => {
    const fetchImpl = vi.fn(async () => json({ ok: 1 }, { headers: { "x-mbx-used-weight-1m": "5500" } }));
    const c = new BinanceHttpClient({ baseUrl: "https://x.test", timeoutMs: 1000, fetchImpl, sleep: noSleep });
    await c.getJson("/x");
    expect(c.isPaused).toBe(true);
  });
});

describe("MarketCache", () => {
  it("serves fresh entries from memory and dedupes in-flight requests", async () => {
    const cache = new MarketCache(null);
    const fetcher = vi.fn(async () => 42);
    const [a, b] = await Promise.all([cache.get("k", 60, fetcher), cache.get("k", 60, fetcher)]);
    expect(a.data).toBe(42);
    expect(b.data).toBe(42);
    const c = await cache.get("k", 60, fetcher);
    expect(c.source).toBe("memory");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns stale data (flagged) when a refresh fails", async () => {
    let now = 0;
    const cache = new MarketCache(null, () => now);
    await cache.get("k", 10, async () => "v1");
    now = 20_000;
    const r = await cache.get("k", 10, async () => {
      throw new Error("down");
    });
    expect(r).toMatchObject({ data: "v1", stale: true, fetchedAt: 0 });
  });

  it("falls back to the persistent store on a cold start", async () => {
    const store: PersistentStore = {
      read: vi.fn(async () => ({ data: "persisted", fetchedAt: 5 })),
      write: vi.fn(async () => undefined),
    };
    const cache = new MarketCache(store);
    const r = await cache.get("k", 10, async () => Promise.reject(new Error("down")), { persist: true });
    expect(r).toMatchObject({ data: "persisted", stale: true, source: "persisted" });
  });

  it("throws when there is no data at all (never invents values)", async () => {
    const cache = new MarketCache(null);
    await expect(cache.get("k", 10, async () => Promise.reject(new Error("down")))).rejects.toThrow("down");
  });
});

describe("BinanceMarketData", () => {
  function setup(handlers: Record<string, () => Response | Promise<Response>>) {
    const fetchImpl = router(handlers);
    const http = new BinanceHttpClient({ baseUrl: "https://x.test", timeoutMs: 1000, fetchImpl, sleep: noSleep, maxRetries: 0 });
    return { md: new BinanceMarketData(http, new MarketCache(null), { tickerTtlSeconds: 20 }), fetchImpl };
  }

  it("lists only tradable pairs and skips invalid or zero-price tickers", async () => {
    const { md } = setup({
      "/api/v3/exchangeInfo": () => json(EXCHANGE_INFO),
      "/api/v3/ticker/24hr": () =>
        json([
          ticker("BTCUSDT", "60000"),
          ticker("ETHUSDT", "0"),
          { ...ticker("OLDUSDT", "1") },
          { ...ticker("BTCUSDT", "abc"), symbol: "BADUSDT" },
        ]),
    });
    const res = await md.allTickers();
    expect(res.data.map((t) => t.symbol)).toEqual(["BTCUSDT"]);
    expect(res.data[0]).toMatchObject({ price: 60000, name: "Bitcoin", baseAsset: "BTC" });
    expect(res.stale).toBe(false);
  });

  it("reports listing status for delisted and unknown pairs", async () => {
    const { md } = setup({ "/api/v3/exchangeInfo": () => json(EXCHANGE_INFO) });
    expect((await md.symbolInfo("OLDUSDT")).data).toMatchObject({ tradable: false, status: "BREAK" });
    expect((await md.symbolInfo("NOPEUSDT")).data).toBeNull();
  });

  it("paginates klines backwards and returns them in time order", async () => {
    const day = 86_400_000;
    const now = Date.now();
    let call = 0;
    const page = (count: number, endOpen: number) =>
      Array.from({ length: count }, (_, i) => {
        const t = endOpen - (count - 1 - i) * day;
        return [t, "1", "2", "0.5", "1.5", "10", t + day - 1, "15", 3, "0", "0", "0"];
      });
    const { md } = setup({
      "/api/v3/klines": () => {
        call++;
        if (call === 1) return json(page(1000, now));
        return json(page(500, now - 1000 * day));
      },
    });
    const res = await md.klines("BTCUSDT", "1d", "all");
    expect(res.data.length).toBe(1500);
    expect(res.data[0]!.openTime).toBeLessThan(res.data[1499]!.openTime);
    expect(new Set(res.data.map((k) => k.openTime)).size).toBe(1500);
  });

  it("rejects interval/period combinations that would be too large", async () => {
    const { md } = setup({});
    await expect(md.klines("BTCUSDT", "1m", "1y")).rejects.toThrow(/not available/);
  });

  it("marks the status as stale after a failure following success", async () => {
    let fail = false;
    const { md } = setup({
      "/api/v3/exchangeInfo": () => json(EXCHANGE_INFO),
      "/api/v3/ticker/24hr": () => (fail ? json({}, { status: 503 }) : json([ticker("BTCUSDT", "1")])),
    });
    await md.allTickers();
    expect(md.status().state).toBe("live");
    fail = true;
    // force a refresh by using a new cache window
    (md as unknown as { cache: MarketCache }).cache = new MarketCache(null);
    await expect(md.allTickers()).rejects.toBeInstanceOf(MarketUnavailableError);
    expect(md.status().state).toBe("stale");
  });
});
