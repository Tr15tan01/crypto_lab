import type { Kline } from "@/services/binance/schemas";
import { ema, sma } from "@/services/indicators/core";

/**
 * Market direction: one score (−100 … +100) for "which way is the crypto market leaning",
 * built from BTC's trend and momentum, how many coins are in an uptrend (breadth), how altcoins
 * are doing, and mood. Pure and computed for every past day too, so the score comes with its own
 * track record: what BTC and the typical coin did after each kind of reading.
 */
const DAY = 86_400_000;
const dayOf = (t: number) => Math.floor(t / DAY);
const clamp = (v: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, v));

export const ZONES = [
  { key: "strong_up", label: "Strong uptrend", min: 50 },
  { key: "up", label: "Uptrend", min: 15 },
  { key: "sideways", label: "Sideways", min: -15 },
  { key: "down", label: "Downtrend", min: -50 },
  { key: "strong_down", label: "Strong downtrend", min: -Infinity },
] as const;
export type Zone = (typeof ZONES)[number]["key"];
export type Regime = "up" | "sideways" | "down";

export function zoneOf(score: number): Zone {
  return ZONES.find((z) => score >= z.min)!.key;
}
export function regimeOf(score: number): Regime {
  return score >= 15 ? "up" : score <= -15 ? "down" : "sideways";
}

export const COMPONENTS = [
  { key: "btcTrend", label: "BTC trend", weight: 0.3 },
  { key: "btcMomentum", label: "BTC momentum", weight: 0.2 },
  { key: "breadth50", label: "Coins above their 50-day average", weight: 0.2 },
  { key: "breadth20", label: "Coins above their 20-day average", weight: 0.1 },
  { key: "altStrength", label: "Typical coin, last 7 days", weight: 0.1 },
  { key: "mood", label: "Fear & Greed", weight: 0.1 },
] as const;
export type ComponentKey = (typeof COMPONENTS)[number]["key"];

export interface DirectionDay {
  t: number;
  score: number;
  /** Component scores (−1 … +1) in COMPONENTS order. */
  parts: number[];
  btcClose: number;
  facts: {
    aboveSma20: boolean;
    aboveSma50: boolean;
    aboveSma200: boolean;
    sma50AboveSma200: boolean;
    btcRet7: number;
    btcRet30: number;
    breadth50: number | null;
    breadth20: number | null;
    medianAltRet7: number | null;
    fearGreed: number | null;
  };
}

/** The score for every day that has enough history (200 BTC candles). */
export function directionSeries(btc: Kline[], universe: Array<{ candles: Kline[] }>, fearGreedByDay: Map<number, number>): DirectionDay[] {
  const closes = btc.map((k) => k.close);
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);

  // Market-wide facts per day.
  const acc = new Map<number, { n: number; above50: number; above20: number; r7: number[] }>();
  for (const p of universe) {
    const c = p.candles.map((k) => k.close);
    const a20 = sma(c, 20);
    const a50 = sma(c, 50);
    for (let i = 50; i < c.length; i++) {
      if (a50[i] == null || a20[i] == null || c[i - 7]! <= 0) continue;
      const d = dayOf(p.candles[i]!.openTime);
      let e = acc.get(d);
      if (!e) acc.set(d, (e = { n: 0, above50: 0, above20: 0, r7: [] }));
      e.n++;
      if (c[i]! > a50[i]!) e.above50++;
      if (c[i]! > a20[i]!) e.above20++;
      e.r7.push((c[i]! / c[i - 7]! - 1) * 100);
    }
  }

  const out: DirectionDay[] = [];
  for (let i = 200; i < btc.length; i++) {
    if (s20[i] == null || s50[i] == null || s200[i] == null) continue;
    const c = closes[i]!;
    const d = dayOf(btc[i]!.openTime);
    const m = acc.get(d);
    const breadth50 = m && m.n >= 15 ? m.above50 / m.n : null;
    const breadth20 = m && m.n >= 15 ? m.above20 / m.n : null;
    const medianAlt = m && m.r7.length >= 15 ? [...m.r7].sort((a, b) => a - b)[Math.floor(m.r7.length / 2)]! : null;
    const fng = fearGreedByDay.get(d) ?? fearGreedByDay.get(d - 1) ?? null;
    const ret7 = (c / closes[i - 7]! - 1) * 100;
    const ret30 = (c / closes[i - 30]! - 1) * 100;
    const facts = {
      aboveSma20: c > s20[i]!,
      aboveSma50: c > s50[i]!,
      aboveSma200: c > s200[i]!,
      sma50AboveSma200: s50[i]! > s200[i]!,
      btcRet7: ret7,
      btcRet30: ret30,
      breadth50,
      breadth20,
      medianAltRet7: medianAlt,
      fearGreed: fng,
    };
    const sign = (b: boolean) => (b ? 1 : -1);
    const parts = [
      (sign(facts.aboveSma20) + sign(facts.aboveSma50) + sign(facts.aboveSma200) + sign(facts.sma50AboveSma200)) / 4,
      0.5 * clamp(ret7 / 8) + 0.5 * clamp(ret30 / 20),
      breadth50 === null ? 0 : (breadth50 - 0.5) * 2,
      breadth20 === null ? 0 : (breadth20 - 0.5) * 2,
      medianAlt === null ? 0 : clamp(medianAlt / 10),
      fng === null ? 0 : clamp((fng - 50) / 40),
    ];
    const score = Math.round(100 * parts.reduce((s, v, j) => s + v * COMPONENTS[j]!.weight, 0));
    out.push({ t: btc[i]!.openTime, score, parts, btcClose: c, facts });
  }
  return out;
}

