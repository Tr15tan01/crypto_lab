import type { Kline } from "@/services/binance/schemas";
import { logReturnStdDev, sma } from "./core";
import type { IndicatorSummary } from "./summary";

/**
 * A deterministic, rule-based scorecard that condenses the daily indicators into one number,
 * plus empirical base rates (how this pair actually behaved over past 7- and 30-day windows).
 * It gives the AI a grounded starting point for a directional call; it is not a forecast itself.
 */

export interface ScoreComponent {
  name: string;
  /** -2 (strongly bearish) … +2 (strongly bullish). */
  score: number;
  weight: number;
  note: string;
}

export interface ForwardStats {
  horizonDays: number;
  samples: number;
  /** Share of past windows that closed higher than they started. */
  upPercent: number;
  medianReturnPercent: number;
  /** 10th / 90th percentile return — a realistic "bad case" and "good case". */
  p10ReturnPercent: number;
  p90ReturnPercent: number;
}

export type ScoreLabel = "strong bullish" | "bullish" | "neutral" | "bearish" | "strong bearish";

export interface Scorecard {
  /** -100 … +100, weighted sum of the components. */
  composite: number;
  label: ScoreLabel;
  components: ScoreComponent[];
  relativeToBtc: { outperformance7dPercent: number | null; outperformance30dPercent: number | null } | null;
  drawdownFromHighPercent: number | null;
  /** One standard deviation of log returns scaled to the horizon, in percent. */
  oneSigmaMovePercent: { "1d": number; "7d": number; "30d": number } | null;
  baseRates: {
    allWindows: ForwardStats[];
    /** Same statistics, only for past days in the same trend regime as today (close vs 50-day SMA). */
    sameRegime: { regime: "above 50d SMA" | "below 50d SMA"; stats: ForwardStats[] } | null;
  };
}

