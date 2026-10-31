import { describe, expect, it } from "vitest";
import {
  buyAndHoldSeries,
  maxDrawdown,
  monthlyReturns,
  positionRounds,
  rangePosition,
  sellStats,
  type TxLike,
} from "@/services/analytics/metrics";
import { evaluateOutcome } from "@/services/research/evaluation";
import { isTriggered } from "@/services/alerts/rules";
import type { Kline } from "@/services/binance/schemas";

const DAY = 86_400_000;
const tx = (p: Partial<TxLike> & Pick<TxLike, "type" | "timestamp">): TxLike => ({
  id: String(p.timestamp),
  symbol: "BTCUSDT",
  quantity: 1,
  price: 100,
  grossAmount: 100,
  total: 100,
  fee: 0,
  ...p,
});

describe("positionRounds", () => {
  it("splits trades into rounds that close when fully sold", () => {
    const txs = [
      tx({ type: "BUY", timestamp: 0 }),
      tx({ type: "BUY", timestamp: DAY, price: 120, grossAmount: 120, total: 120 }),
      tx({ type: "SELL", timestamp: 2 * DAY, quantity: 2, grossAmount: 260, total: 260, realizedPnL: 40, costBasisSold: 220 }),
      tx({ type: "BUY", timestamp: 5 * DAY }),
    ];
    const rounds = positionRounds(txs, 6 * DAY);
    expect(rounds).toHaveLength(2);
    const closed = rounds.find((r) => r.closedAt)!;
    expect(closed.holdMs).toBe(2 * DAY);
    expect(closed.averageEntry).toBe(110);
    expect(closed.averageExit).toBe(130);
    expect(closed.realizedReturnPercent).toBeCloseTo((40 / 220) * 100, 8);
    const open = rounds.find((r) => !r.closedAt)!;
    expect(open.holdMs).toBe(DAY);
  });
});

describe("sellStats", () => {
  it("computes win rate, average return and best/worst", () => {
    const s = sellStats([
      tx({ type: "SELL", timestamp: 1, realizedPnL: 10, costBasisSold: 100 }),
      tx({ type: "SELL", timestamp: 2, realizedPnL: -5, costBasisSold: 50 }),
      tx({ type: "BUY", timestamp: 0 }),
    ]);
    expect(s.count).toBe(2);
    expect(s.winRatePercent).toBe(50);
    expect(s.averageReturnPercent).toBeCloseTo(0, 8); // (+10% + -10%) / 2
    expect(s.best?.realizedPnL).toBe(10);
    expect(s.worst?.realizedPnL).toBe(-5);
  });
});

describe("series metrics", () => {
  it("maxDrawdown finds the largest peak-to-trough fall", () => {
    const dd = maxDrawdown([
      { t: 1, v: 100 },
      { t: 2, v: 120 },
      { t: 3, v: 90 },
      { t: 4, v: 130 },
      { t: 5, v: 117 },
    ])!;
    expect(dd.percent).toBeCloseTo(-25, 8);
    expect(dd.peakAt).toBe(2);
    expect(dd.troughAt).toBe(3);
  });

  it("monthlyReturns chains month end values", () => {
    const m = monthlyReturns([
      { t: Date.UTC(2026, 0, 5), v: 100 },
      { t: Date.UTC(2026, 0, 30), v: 110 },
      { t: Date.UTC(2026, 1, 10), v: 99 },
    ]);
    expect(m.map((x) => x.month)).toEqual(["2026-01", "2026-02"]);
    expect(m[0]!.returnPercent).toBeCloseTo(10, 8);
    expect(m[1]!.returnPercent).toBeCloseTo(-10, 8);
  });

  it("rangePosition and buyAndHoldSeries", () => {
    expect(rangePosition(95, [100, 90], [80, 85])).toBe(75);
    expect(buyAndHoldSeries(1000, 50, [{ t: 1, v: 60 }])).toEqual([{ t: 1, v: 1200 }]);
  });
});

describe("evaluateOutcome", () => {
  const start = Date.UTC(2026, 5, 1);
  const candles = (closes: number[], stepMs: number): Kline[] =>
    closes.map((c, i) => ({
      openTime: start + i * stepMs,
      open: c,
      high: c * 1.02,
      low: c * 0.98,
      close: c,
      volume: 1,
      closeTime: start + (i + 1) * stepMs - 1,
      quoteVolume: 1,
      trades: 1,
    }));

  it("judges the horizon close, not an intrawindow spike", () => {
    // Spikes to +10% mid-window but ends flat: a bullish call is NOT correct.
    const k = candles([100, 110, 100.2], 8 * 3_600_000);
    const ev = evaluateOutcome("bullish", 100, start, "24h", k)!;
    expect(ev.outcome).toBe("inconclusive");
    expect(ev.maxUpsidePercent).toBeGreaterThan(10);
  });

  it("marks wrong directional calls and keeps them", () => {
    const k = candles([100, 97, 95], 8 * 3_600_000);
    expect(evaluateOutcome("bullish", 100, start, "24h", k)!.outcome).toBe("incorrect");
    expect(evaluateOutcome("bearish", 100, start, "24h", k)!.outcome).toBe("correct");
    expect(evaluateOutcome("neutral", 100, start, "24h", k)!.outcome).toBe("incorrect");
    expect(evaluateOutcome(null, 100, start, "24h", k)!.outcome).toBe("not_evaluated");
  });

  it("waits until the window is complete", () => {
    expect(evaluateOutcome("bullish", 100, start, "24h", candles([100, 105], 8 * 3_600_000))).toBeNull();
  });
});

describe("alert rules", () => {
  it("evaluates price, percentage and position alerts", () => {
    expect(isTriggered({ type: "PRICE_ABOVE", threshold: 100, referencePrice: null }, 100)).toBe(true);
    expect(isTriggered({ type: "PRICE_BELOW", threshold: 100, referencePrice: null }, 101)).toBe(false);
    expect(isTriggered({ type: "CHANGE_DOWN_PERCENT", threshold: 5, referencePrice: 100 }, 95)).toBe(true);
    expect(isTriggered({ type: "CHANGE_UP_PERCENT", threshold: 10, referencePrice: 100 }, 109)).toBe(false);
    expect(isTriggered({ type: "POSITION_PROFIT_PERCENT", threshold: 20, referencePrice: null }, 120, { averageCost: 100, quantity: 1 })).toBe(true);
    expect(isTriggered({ type: "POSITION_LOSS_PERCENT", threshold: 10, referencePrice: null }, 95, { averageCost: 100, quantity: 1 })).toBe(false);
  });

  it("cannot evaluate without the data it needs", () => {
    expect(isTriggered({ type: "POSITION_LOSS_PERCENT", threshold: 10, referencePrice: null }, 50, null)).toBeNull();
    expect(isTriggered({ type: "CHANGE_UP_PERCENT", threshold: 10, referencePrice: null }, 50)).toBeNull();
    expect(isTriggered({ type: "PRICE_ABOVE", threshold: 1, referencePrice: null }, NaN)).toBeNull();
  });
});