export interface ZoneHistory {
  zone: Zone;
  days: number;
  /** BTC over the following 7 / 30 days. */
  btc7: { upPercent: number; medianPercent: number } | null;
  btc30: { upPercent: number; medianPercent: number } | null;
  /** The typical (median) coin over the following 7 / 30 days. */
  alt7: { upPercent: number; medianPercent: number } | null;
  alt30: { upPercent: number; medianPercent: number } | null;
}

function summary(values: number[]) {
  if (values.length < 10) return null;
  const s = [...values].sort((a, b) => a - b);
  return {
    upPercent: Math.round((values.filter((v) => v > 0).length / values.length) * 1000) / 10,
    medianPercent: Math.round(s[Math.floor(s.length / 2)]! * 100) / 100,
  };
}

/**
 * What followed each kind of reading. Consecutive days overlap heavily, so "days" overstates
 * the amount of independent evidence; treat the table as a description, not a guarantee.
 */
export function zoneHistory(series: DirectionDay[], btc: Kline[], universe: Array<{ candles: Kline[] }>): ZoneHistory[] {
  const btcByDay = new Map(btc.map((k) => [dayOf(k.openTime), k.close]));
  // Median coin forward return per day and horizon.
  const fwd = new Map<number, { r7: number[]; r30: number[] }>();
  for (const p of universe) {
    const c = p.candles.map((k) => k.close);
    for (let i = 0; i < c.length; i++) {
      if (c[i]! <= 0) continue;
      const d = dayOf(p.candles[i]!.openTime);
      let e = fwd.get(d);
      if (!e) fwd.set(d, (e = { r7: [], r30: [] }));
      if (i + 7 < c.length) e.r7.push((c[i + 7]! / c[i]! - 1) * 100);
      if (i + 30 < c.length) e.r30.push((c[i + 30]! / c[i]! - 1) * 100);
    }
  }
  const median = (a: number[]) => (a.length >= 15 ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : null);

  return ZONES.map(({ key }) => {
    const days = series.filter((d) => zoneOf(d.score) === key);
    const b7: number[] = [];
    const b30: number[] = [];
    const a7: number[] = [];
    const a30: number[] = [];
    for (const d of days) {
      const day = dayOf(d.t);
      const now = btcByDay.get(day);
      const in7 = btcByDay.get(day + 7);
      const in30 = btcByDay.get(day + 30);
      if (now && in7) b7.push((in7 / now - 1) * 100);
      if (now && in30) b30.push((in30 / now - 1) * 100);
      const f = fwd.get(day);
      const m7 = f ? median(f.r7) : null;
      const m30 = f ? median(f.r30) : null;
      if (m7 !== null) a7.push(m7);
      if (m30 !== null) a30.push(m30);
    }
    return { zone: key, days: days.length, btc7: summary(b7), btc30: summary(b30), alt7: summary(a7), alt30: summary(a30) };
  });
}

export interface TimeframeTrend {
  interval: "4h" | "1d" | "1w";
  /** −3 … +3: price vs EMA20, EMA20 vs EMA50, MACD direction. */
  score: number;
  direction: "up" | "down" | "flat";
}

/** Trend of one timeframe from its closes: price vs EMA 20, EMA 20 vs EMA 50, MACD histogram sign. */
export function timeframeTrend(interval: TimeframeTrend["interval"], closes: number[], price: number): TimeframeTrend | null {
  if (closes.length < 55) return null;
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const n = closes.length - 1;
  if (e20[n] == null || e50[n] == null || e12[n] == null || e26[n] == null) return null;
  const macdLine = closes.map((_, i) => (e12[i] != null && e26[i] != null ? e12[i]! - e26[i]! : null)).filter((v): v is number => v !== null);
  const signal = ema(macdLine, 9);
  const hist = signal[signal.length - 1] != null ? macdLine[macdLine.length - 1]! - signal[signal.length - 1]! : 0;
  const score = (price > e20[n]! ? 1 : -1) + (e20[n]! > e50[n]! ? 1 : -1) + (hist > 0 ? 1 : hist < 0 ? -1 : 0);
  return { interval, score, direction: score >= 2 ? "up" : score <= -2 ? "down" : "flat" };
}