const FORWARD_HORIZONS = [7, 30];
const LOOKBACK_DAYS = 365;
const MIN_SAMPLES = 20;

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function round(v: number, dp = 2) {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

export function forwardStats(closes: number[], horizonDays: number, include?: (i: number) => boolean): ForwardStats | null {
  const start = Math.max(0, closes.length - 1 - horizonDays - LOOKBACK_DAYS);
  const returns: number[] = [];
  for (let i = start; i + horizonDays < closes.length; i++) {
    if (closes[i]! <= 0 || (include && !include(i))) continue;
    returns.push((closes[i + horizonDays]! / closes[i]! - 1) * 100);
  }
  if (returns.length < MIN_SAMPLES) return null;
  const sorted = [...returns].sort((a, b) => a - b);
  return {
    horizonDays,
    samples: returns.length,
    upPercent: round((returns.filter((r) => r > 0).length / returns.length) * 100, 1),
    medianReturnPercent: round(quantile(sorted, 0.5)),
    p10ReturnPercent: round(quantile(sorted, 0.1)),
    p90ReturnPercent: round(quantile(sorted, 0.9)),
  };
}

function pctReturn(closes: number[], days: number): number | null {
  if (closes.length <= days) return null;
  const from = closes[closes.length - 1 - days]!;
  return from > 0 ? (closes[closes.length - 1]! / from - 1) * 100 : null;
}

export function labelFor(composite: number): ScoreLabel {
  if (composite >= 50) return "strong bullish";
  if (composite >= 15) return "bullish";
  if (composite <= -50) return "strong bearish";
  if (composite <= -15) return "bearish";
  return "neutral";
}

/**
 * @param daily  daily candles for the pair (a still-forming candle is ignored)
 * @param summary  daily indicator summary for the same candles
 * @param btcDaily  BTC daily candles for relative strength; omit for BTC itself
 */
export function buildScorecard(daily: Kline[], summary: IndicatorSummary, btcDaily?: Kline[] | null, now = Date.now()): Scorecard {
  const closed = daily.filter((k) => k.closeTime < now);
  const closes = closed.map((k) => k.close);
  const price = summary.price;
  const components: ScoreComponent[] = [];

  // Trend structure.
  {
    let score = 0;
    const notes: string[] = [];
    if (summary.ema50 !== null && summary.ema200 !== null) {
      score += summary.ema50 > summary.ema200 ? 1 : -1;
      notes.push(summary.ema50 > summary.ema200 ? "50 EMA above 200 EMA" : "50 EMA below 200 EMA");
    } else if (summary.ema20 !== null && summary.ema50 !== null) {
      score += summary.ema20 > summary.ema50 ? 1 : -1;
      notes.push(summary.ema20 > summary.ema50 ? "20 EMA above 50 EMA (short history)" : "20 EMA below 50 EMA (short history)");
    }
    if (summary.ema50 !== null) {
      score += price > summary.ema50 ? 1 : -1;
      notes.push(price > summary.ema50 ? "price above 50 EMA" : "price below 50 EMA");
    }
    components.push({ name: "Trend", score, weight: 0.3, note: notes.join("; ") || "not enough history" });
  }

  // Momentum: MACD direction plus RSI zone (extremes score 0 because they often mean-revert).
  {
    let score = 0;
    const notes: string[] = [];
    if (summary.macd) {
      score += summary.macd.histogram > 0 ? 1 : -1;
      notes.push(summary.macd.histogram > 0 ? "MACD above signal" : "MACD below signal");
    }
    const r = summary.rsi14;
    if (r !== null) {
      if (r > 70) notes.push(`RSI ${r.toFixed(0)} overbought — momentum strong but stretched`);
      else if (r >= 55) {
        score += 1;
        notes.push(`RSI ${r.toFixed(0)} in bullish zone`);
      } else if (r < 30) notes.push(`RSI ${r.toFixed(0)} oversold — weak but rebound-prone`);
      else if (r <= 45) {
        score -= 1;
        notes.push(`RSI ${r.toFixed(0)} in bearish zone`);
      } else notes.push(`RSI ${r.toFixed(0)} neutral`);
    }
    components.push({ name: "Momentum", score, weight: 0.25, note: notes.join("; ") || "not enough history" });
  }

  // Relative strength vs BTC.
  let relativeToBtc: Scorecard["relativeToBtc"] = null;
  {
    let score = 0;
    let note = "pair is BTC itself or BTC data unavailable";
    const btcCloses = btcDaily?.filter((k) => k.closeTime < now).map((k) => k.close);
    if (btcCloses && btcCloses.length > 30) {
      const a7 = pctReturn(closes, 7);
      const b7 = pctReturn(btcCloses, 7);
      const a30 = pctReturn(closes, 30);
      const b30 = pctReturn(btcCloses, 30);
      const o7 = a7 !== null && b7 !== null ? a7 - b7 : null;
      const o30 = a30 !== null && b30 !== null ? a30 - b30 : null;
      relativeToBtc = { outperformance7dPercent: o7 === null ? null : round(o7), outperformance30dPercent: o30 === null ? null : round(o30) };
      if (o30 !== null) {
        score = o30 > 15 ? 2 : o30 > 5 ? 1 : o30 < -15 ? -2 : o30 < -5 ? -1 : 0;
        note = `${o30 >= 0 ? "outperformed" : "underperformed"} BTC by ${Math.abs(o30).toFixed(1)}% over 30d`;
      }
    }
    components.push({ name: "Strength vs BTC", score, weight: 0.2, note });
  }

  // Position in the 90-day range.
  {
    let score = 0;
    let note = "no range data";
    const pos = summary.range?.positionPercent;
    if (pos !== null && pos !== undefined) {
      score = pos >= 80 ? 1 : pos <= 20 ? -1 : 0;
      note = `at ${pos.toFixed(0)}% of the 90-day range`;
    }
    components.push({ name: "Range position", score, weight: 0.15, note });
  }

  // Volume confirmation of the last closed day.
  {
    let score = 0;
    let note = "volume normal";
    const ratio = summary.volume.ratio;
    const lastK = closed[closed.length - 1];
    if (ratio !== null && lastK && ratio >= 1.5) {
      const up = lastK.close >= lastK.open;
      score = up ? 2 : -2;
      note = `${ratio.toFixed(1)}× average volume on an ${up ? "up" : "down"} day`;
    } else if (ratio !== null && ratio <= 0.5) note = "volume unusually thin — moves less reliable";
    components.push({ name: "Volume", score, weight: 0.1, note });
  }

  const totalWeight = components.reduce((a, c) => a + c.weight, 0);
  const composite = Math.round((components.reduce((a, c) => a + (c.score / 2) * c.weight, 0) / totalWeight) * 100);

  const high = closed.length ? Math.max(...closed.slice(-LOOKBACK_DAYS).map((k) => k.high)) : null;
  const stdev = logReturnStdDev(closes.slice(-31));

  // Regime-conditioned base rates: past days on the same side of the 50-day SMA as today.
  const sma50 = sma(closes, 50);
  const lastSma = sma50[sma50.length - 1];
  let sameRegime: Scorecard["baseRates"]["sameRegime"] = null;
  if (lastSma !== null && lastSma !== undefined) {
    const above = closes[closes.length - 1]! > lastSma;
    const include = (i: number) => sma50[i] !== null && closes[i]! > sma50[i]! === above;
    const stats = FORWARD_HORIZONS.map((h) => forwardStats(closes, h, include)).filter((s): s is ForwardStats => s !== null);
    if (stats.length) sameRegime = { regime: above ? "above 50d SMA" : "below 50d SMA", stats };
  }

  return {
    composite,
    label: labelFor(composite),
    components,
    relativeToBtc,
    drawdownFromHighPercent: high ? round((price / high - 1) * 100) : null,
    oneSigmaMovePercent:
      stdev !== null
        ? { "1d": round(stdev * 100), "7d": round(stdev * Math.sqrt(7) * 100), "30d": round(stdev * Math.sqrt(30) * 100) }
        : null,
    baseRates: {
      allWindows: FORWARD_HORIZONS.map((h) => forwardStats(closes, h)).filter((s): s is ForwardStats => s !== null),
      sameRegime,
    },
  };
}
