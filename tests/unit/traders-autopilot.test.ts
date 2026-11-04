import { describe, expect, it } from "vitest";
import {
  detectStrategyChange,
  equityFromRoi,
  equityFromTrades,
  maxDrawdownPercent,
  parseTradesCsv,
  returnMetrics,
  tradeStats,
  type TradeLike,
} from "@/services/traders/metrics";
import { analyzePair, bandwidthPercentile, volumeFlow } from "@/services/discovery/screens";
import { assessRegime, combine, decide, positionSize, tradeLevels, type EngineInput } from "@/services/autopilot/engine";
import { summarizeIndicators } from "@/services/indicators/summary";
import { buildScorecard } from "@/services/indicators/scorecard";
import type { Kline } from "@/services/binance/schemas";
import type { MarketTicker } from "@/services/binance/market-data";
import { isLikelyTokenizedStock } from "@/services/market/asset-names";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 1, 12);

function trade(over: Partial<TradeLike>): TradeLike {
  return { symbol: "BTCUSDT", side: "long", leverage: null, openedAt: NOW - DAY, closedAt: NOW, entryPrice: 100, exitPrice: 110, quantity: 1, pnl: null, ...over };
}

function candles(closes: number[], volume = (i: number) => 1000 + i): Kline[] {
  const end = Date.UTC(2026, 10, 1);
  return closes.map((c, i) => {
    const openTime = end - (closes.length - i) * DAY;
    const prev = closes[i - 1] ?? c;
    return { openTime, open: prev, high: Math.max(c, prev) * 1.01, low: Math.min(c, prev) * 0.99, close: c, volume: volume(i), closeTime: openTime + DAY - 1, quoteVolume: volume(i) * c, trades: 10 };
  });
}

function ticker(price: number, over: Partial<MarketTicker> = {}): MarketTicker {
  return {
    symbol: "TESTUSDT", baseAsset: "TEST", quoteAsset: "USDT", name: null, price, priceChange: 0, priceChangePercent: 0, open: price, high: price, low: price,
    weightedAvgPrice: price, volume: 1, quoteVolume: 5_000_000, tradeCount: 100, openTime: NOW - DAY, closeTime: NOW, ...over,
  };
}

describe("trader returns", () => {
  it("converts cumulative ROI to equity and computes daily, weekly, monthly returns and drawdown", () => {
    // ROI 0% → 10% → 0% → 20% over consecutive days, then flat for a month.
    const roi = [0, 10, 0, 20, ...Array.from({ length: 30 }, () => 20)];
    const eq = equityFromRoi(roi.map((r, i) => ({ t: i * DAY, roi: r })));
    const m = returnMetrics(eq);
    expect(eq[1]!.v).toBeCloseTo(1.1);
    expect(m.dailyReturnPercent).toBeCloseTo(0);
    expect(m.weeklyReturnPercent).toBeCloseTo(0);
    // 30 days before the last point the equity was already 1.2 (the day ROI hit 20%).
    expect(m.monthlyReturnPercent).toBeCloseTo(0);
    expect(m.totalReturnPercent).toBeCloseTo(20);
    expect(m.maxDrawdownPercent).toBeCloseTo(((1.1 - 1) / 1.1) * 100, 5);
  });

  it("returns null drawdown for a single point", () => {
    expect(maxDrawdownPercent([{ t: 0, v: 1 }])).toBeNull();
  });

  it("builds manual equity from realised P&L by close day", () => {
    const eq = equityFromTrades(1000, [
      trade({ openedAt: NOW - 3 * DAY, closedAt: NOW - 2 * DAY, entryPrice: 100, exitPrice: 110, quantity: 2 }),
      trade({ side: "short", openedAt: NOW - 2 * DAY, closedAt: NOW - DAY, entryPrice: 100, exitPrice: 95, quantity: 4 }),
      trade({ openedAt: NOW - DAY, closedAt: null, exitPrice: null }),
    ], NOW);
    expect(eq[0]!.v).toBe(1000);
    expect(eq[eq.length - 1]!.v).toBe(1000 + 20 + 20);
  });
});

