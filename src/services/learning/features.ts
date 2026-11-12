import type { Kline } from "@/services/binance/schemas";
import { atr, bollinger, ema, rsi, sma } from "@/services/indicators/core";

/**
 * Features for the learning model. One function computes them for every day of a history, so
 * training (all past days) and live scoring (the last day) use exactly the same definitions.
 * Every feature only looks at data up to and including that day's close (no look-ahead).
 */
export const FEATURES = [
  { key: "ret7", label: "7-day return", group: "Momentum" },
  { key: "ret30", label: "30-day return", group: "Momentum" },
  { key: "ret90", label: "90-day return", group: "Momentum" },
  { key: "rel7", label: "7-day return vs BTC", group: "Relative strength" },
  { key: "rel30", label: "30-day return vs BTC", group: "Relative strength" },
  { key: "vsSma50", label: "Distance from 50-day average", group: "Trend" },
  { key: "vsSma200", label: "Distance from 200-day average", group: "Trend" },
  { key: "goldenTrend", label: "50-day above 200-day average", group: "Trend" },
  { key: "rsi14", label: "RSI(14)", group: "Momentum" },
  { key: "macdHist", label: "MACD histogram (% of price)", group: "Momentum" },
  { key: "atrPct", label: "Daily volatility (ATR %)", group: "Volatility" },
  { key: "squeeze", label: "Bollinger width percentile", group: "Volatility" },
  { key: "volumeRatio", label: "Volume vs usual (log)", group: "Volume" },
  { key: "volumeFlow", label: "20-day buy/sell volume flow", group: "Volume" },
  { key: "rangePos90", label: "Position in 90-day range", group: "Range" },
  { key: "drawdown180", label: "Drawdown from 180-day high", group: "Range" },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];
export const FEATURE_KEYS = FEATURES.map((f) => f.key) as FeatureKey[];
export const WARMUP = 200;

const DAY = 86_400_000;
const dayOf = (t: number) => Math.floor(t / DAY);

export interface BtcContext {
  closeByDay: Map<number, number>;
}

export function btcContext(btc: Kline[] | null): BtcContext | null {
  if (!btc?.length) return null;
  return { closeByDay: new Map(btc.map((k) => [dayOf(k.openTime), k.close])) };
}

/** Feature vectors per candle index (null during warm-up or when BTC data is missing that day). */
export function featureRows(candles: Kline[], btc: BtcContext | null): Array<number[] | null> {
  const n = candles.length;
  const closes = candles.map((k) => k.close);
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  const r14 = rsi(closes, 14);
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const macdLine = closes.map((_, i) => (e12[i] != null && e26[i] != null ? e12[i]! - e26[i]! : null));
  const firstMacd = macdLine.findIndex((v) => v !== null);
  const signal = firstMacd >= 0 ? ema(macdLine.slice(firstMacd) as number[], 9) : [];
  const a14 = atr(candles, 14);
  const bb = bollinger(closes, 20, 2);
  const width = closes.map((_, i) => {
    const u = bb.upper[i];
    const l = bb.lower[i];
    const m = bb.middle[i];
    return u != null && l != null && m != null && m > 0 ? (u - l) / m : null;
  });

  const ret = (i: number, d: number) => (i - d >= 0 && closes[i - d]! > 0 ? Math.log(closes[i]! / closes[i - d]!) * 100 : null);
  const btcRet = (i: number, d: number) => {
    if (!btc || i - d < 0) return null;
    const a = btc.closeByDay.get(dayOf(candles[i - d]!.openTime));
    const b = btc.closeByDay.get(dayOf(candles[i]!.openTime));
    return a && b ? Math.log(b / a) * 100 : null;
  };

  const out: Array<number[] | null> = new Array(n).fill(null);
  for (let i = WARMUP; i < n; i++) {
    const c = closes[i]!;
    const r7 = ret(i, 7);
    const r30 = ret(i, 30);
    const r90 = ret(i, 90);
    const b7 = btcRet(i, 7);
    const b30 = btcRet(i, 30);
    if (r7 === null || r30 === null || r90 === null || b7 === null || b30 === null) continue;
    if (s50[i] == null || s200[i] == null || r14[i] == null || a14[i] == null || width[i] == null) continue;

    const sigIdx = i - firstMacd;
    const hist = firstMacd >= 0 && sigIdx >= 0 && signal[sigIdx] != null && macdLine[i] != null ? macdLine[i]! - signal[sigIdx]! : 0;

    const widths = width.slice(i - 119, i + 1).filter((v): v is number => v !== null);
    const squeeze = widths.length > 1 ? widths.filter((v) => v < width[i]!).length / (widths.length - 1) : 0.5;

    const qv = candles.slice(i - 30, i).map((k) => k.quoteVolume).sort((a, b) => a - b);
    const usual = qv[Math.floor(qv.length / 2)] ?? 0;
    const volumeRatio = usual > 0 && candles[i]!.quoteVolume > 0 ? Math.log(candles[i]!.quoteVolume / usual) : 0;

    let flow = 0;
    let total = 0;
    for (let j = i - 19; j <= i; j++) {
      flow += Math.sign(closes[j]! - closes[j - 1]!) * candles[j]!.volume;
      total += candles[j]!.volume;
    }

    let hi90 = -Infinity;
    let lo90 = Infinity;
    for (let j = i - 89; j <= i; j++) {
      hi90 = Math.max(hi90, candles[j]!.high);
      lo90 = Math.min(lo90, candles[j]!.low);
    }
    let hi180 = -Infinity;
    for (let j = Math.max(0, i - 179); j <= i; j++) hi180 = Math.max(hi180, candles[j]!.high);

    out[i] = [
      r7,
      r30,
      r90,
      r7 - b7,
      r30 - b30,
      (c / s50[i]! - 1) * 100,
      (c / s200[i]! - 1) * 100,
      s50[i]! > s200[i]! ? 1 : 0,
      r14[i]!,
      (hist / c) * 100,
      (a14[i]! / c) * 100,
      squeeze,
      volumeRatio,
      total > 0 ? flow / total : 0,
      hi90 > lo90 ? (c - lo90) / (hi90 - lo90) : 0.5,
      hi180 > 0 ? (c / hi180 - 1) * 100 : 0,
    ];
  }
  return out;
}

