import { describe, expect, it } from "vitest";
import { scenarioImpact, valuePortfolio, type PriceQuote } from "@/services/portfolio/valuation";

const now = Date.now();
const live = (price: number): PriceQuote => ({ price, asOf: now, live: true });

const holdings = [
  { symbol: "BTCUSDT", baseAsset: "BTC", quantity: 0.01, averageCost: 50000, investedValue: 500, realizedPnL: 0 },
  { symbol: "ETHUSDT", baseAsset: "ETH", quantity: 0.2, averageCost: 2000, investedValue: 400, realizedPnL: 10 },
];

describe("valuePortfolio", () => {
  it("values positions and totals", () => {
    const v = valuePortfolio({
      cash: 100,
      initialBalance: 1000,
      realizedPnL: 10,
      holdings,
      prices: new Map([
        ["BTCUSDT", live(60000)],
        ["ETHUSDT", live(1500)],
      ]),
    });
    expect(v.marketValue).toBe(900);
    expect(v.totalValue).toBe(1000);
    expect(v.unrealizedPnL).toBe(0); // +100 BTC, -100 ETH
    expect(v.totalReturnPercent).toBe(0);
    expect(v.best?.symbol).toBe("BTCUSDT");
    expect(v.worst?.symbol).toBe("ETHUSDT");
    expect(v.positions[0]!.allocationPercent).toBeCloseTo(60, 8);
  });

  it("never treats a missing price as zero", () => {
    const v = valuePortfolio({
      cash: 100,
      initialBalance: 1000,
      realizedPnL: 0,
      holdings,
      prices: new Map([["BTCUSDT", live(50000)]]),
    });
    expect(v.unpricedSymbols).toEqual(["ETHUSDT"]);
    const eth = v.positions.find((p) => p.symbol === "ETHUSDT")!;
    expect(eth.marketValue).toBeNull();
    expect(eth.unrealizedPnL).toBeNull();
    expect(v.marketValue).toBe(500);
  });

  it("flags positions valued with last-known prices", () => {
    const v = valuePortfolio({
      cash: 0,
      initialBalance: 900,
      realizedPnL: 0,
      holdings,
      prices: new Map([
        ["BTCUSDT", live(50000)],
        ["ETHUSDT", { price: 2000, asOf: now - 3_600_000, live: false }],
      ]),
    });
    expect(v.stalePricedSymbols).toEqual(["ETHUSDT"]);
    expect(v.unpricedSymbols).toEqual([]);
  });
});

describe("scenarioImpact", () => {
  it("computes the effect of a single-asset move", () => {
    const v = valuePortfolio({
      cash: 500,
      initialBalance: 1000,
      realizedPnL: 0,
      holdings: [holdings[0]!],
      prices: new Map([["BTCUSDT", live(50000)]]),
    });
    const s = scenarioImpact(v, "BTC", -20);
    expect(s.exposure).toBe(500);
    expect(s.valueChange).toBe(-100);
    expect(s.portfolioValueAfter).toBe(900);
    expect(s.portfolioChangePercent).toBeCloseTo(-10, 8);
  });
});