describe("trade stats", () => {
  it("aggregates per coin with longs, shorts, win rate and holding time", () => {
    const s = tradeStats([
      trade({ symbol: "SOLUSDT", openedAt: NOW - 10 * 3_600_000, closedAt: NOW, exitPrice: 120 }),
      trade({ symbol: "SOLUSDT", side: "short", openedAt: NOW - 2 * 3_600_000, closedAt: NOW, exitPrice: 105 }),
      trade({ symbol: "ETHUSDT", closedAt: null, exitPrice: null, leverage: 10 }),
    ], NOW);
    expect(s.trades).toBe(3);
    expect(s.open).toBe(1);
    expect(s.winRatePercent).toBe(50);
    expect(s.avgHoldingHours).toBeCloseTo(6);
    expect(s.coins[0]).toMatchObject({ symbol: "SOLUSDT", trades: 2, longs: 1, shorts: 1, pnl: 15 });
  });
});

describe("strategy change", () => {
  const base = (i: number, over: Partial<TradeLike> = {}) =>
    trade({ symbol: ["BTCUSDT", "ETHUSDT"][i % 2], openedAt: NOW - (20 + i * 3) * DAY, closedAt: NOW - (20 + i * 3) * DAY + 48 * 3_600_000, leverage: 3, ...over });

  it("flags a shift in holding time, leverage, direction and coins", () => {
    const baseline = Array.from({ length: 8 }, (_, i) => base(i));
    const recent = Array.from({ length: 6 }, (_, i) =>
      trade({ symbol: `NEW${i}USDT`, side: "short", openedAt: NOW - (i + 1) * DAY, closedAt: NOW - (i + 1) * DAY + 3_600_000, leverage: 20 }),
    );
    const r = detectStrategyChange([...baseline, ...recent], NOW);
    expect(r.status).toBe("changing");
    expect(r.changes.length).toBeGreaterThanOrEqual(4);
  });

  it("is stable when behaviour stays the same and needs enough trades", () => {
    const all = [
      ...Array.from({ length: 8 }, (_, i) => base(i)),
      ...Array.from({ length: 4 }, (_, i) => trade({ symbol: ["BTCUSDT", "ETHUSDT"][i % 2], openedAt: NOW - (i * 3 + 1) * DAY, closedAt: NOW - (i * 3 + 1) * DAY + 48 * 3_600_000, leverage: 3 })),
    ];
    expect(detectStrategyChange(all, NOW).status).toBe("stable");
    expect(detectStrategyChange([base(1)], NOW).status).toBe("insufficient_data");
  });
});

describe("parseTradesCsv", () => {
  it("parses common column names and sides, and reports bad lines", () => {
    const { trades, errors } = parseTradesCsv(
      "Pair,Side,Entry Price,Exit Price,Qty,Opened,Closed\nsolusdt,BUY,142.5,158.2,10,2026-09-01T10:00:00Z,2026-09-09T16:30:00Z\nETHUSDT,short,2650,,2,2026-09-12,\nBAD,maybe,0,,,,",
    );
    expect(trades).toHaveLength(2);
    expect(trades[0]).toMatchObject({ symbol: "SOLUSDT", side: "long", entryPrice: 142.5, exitPrice: 158.2, quantity: 10 });
    expect(trades[1]).toMatchObject({ side: "short", exitPrice: null, closedAt: null });
    expect(errors[0]).toMatch(/^Line 4/);
  });

  it("requires the core columns", () => {
    expect(parseTradesCsv("a,b\n1,2").errors[0]).toMatch(/Missing column/);
  });
});

describe("new discovery signals", () => {
  it("detects a volatility squeeze after a long quiet spell", () => {
    const noisy = Array.from({ length: 100 }, (_, i) => 100 + (i % 2 ? 6 : -6));
    const quiet = Array.from({ length: 40 }, (_, i) => 100 + (i % 2 ? 0.2 : -0.2));
    expect(bandwidthPercentile([...noisy, ...quiet], 120)).toBeLessThanOrEqual(10);
  });

  it("measures on-balance volume flow", () => {
    const up = candles(Array.from({ length: 25 }, (_, i) => 100 + i));
    expect(volumeFlow(up, 20)).toBeCloseTo(1);
  });

  it("flags accumulation when volume flows in while price stays flat", () => {
    // Alternating up/down days, with far more volume on the up days, price ends where it started.
    const closes = Array.from({ length: 60 }, (_, i) => (i % 2 ? 101 : 100));
    const k = candles(closes, (i) => (i % 2 ? 5000 : 500));
    const row = analyzePair(ticker(100.5), [...k], { now: NOW, historyLimit: 300, benchmark: { return7d: 0, return30d: 0 } });
    expect(row.signals).toContain("accumulation");
  });
});

