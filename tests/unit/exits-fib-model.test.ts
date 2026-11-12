import { describe, expect, it } from "vitest";
import { fibonacciLevels, fibSwing, isFibPullback } from "@/services/indicators/fibonacci";
import { exitStats, simulateExit } from "@/services/backtest/exit-backtest";
import { exitPlanFor } from "@/services/autopilot/engine";
import { summarizeIndicators } from "@/services/indicators/summary";
import { FEATURE_KEYS, labelAgainstMedian, type Sample } from "@/services/learning/features";
import { crossValidate, modelTrust, rankCorrelation } from "@/services/learning/model";
import { isTrackerOrPegged } from "@/services/market/asset-names";
import type { Kline } from "@/services/binance/schemas";

const DAY = 86_400_000;
const START = Date.UTC(2025, 0, 1);

function bar(i: number, open: number, high: number, low: number, close: number): Kline {
  return { openTime: START + i * DAY, open, high, low, close, volume: 1000, closeTime: START + (i + 1) * DAY - 1, quoteVolume: 1000 * close, trades: 1 };
}
const flat = (i: number, p: number) => bar(i, p, p * 1.001, p * 0.999, p);

describe("fibonacci", () => {
  // Rises from 100 to 200, then pulls back to 140.
  const up = [...Array.from({ length: 30 }, (_, i) => flat(i, 100 + (i * 100) / 29)), ...Array.from({ length: 10 }, (_, i) => flat(30 + i, 200 - (i + 1) * 6))];

  it("measures the swing and how much has been retraced", () => {
    const s = fibSwing(up, 0, up.length - 1, 140)!;
    expect(s.direction).toBe("up");
    expect(s.high).toBeCloseTo(200.2, 1);
    expect(s.retraced).toBeCloseTo((200.2 - 140) / (200.2 - 99.9), 2);
  });

  it("places retracements below the high and extensions above it for an up-swing", () => {
    const f = fibonacciLevels(up, 140, 90)!;
    const r618 = f.retracements.find((r) => r.ratio === 0.618)!;
    expect(r618.price).toBeCloseTo(f.high - 0.618 * (f.high - f.low), 6);
    expect(f.extensions[0]!.price).toBeGreaterThan(f.high);
    expect(f.inGoldenPocket).toBe(true);
    expect(f.nearest!.ratio).toBe(0.618);
  });

  it("flags a golden-pocket pullback only after a big, recent up-swing", () => {
    const opts = { lookback: 90, minSwingPercent: 25, maxDaysSinceHigh: 30 };
    expect(isFibPullback(up, up.length - 1, 140, opts)).toBe(true);
    expect(isFibPullback(up, up.length - 1, 190, opts)).toBe(false); // barely retraced
    expect(isFibPullback(up, up.length - 1, 140, { ...opts, minSwingPercent: 150 })).toBe(false);
  });
});

describe("exit rules", () => {
  const sma = (n: number) => new Array<number | null>(n).fill(null);

  it("takes the stop before the target when one candle touches both, and fills gaps at the open", () => {
    const k = [flat(0, 100), bar(1, 100, 125, 90, 110), flat(2, 110)];
    // ATR 5 → stop 90, target 120: the candle touches both.
    expect(simulateExit(k, 0, 5, sma(3), "stop_target")!.returnPercent).toBeCloseTo(-10);
    const gap = [flat(0, 100), bar(1, 80, 82, 78, 80), flat(2, 80)];
    expect(simulateExit(gap, 0, 5, sma(3), "stop_target")!.returnPercent).toBeCloseTo(-20);
  });

  it("trend exit sells on the first close below the 20-day average", () => {
    const k = [flat(0, 100), flat(1, 104), flat(2, 108), flat(3, 101), flat(4, 120)];
    const line = [null, 100, 102, 103, 104];
    expect(simulateExit(k, 0, 5, line, "trend20")).toEqual({ returnPercent: expect.closeTo(1, 5), holdDays: 3 });
  });

  it("trailing stop locks in gains as the high rises", () => {
    const k = [flat(0, 100), flat(1, 130), bar(2, 130, 131, 110, 112), flat(3, 112)];
    // High 130.13 → stop ≈ 115.13 with ATR 5.
    const t = simulateExit(k, 0, 5, sma(4), "trail3")!;
    expect(t.holdDays).toBe(2);
    expect(t.returnPercent).toBeCloseTo(15.13, 1);
  });

  it("returns null when the data ends before the exit, and summarises trades", () => {
    expect(simulateExit([flat(0, 100), flat(1, 101)], 0, 5, sma(2), "hold7")).toBeNull();
    const s = exitStats("hold7", [{ returnPercent: 10, holdDays: 7 }, { returnPercent: -5, holdDays: 7 }])!;
    expect(s).toMatchObject({ trades: 2, winRatePercent: 50, avgReturnPercent: 2.5, profitFactor: 2 });
  });
});

