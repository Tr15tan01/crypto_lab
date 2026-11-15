import { describe, expect, it } from "vitest";
import { directionSeries, regimeOf, timeframeTrend, zoneHistory, zoneOf } from "@/services/market/direction";
import { STRATEGIES, bestFor, runStrategyBacktest, verdictOf } from "@/services/backtest/strategy-backtest";
import { withLiveCandle } from "@/services/learning/features";
import type { Kline } from "@/services/binance/schemas";

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);

function candles(closes: number[]): Kline[] {
  return closes.map((c, i) => {
    const prev = closes[i - 1] ?? c;
    return { openTime: START + i * DAY, open: prev, high: Math.max(c, prev) * 1.01, low: Math.min(c, prev) * 0.99, close: c, volume: 1000, closeTime: START + (i + 1) * DAY - 1, quoteVolume: 1000 * c, trades: 1 };
  });
}
const rising = (n: number, start = 100, step = 0.004) => Array.from({ length: n }, (_, i) => start * (1 + step) ** i);

describe("market direction", () => {
  const up = candles(rising(320));
  const down = candles(rising(320).reverse());
  const universe = (k: Kline[]) => Array.from({ length: 20 }, () => ({ candles: k }));

  it("maps scores to zones and regimes", () => {
    expect(zoneOf(60)).toBe("strong_up");
    expect(zoneOf(20)).toBe("up");
    expect(zoneOf(0)).toBe("sideways");
    expect(zoneOf(-20)).toBe("down");
    expect(zoneOf(-80)).toBe("strong_down");
    expect(regimeOf(15)).toBe("up");
    expect(regimeOf(-15)).toBe("down");
    expect(regimeOf(5)).toBe("sideways");
  });

  it("reads a rising market as up and a falling one as down", () => {
    const fear = new Map<number, number>();
    const u = directionSeries(up, universe(up), fear);
    const d = directionSeries(down, universe(down), fear);
    expect(u[u.length - 1]!.score).toBeGreaterThan(50);
    expect(d[d.length - 1]!.score).toBeLessThan(-50);
    expect(u[u.length - 1]!.facts.breadth50).toBe(1);
    expect(u[0]!.t).toBe(up[200]!.openTime); // needs 200 days of history
  });

  it("uses the Fear & Greed value of the day", () => {
    const day = Math.floor(up[319]!.openTime / DAY);
    const greedy = directionSeries(up, universe(up), new Map([[day, 90]]));
    const fearful = directionSeries(up, universe(up), new Map([[day, 10]]));
    expect(greedy[greedy.length - 1]!.score).toBeGreaterThan(fearful[fearful.length - 1]!.score);
  });

  it("records what followed each zone", () => {
    const series = directionSeries(up, universe(up), new Map());
    const h = zoneHistory(series, up, universe(up));
    const strong = h.find((z) => z.zone === "strong_up")!;
    expect(strong.days).toBeGreaterThan(50);
    expect(strong.btc7!.upPercent).toBe(100);
    expect(strong.alt30!.medianPercent).toBeGreaterThan(0);
    expect(h.find((z) => z.zone === "strong_down")!.btc7).toBeNull(); // no such days
  });

  it("classifies a timeframe trend", () => {
    const closes = rising(120);
    expect(timeframeTrend("1d", closes, closes[119]!)!.direction).toBe("up");
    // A decline that keeps accelerating: below both averages with MACD still falling.
    const falling = Array.from({ length: 120 }, (_, i) => 300 - i - (i * i) / 100);
    expect(timeframeTrend("1d", falling, falling[119]!)!.direction).toBe("down");
    expect(timeframeTrend("1d", closes.slice(0, 30), 100)).toBeNull();
  });
});

describe("strategy backtest", () => {
  // Flat, then a breakout that keeps running, then a collapse.
  const closes = [
    ...Array.from({ length: 260 }, (_, i) => 100 + Math.sin(i / 5)),
    ...Array.from({ length: 40 }, (_, i) => 104 + i * 1.5),
    ...Array.from({ length: 30 }, (_, i) => 162 - i * 3),
  ];
  const pair = { symbol: "XUSDT", candles: candles(closes) };
  const btc = candles(Array.from({ length: closes.length }, () => 100));
  const regimes = new Map<number, "up" | "sideways" | "down">(pair.candles.map((k) => [Math.floor(k.openTime / DAY), "up"]));

  it("runs every strategy and tags trades with the regime at entry", () => {
    const r = runStrategyBacktest([pair], btc, regimes, new Map());
    expect(r.results.map((x) => x.key)).toEqual(STRATEGIES.map((s) => s.key));
    const breakout = r.results.find((x) => x.key === "breakout_trend")!;
    expect(breakout.overall!.trades).toBeGreaterThanOrEqual(1);
    expect(breakout.overall!.avgReturnPercent).toBeGreaterThan(5); // rode the run, left on the trend exit
    expect(breakout.avgVsBtcPercent).toBeCloseTo(breakout.overall!.avgReturnPercent, 5); // BTC was flat
    expect(breakout.byRegime.up).toBeNull(); // fewer than 20 trades in a regime: not reported
    expect(r.results.find((x) => x.key === "baseline")!.overall!.trades).toBeGreaterThan(10);
  });

  it("buys fear only on fearful days", () => {
    const day = Math.floor(pair.candles[250]!.openTime / DAY);
    const none = runStrategyBacktest([pair], btc, regimes, new Map());
    const some = runStrategyBacktest([pair], btc, regimes, new Map([[day, 20]]));
    expect(none.results.find((x) => x.key === "buy_fear")!.overall).toBeNull();
    expect(some.results.find((x) => x.key === "buy_fear")!.overall!.trades).toBe(1);
  });

  it("gives verdicts and ranks strategies for a regime", () => {
    const stats = (pf: number, avg: number, trades = 100) => ({ rule: "x", trades, winRatePercent: 40, avgReturnPercent: avg, medianReturnPercent: 0, avgHoldDays: 10, returnPerDayPercent: 0, profitFactor: pf, p10ReturnPercent: -10, worstReturnPercent: -30 });
    expect(verdictOf(stats(2, 5))).toBe("worked");
    expect(verdictOf(stats(1.1, 0.5))).toBe("mixed");
    expect(verdictOf(stats(0.7, -2))).toBe("lost");
    expect(verdictOf(stats(3, 9, 10))).toBe("few");
    expect(verdictOf(null)).toBe("few");
    const mk = (key: string, pf: number | null) => ({ key, overall: null, avgVsBtcPercent: null, firingNow: [], byRegime: { up: pf === null ? null : stats(pf, 1), sideways: null, down: null } }) as never;
    expect(bestFor([mk("golden_cross", 0.8), mk("breakout_trend", 2.1), mk("fib_pullback", null), mk("baseline", 9)], "up").map((r) => r.key)).toEqual(["breakout_trend", "golden_cross"]);
  });
});

describe("live candle for scoring", () => {
  const base = candles(rising(10));
  it("scales today's volume to a full day and drops a candle that has barely started", () => {
    const now = START + 10 * DAY + DAY / 2; // half-way through day 11
    const forming: Kline = { ...base[9]!, openTime: START + 10 * DAY, closeTime: START + 11 * DAY - 1, volume: 400, quoteVolume: 4000 };
    const out = withLiveCandle([...base, forming], now);
    expect(out).toHaveLength(11);
    expect(out[10]!.volume).toBeCloseTo(800, 0);
    expect(withLiveCandle([...base, forming], START + 10 * DAY + DAY * 0.05)).toHaveLength(10);
    expect(withLiveCandle(base, now)).toBe(base); // nothing forming
  });
});