describe("autopilot engine", () => {
  const upCloses = Array.from({ length: 300 }, (_, i) => 100 * 1.004 ** i * (1 + Math.sin(i / 3) * 0.02));
  const up = candles(upCloses);
  const price = upCloses[upCloses.length - 1]!;
  const daily = summarizeIndicators(up, "1d", price);
  const row = analyzePair(ticker(price, { symbol: "UPUSDT", baseAsset: "UP" }), up, { now: NOW, historyLimit: 300, benchmark: { return7d: 0, return30d: 0 } });
  const input: EngineInput = {
    row,
    daily,
    fourHour: null,
    scorecard: buildScorecard(up, daily, null, NOW),
    derivatives: null,
    orderBookImbalance: 0.4,
    smartMoney: { longs: 3, shorts: 0, traders: 3 },
    holding: null,
  };
  const sizing = { portfolioValue: 10_000, cash: 5_000, riskPerTradePercent: 1, maxPositionPercent: 15 };
  const riskOn = assessRegime({ btcAboveSma50: true, btcAboveSma200: true, btcReturn7dPercent: 3, breadthPercent: 65, fearGreed: 55 });

  it("classifies the market regime", () => {
    expect(riskOn.mode).toBe("risk_on");
    expect(assessRegime({ btcAboveSma50: false, btcAboveSma200: false, btcReturn7dPercent: -8, breadthPercent: 20, fearGreed: 85 }).mode).toBe("risk_off");
  });

  it("puts the stop below price and the target above it with at least 1.5R", () => {
    const l = tradeLevels(daily)!;
    expect(l.stop).toBeLessThan(price);
    expect(l.stop).toBeGreaterThanOrEqual(price * 0.75);
    expect(l.target).toBeGreaterThan(price);
    expect(l.riskReward).toBeGreaterThanOrEqual(1.5 - 1e-9);
  });

  it("sizes by risk and caps by the max position and cash", () => {
    const s = positionSize(100, 95, sizing, 1)!;
    expect(s.allocationPercent).toBeCloseTo(15); // 1% / 5% = 20%, capped at 15%
    expect(s.amount).toBeCloseTo(1500);
    expect(positionSize(100, 95, { ...sizing, cash: 300 }, 1)!.amount).toBe(300);
  });

  it("buys a strong uptrend in a risk-on market and explains why", () => {
    const r = decide(input, riskOn, sizing);
    expect(r.score).toBeGreaterThan(0);
    expect(["BUY", "WATCH"]).toContain(r.action);
    expect(r.reasonsFor.length).toBeGreaterThan(0);
    expect(r.confidence).toBeGreaterThanOrEqual(50);
  });

  it("sells a held position when the trend has broken down", () => {
    const downCloses = upCloses.slice().reverse();
    const down = candles(downCloses);
    const p = downCloses[downCloses.length - 1]!;
    const d = summarizeIndicators(down, "1d", p);
    const r = decide(
      {
        ...input,
        row: analyzePair(ticker(p), down, { now: NOW, historyLimit: 300, benchmark: { return7d: 10, return30d: 20 } }),
        daily: d,
        scorecard: buildScorecard(down, d, up, NOW),
        orderBookImbalance: -0.4,
        smartMoney: { longs: 0, shorts: 3, traders: 3 },
        holding: { quantity: 10, averageCost: p * 1.5 },
      },
      assessRegime({ btcAboveSma50: false, btcAboveSma200: false, btcReturn7dPercent: -5, breadthPercent: 30, fearGreed: 40 }),
      sizing,
    );
    expect(["SELL", "TRIM"]).toContain(r.action);
    expect(r.sellPercent).toBeGreaterThan(0);
  });

  it("combines factors into -100..100", () => {
    expect(combine([{ name: "a", score: 2, weight: 1, note: "" }])).toBe(100);
    expect(combine([{ name: "a", score: -2, weight: 1, note: "" }, { name: "b", score: 2, weight: 1, note: "" }])).toBe(0);
  });
});

describe("tokenized stocks", () => {
  it("flags Binance stock tokens but not crypto ending in B", () => {
    for (const s of ["AAPLB", "NVDAB", "SOXSB", "AMZNB"]) expect(isLikelyTokenizedStock(s)).toBe(true);
    for (const s of ["SHIB", "ARB", "BNB", "CKB", "PEPE", "SOL"]) expect(isLikelyTokenizedStock(s)).toBe(false);
  });
});
