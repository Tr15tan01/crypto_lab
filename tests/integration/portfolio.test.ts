/**
 * Integration tests for the paper-trading engine and its API routes against a real MongoDB.
 *
 * They need a MongoDB that supports transactions (Atlas, or a local replica set):
 *   TEST_MONGODB_URI="mongodb+srv://…" npm run test:integration
 * A throw-away database named crypto_lab_test_<random> is created and dropped afterwards.
 * Without TEST_MONGODB_URI the suite is skipped.
 *
 * Binance is replaced by a deterministic stub so results are exact; nothing here calls the network.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { MarketTicker } from "@/services/binance/market-data";

const URI = process.env.TEST_MONGODB_URI;
const USER = { id: "000000000000000000000001", email: "admin@example.com" };

const market = {
  price: 100,
  stale: false,
  tradable: true,
};

function ticker(symbol = "SOLUSDT"): MarketTicker {
  return {
    symbol,
    baseAsset: symbol.replace("USDT", ""),
    quoteAsset: "USDT",
    name: null,
    price: market.price,
    priceChange: 0,
    priceChangePercent: 0,
    open: market.price,
    high: market.price,
    low: market.price,
    weightedAvgPrice: market.price,
    volume: 1,
    quoteVolume: 1,
    tradeCount: 1,
    openTime: 0,
    closeTime: 1,
  };
}

vi.mock("@/services/binance", () => {
  const md = {
    ticker: async (symbol: string) => ({ data: ticker(symbol), fetchedAt: Date.now(), stale: market.stale, source: "live" }),
    symbolInfo: async (symbol: string) => ({
      data: { symbol, baseAsset: symbol.replace("USDT", ""), quoteAsset: "USDT", status: "TRADING", tradable: market.tradable },
      fetchedAt: Date.now(),
      stale: false,
      source: "live",
    }),
    prices: async (symbols: string[]) => ({
      data: new Map(symbols.map((s) => [s, market.price])),
      fetchedAt: Date.now(),
      stale: market.stale,
      source: "live",
    }),
    symbolMap: async () => ({ data: new Map(), fetchedAt: Date.now(), stale: false, source: "live" }),
  };
  return { marketData: () => md, normalizeSymbol: (s: string) => s.toUpperCase() };
});

vi.mock("@/lib/auth/session", () => ({
  requireApiUser: async () => USER,
  requireUser: async () => USER,
  getSessionUser: async () => USER,
}));

const suite = URI ? describe : describe.skip;

suite("paper trading against MongoDB", () => {
  let svc: typeof import("@/services/portfolio/portfolio-service");
  let getCollections: typeof import("@/lib/mongodb/collections").getCollections;
  const key = () => `test-${crypto.randomUUID()}`;

  beforeAll(async () => {
    process.env.MONGODB_URI = URI;
    process.env.MONGODB_DB = `crypto_lab_test_${Math.random().toString(36).slice(2, 8)}`;
    svc = await import("@/services/portfolio/portfolio-service");
    ({ getCollections } = await import("@/lib/mongodb/collections"));
  });

  beforeEach(async () => {
    market.price = 100;
    market.stale = false;
    market.tradable = true;
    const c = await getCollections();
    await Promise.all([
      c.portfolios.deleteMany({}),
      c.holdings.deleteMany({}),
      c.transactions.deleteMany({}),
      c.decisionJournal.deleteMany({}),
      c.portfolioSnapshots.deleteMany({}),
      c.marketSnapshots.deleteMany({}),
      c.rateLimits.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    if (!getCollections) return;
    const { getDb, getMongoClient } = await import("@/lib/mongodb/client");
    await (await getDb()).dropDatabase();
    await (await getMongoClient()).close();
  });

  it("creates a default $1,000 portfolio", async () => {
    const p = await svc.getActivePortfolio(USER.id);
    expect(p.initialBalance).toBe(1000);
    expect(p.availableBalance).toBe(1000);
    expect(p.feeConfiguration).toEqual({ enabled: true, ratePercent: 0.1 });
  });

  it("buys, records journal + market snapshot, and replays idempotently", async () => {
    const k = key();
    const first = await svc.executeBuy(USER.id, { symbol: "SOLUSDT", quoteAmount: 200, idempotencyKey: k, journal: { thesis: "test thesis" } });
    expect(first.replayed).toBe(false);
    expect(first.transaction).toMatchObject({ quantity: 2, fee: 0.2, total: 200.2, executionStatus: "NOT_EXECUTED" });

    const again = await svc.executeBuy(USER.id, { symbol: "SOLUSDT", quoteAmount: 200, idempotencyKey: k });
    expect(again.replayed).toBe(true);
    expect(again.transaction._id.toString()).toBe(first.transaction._id.toString());

    const c = await getCollections();
    expect(await c.transactions.countDocuments()).toBe(1);
    expect(await c.decisionJournal.countDocuments({ thesis: "test thesis" })).toBe(1);
    expect(await c.marketSnapshots.countDocuments({ reason: "trade" })).toBe(1);
    const p = await svc.getActivePortfolio(USER.id);
    expect(p.availableBalance).toBeCloseTo(799.8, 8);
  });

  it("allows only one of several concurrent submissions with the same key", async () => {
    const k = key();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => svc.executeBuy(USER.id, { symbol: "SOLUSDT", quoteAmount: 50, idempotencyKey: k })),
    );
    const ids = new Set(results.map((r) => r.transaction._id.toString()));
    expect(ids.size).toBe(1);
    const c = await getCollections();
    expect(await c.transactions.countDocuments()).toBe(1);
  });

  it("keeps the balance consistent under concurrent different orders", async () => {
    await Promise.all(
      Array.from({ length: 5 }, () => svc.executeBuy(USER.id, { symbol: "SOLUSDT", quoteAmount: 100, idempotencyKey: key() })),
    );
    const p = await svc.getActivePortfolio(USER.id);
    const h = await svc.getHolding(USER.id, "SOLUSDT");
    expect(p.availableBalance).toBeCloseTo(1000 - 5 * 100.1, 6);
    expect(h?.quantity).toBeCloseTo(5, 10);
  });

  it("rejects orders larger than the available cash without recording anything", async () => {
    await expect(svc.executeBuy(USER.id, { symbol: "SOLUSDT", quoteAmount: 1000, idempotencyKey: key() })).rejects.toMatchObject({
      code: "INSUFFICIENT_FUNDS",
    });
    const c = await getCollections();
    expect(await c.transactions.countDocuments()).toBe(0);
    expect((await svc.getActivePortfolio(USER.id)).availableBalance).toBe(1000);
  });

  it("sells partially at a profit using average cost", async () => {
    await svc.executeBuy(USER.id, { symbol: "SOLUSDT", quoteAmount: 500, idempotencyKey: key() });
    market.price = 120;
    const r = await svc.executeSell(USER.id, { symbol: "SOLUSDT", quantity: 2, idempotencyKey: key() });
    // 5 units cost 500.5 → avg 100.1; sell 2 @120: gross 240, fee 0.24, proceeds 239.76, basis 200.2
    expect(r.transaction.realizedPnL).toBeCloseTo(39.56, 8);
    const h = await svc.getHolding(USER.id, "SOLUSDT");
    expect(h?.quantity).toBeCloseTo(3, 10);
    expect(h?.averageCost).toBeCloseTo(100.1, 10);
    const p = await svc.getActivePortfolio(USER.id);
    expect(p.realizedPnL).toBeCloseTo(39.56, 8);
  });

  it("requires explicit acknowledgement to trade on stale prices", async () => {
    market.stale = true;
    await expect(svc.executeBuy(USER.id, { symbol: "SOLUSDT", quoteAmount: 10, idempotencyKey: key() })).rejects.toMatchObject({
      code: "STALE_DATA",
    });
    const ok = await svc.executeBuy(USER.id, { symbol: "SOLUSDT", quoteAmount: 10, idempotencyKey: key(), acknowledgeStale: true });
    expect(ok.transaction.priceWasStale).toBe(true);
  });

  it("asks for re-confirmation when the price moved since the quote", async () => {
    market.price = 110;
    await expect(
      svc.executeBuy(USER.id, { symbol: "SOLUSDT", quoteAmount: 10, idempotencyKey: key(), expectedPrice: 100 }),
    ).rejects.toMatchObject({ code: "PRICE_CHANGED" });
  });

  it("records real-world execution status as an append-only history", async () => {
    const { transaction } = await svc.executeBuy(USER.id, { symbol: "SOLUSDT", quoteAmount: 10, idempotencyKey: key() });
    const updated = await svc.updateExecutionStatus(USER.id, transaction._id.toString(), {
      status: "EXECUTED",
      details: { price: 100.5, quantity: 0.0995, fee: 0.01, orderReference: "123" },
    });
    expect(updated.executionStatus).toBe("EXECUTED");
    expect(updated.executionHistory.map((h) => h.status)).toEqual(["NOT_EXECUTED", "EXECUTED"]);
    expect(updated.price).toBe(100); // simulated record untouched
  });

  it("archives the old portfolio on reset", async () => {
    await svc.executeBuy(USER.id, { symbol: "SOLUSDT", quoteAmount: 10, idempotencyKey: key() });
    await svc.resetPortfolio(USER.id, { initialBalance: 5000, quoteAsset: "USDT", feeEnabled: false, feeRatePercent: 0 });
    const c = await getCollections();
    expect(await c.portfolios.countDocuments({ status: "archived" })).toBe(1);
    expect(await c.transactions.countDocuments()).toBe(1);
    const p = await svc.getActivePortfolio(USER.id);
    expect(p.initialBalance).toBe(5000);
  });

  describe("API routes", () => {
    const post = (path: string, body: unknown, origin = "http://localhost:3000") =>
      new NextRequest(`http://localhost:3000${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin, host: "localhost:3000" },
        body: JSON.stringify(body),
      });

    it("POST /api/portfolio/buy validates, executes and returns the transaction", async () => {
      vi.doMock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
      const { POST } = await import("@/app/api/portfolio/buy/route");
      const ctx = { params: Promise.resolve({}) };

      const bad = await POST(post("/api/portfolio/buy", { symbol: "SOLUSDT", quoteAmount: -1, idempotencyKey: key() }), ctx);
      expect(bad.status).toBe(400);

      const res = await POST(post("/api/portfolio/buy", { symbol: "SOLUSDT", quoteAmount: 100, idempotencyKey: key() }), ctx);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { data: { transaction: { total: number } } };
      expect(json.data.transaction.total).toBeCloseTo(100.1, 8);
    });

    it("rejects cross-site requests", async () => {
      const { POST } = await import("@/app/api/portfolio/buy/route");
      const res = await POST(
        post("/api/portfolio/buy", { symbol: "SOLUSDT", quoteAmount: 10, idempotencyKey: key() }, "https://evil.example"),
        { params: Promise.resolve({}) },
      );
      expect(res.status).toBe(403);
    });
  });
});

if (!URI) {
  describe("paper trading against MongoDB", () => {
    it.skip("set TEST_MONGODB_URI to run the integration suite", () => {});
  });
}
