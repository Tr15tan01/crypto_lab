import { describe, expect, it } from "vitest";
import { onsets, runBacktest, signalEdge, signalSeries, summarize } from "@/services/backtest/signal-backtest";
import { buildFactors, portfolioRisk, returnCorrelation, type EngineInput } from "@/services/autopilot/engine";
import type { Kline } from "@/services/binance/schemas";

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);

function candles(closes: number[], volume: (i: number) => number = () => 1000): Kline[] {
  return closes.map((c, i) => {
    const prev = closes[i - 1] ?? c;
    return {
      openTime: START + i * DAY,
      open: prev,
      high: Math.max(c, prev) * 1.005,
      low: Math.min(c, prev) * 0.995,
      close: c,
      volume: volume(i),
      closeTime: START + (i + 1) * DAY - 1,
      quoteVolume: volume(i) * c,
      trades: 1,
    };
  });
}

describe("onsets", () => {
  it("counts a new event only after the signal was off for the cooldown", () => {
    const s = [false, true, true, false, true, false, false, false, false, false, false, true];
    expect(onsets(s)).toEqual([1, 11]);
  });
});

describe("summarize", () => {
  it("computes win rate, median and the vs-BTC t-statistic", () => {
    const samples = [5, 10, -2, 3].map((r) => ({ ret: { 7: r }, vsBtc: { 7: r - 1 } }));
    const s = summarize(samples, 7)!;
    expect(s.events).toBe(4);
    expect(s.winRatePercent).toBe(75);
    expect(s.medianReturnPercent).toBe(4);
    expect(s.meanVsBtcPercent).toBe(3);
    expect(s.tStat).toBeGreaterThan(0);
    expect(summarize([], 7)).toBeNull();
  });
});

describe("signalSeries", () => {
  it("fires a breakout when the close clears the prior 90-day high", () => {
    const closes = [...Array.from({ length: 260 }, (_, i) => 100 + Math.sin(i / 5)), 120];
    const s = signalSeries(candles(closes), null);
    expect(s.breakout[closes.length - 1]).toBe(true);
    expect(s.breakout[closes.length - 2]).toBe(false);
  });

  it("fires an unusual-volume event on a 5× volume day", () => {
    const closes = Array.from({ length: 240 }, () => 100);
    const s = signalSeries(candles(closes, (i) => (i === 230 ? 5000 : 1000)), null);
    expect(s.volume_surge[230]).toBe(true);
    expect(s.volume_surge[229]).toBe(false);
  });
});

describe("runBacktest", () => {
  it("measures forward returns after events and against BTC", () => {
    // Flat BTC; a pair that breaks out and keeps rising afterwards.
    const btc = candles(Array.from({ length: 330 }, () => 100));
    const pair = candles([...Array.from({ length: 260 }, (_, i) => 100 + Math.sin(i / 5)), ...Array.from({ length: 70 }, (_, i) => 105 + i)]);
    const r = runBacktest([{ symbol: "X", candles: pair }], btc);
    const breakout = r.results.find((x) => x.key === "breakout")!.stats.find((s) => s.horizonDays === 7)!;
    expect(breakout.events).toBeGreaterThanOrEqual(1);
    expect(breakout.meanReturnPercent).toBeGreaterThan(0);
    expect(breakout.meanVsBtcPercent).toBeCloseTo(breakout.meanReturnPercent, 5);
    expect(r.results.find((x) => x.key === "baseline")!.stats.length).toBe(2);
    expect(signalEdge(r, "breakout")).toBeNull(); // fewer than 30 events
  });
});

describe("autopilot additions", () => {
  it("correlates identical return series at 1", () => {
    const a = candles(Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i) * 5 + i));
    expect(returnCorrelation(a, a)).toBeCloseTo(1, 6);
  });

  it("summarises loss at stops, concentration and warnings", () => {
    const risk = portfolioRisk(
      [
        { symbol: "AUSDT", price: 10, stop: 8, holding: { quantity: 400, averageCost: 9, marketValue: 4000, pnlPercent: 11 } },
        { symbol: "BUSDT", price: 5, stop: null, holding: { quantity: 200, averageCost: 5, marketValue: 1000, pnlPercent: 0 } },
        { symbol: "CUSDT", price: 1, stop: 0.9, holding: null },
      ],
      5200,
      200,
    );
    expect(risk.lossAtStops).toBe(800);
    expect(risk.unprotected).toEqual(["BUSDT"]);
    expect(risk.largestPosition).toEqual({ symbol: "AUSDT", percent: (4000 / 5200) * 100 });
    expect(risk.warnings.some((w) => w.includes("AUSDT"))).toBe(true);
    expect(risk.warnings.some((w) => w.includes("cash"))).toBe(true);
  });

  it("weights firing signals by their backtested edge", () => {
    const base = {
      row: { signals: ["breakout", "oversold_bounce"], cautions: [], return7d: 0 },
      daily: { price: 1, macd: null, ema20: null, rsi14: 50 },
      fourHour: null,
      scorecard: { composite: 0, label: "neutral", baseRates: { sameRegime: null } },
      derivatives: null,
      orderBookImbalance: null,
      smartMoney: null,
      holding: null,
    } as unknown as EngineInput;
    const harmful = buildFactors({ ...base, signalEdges: { oversold_bounce: { edge: -3, tStat: -3, events: 400 }, breakout: { edge: 0.5, tStat: 0.4, events: 400 } } });
    expect(harmful.find((f) => f.name === "Signal track record")!.score).toBeLessThan(0);
    const proven = buildFactors({ ...base, signalEdges: { breakout: { edge: 3, tStat: 2.5, events: 400 } } });
    expect(proven.find((f) => f.name === "Signal track record")!.score).toBeGreaterThan(0);
    // Without backtest data the old count-based factor is used.
    expect(buildFactors(base).some((f) => f.name === "Discovery signals")).toBe(true);
  });
});