describe("exit plan", () => {
  const closes = (last: number) => [...Array.from({ length: 60 }, (_, i) => 100 + i * 0.5), last];
  const candles = (last: number): Kline[] => closes(last).map((c, i) => bar(i, c, c * 1.01, c * 0.99, c));

  it("is intact above the 20-day average and broken after a close below it", () => {
    const ok = summarizeIndicators(candles(131), "1d", 131);
    const planOk = exitPlanFor(ok, 120);
    expect(planOk.trendBroken).toBe(false);
    expect(planOk.cushionPercent).toBeGreaterThan(0);
    expect(planOk.hardStop).toBeLessThan(120);

    const broken = summarizeIndicators(candles(110), "1d", 110);
    expect(exitPlanFor(broken, 120).trendBroken).toBe(true);
  });
});

describe("model v2", () => {
  it("labels each coin against the median coin of the same day", () => {
    const mk = (symbol: string, t: number, excess: number): Sample => ({ symbol, t, x: FEATURE_KEYS.map(() => 0), y: 0, excess });
    const day = (d: number) => Array.from({ length: 11 }, (_, i) => mk(`C${i}`, START + d * DAY, i - 5 + d * 100));
    const out = labelAgainstMedian([...day(0), ...day(3), mk("LONELY", START + 9 * DAY, 5)]);
    expect(out).toHaveLength(22); // the single-coin day is dropped
    // Half are above the median each day, whatever the market did (day 3 is +300 across the board).
    expect(out.filter((s) => s.y === 1)).toHaveLength(10);
    expect(Math.max(...out.map((s) => Math.abs(s.excess)))).toBe(5);
  });

  it("validates over several periods and finds a real pattern in every one", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const samples: Sample[] = [];
    for (let d = 0; d < 120; d++) {
      for (let c = 0; c < 20; c++) {
        const x = FEATURE_KEYS.map(() => rnd() * 2 - 1);
        const excess = x[0]! * 3 + (rnd() - 0.5) * 4;
        samples.push({ symbol: `C${c}`, t: START + d * 3 * DAY, x, y: 0, excess });
      }
    }
    const cv = crossValidate(labelAgainstMedian(samples), { folds: 4 });
    expect(cv.validation.folds).toHaveLength(4);
    expect(cv.validation.positiveFolds).toBe(4);
    expect(cv.validation.ic).toBeGreaterThan(0.3);
    expect(cv.validation.icT).toBeGreaterThan(2);
    expect(cv.probs).toHaveLength(cv.samples.length);
    // No test sample precedes the first fold's start.
    expect(Math.min(...cv.samples.map((s) => s.t))).toBeGreaterThanOrEqual(cv.validation.folds[0]!.from);
  });

  it("ranks, trust and tracker filter behave", () => {
    expect(rankCorrelation([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(rankCorrelation([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
    expect(modelTrust(0.555, 1)).toBeCloseTo(0.5);
    expect(modelTrust(0.555, 0.5)).toBeCloseTo(0.25);
    expect(isTrackerOrPegged("PAXG", [])).toBe(true);
    expect(isTrackerOrPegged("FOO", Array.from({ length: 100 }, () => 1))).toBe(true); // never moves
    expect(isTrackerOrPegged("SOL", Array.from({ length: 100 }, (_, i) => 100 + (i % 2 ? 3 : -3)))).toBe(false);
  });
});