export interface Sample {
  symbol: string;
  t: number;
  x: number[];
  /** 1 when the pair did better than the typical (median) coin that day; see `labelAgainstMedian`. */
  y: 0 | 1;
  /** Pair return minus BTC return over the horizon, percent. */
  excess: number;
}

/**
 * Labelled samples from one pair: features on day i, excess = pair return minus BTC return from the
 * close of day i to the close of day i + horizon. Sampled every `stride` days to limit overlap.
 */
export function samplesFor(symbol: string, candles: Kline[], btc: BtcContext, horizon = 7, stride = 3): Sample[] {
  const rows = featureRows(candles, btc);
  const out: Sample[] = [];
  for (let i = WARMUP; i + horizon < candles.length; i++) {
    // Sampled on the same calendar days for every pair, so coins can be compared within a day.
    if (dayOf(candles[i]!.openTime) % stride !== 0) continue;
    const x = rows[i];
    if (!x) continue;
    const a = btc.closeByDay.get(dayOf(candles[i]!.openTime));
    const b = btc.closeByDay.get(dayOf(candles[i + horizon]!.openTime));
    if (!a || !b) continue;
    const excess = (candles[i + horizon]!.close / candles[i]!.close - 1) * 100 - (b / a - 1) * 100;
    if (!Number.isFinite(excess)) continue;
    out.push({ symbol, t: candles[i]!.closeTime, x, y: excess > 0 ? 1 : 0, excess });
  }
  return out;
}

/**
 * Sets each sample's label to "did better than the median coin sampled on the same day".
 * Comparing coins with each other removes the whole market's move, which no feature here can
 * predict reliably; what is left (which coins lead and which lag) is far more stable. Days with
 * fewer than `minPerDay` coins are dropped.
 */
export function labelAgainstMedian(samples: Sample[], minPerDay = 10): Sample[] {
  const byDay = new Map<number, Sample[]>();
  for (const s of samples) {
    const d = dayOf(s.t);
    const list = byDay.get(d);
    if (list) list.push(s);
    else byDay.set(d, [s]);
  }
  const out: Sample[] = [];
  for (const list of byDay.values()) {
    if (list.length < minPerDay) continue;
    const sorted = list.map((s) => s.excess).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    for (const s of list) out.push({ ...s, y: s.excess > median ? 1 : 0, excess: s.excess - median });
  }
  return out;
}

/** Features for the most recent closed candle, or null if the history is too short. */
export function latestFeatures(candles: Kline[], btc: BtcContext | null): number[] | null {
  const rows = featureRows(candles, btc);
  return rows[rows.length - 1] ?? null;
}
