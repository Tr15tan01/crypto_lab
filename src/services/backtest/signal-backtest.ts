import type { Kline } from "@/services/binance/schemas";
import { bollinger, rsi, sma } from "@/services/indicators/core";
import { THRESHOLDS, type DiscoverySignal } from "@/services/discovery/signals";
import { isFibPullback } from "@/services/indicators/fibonacci";

/**
 * Historical test of the discovery signals: on every past day where a signal *started* firing,
 * what did the pair do over the next 7 and 30 days, in absolute terms and relative to BTC?
 * Pure and vectorised (each indicator series is computed once per pair), so it is unit-tested.
 *
 * Known biases, shown in the UI: only pairs listed today are tested (survivorship), entries
 * are at the daily close with no fees or slippage, and events on different pairs on the same
 * day are correlated.
 */
export const BACKTEST_SIGNALS = [
  "volume_surge",
  "outperforming_btc",
  "golden_cross",
  "oversold_bounce",
  "breakout",
  "volatility_squeeze",
  "trend_pullback",
  "accumulation",
  "fib_pullback",
] as const satisfies readonly DiscoverySignal[];
export type BacktestSignal = (typeof BACKTEST_SIGNALS)[number];
export type BacktestKey = BacktestSignal | "two_plus" | "baseline";

export const HORIZONS = [7, 30] as const;
/** A signal must have been off for this many days before a new event is counted. */
const COOLDOWN_DAYS = 5;
const WARMUP = 200;

export interface HorizonStats {
  horizonDays: number;
  events: number;
  winRatePercent: number;
  medianReturnPercent: number;
  meanReturnPercent: number;
  /** Mean of (pair return − BTC return) over the same windows. */
  meanVsBtcPercent: number;
  /** t-statistic of the vs-BTC excess; |t| ≥ 2 is conventionally "significant". */
  tStat: number;
  p10ReturnPercent: number;
  p90ReturnPercent: number;
}

export interface SignalResult {
  key: BacktestKey;
  stats: HorizonStats[];
}

interface EventSample {
  ret: Record<number, number>;
  vsBtc: Record<number, number>;
}

function quantile(sorted: number[], q: number) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function median(values: number[]) {
  return values.length ? quantile([...values].sort((a, b) => a - b), 0.5) : 0;
}

export function summarize(samples: EventSample[], horizonDays: number): HorizonStats | null {
  const rets = samples.map((s) => s.ret[horizonDays]).filter((v): v is number => v !== undefined);
  const ex = samples.map((s) => s.vsBtc[horizonDays]).filter((v): v is number => v !== undefined);
  if (rets.length === 0) return null;
  const sorted = [...rets].sort((a, b) => a - b);
  const meanEx = ex.length ? ex.reduce((a, b) => a + b, 0) / ex.length : 0;
  const sd = ex.length > 1 ? Math.sqrt(ex.reduce((a, b) => a + (b - meanEx) ** 2, 0) / (ex.length - 1)) : 0;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    horizonDays,
    events: rets.length,
    winRatePercent: r2((rets.filter((r) => r > 0).length / rets.length) * 100),
    medianReturnPercent: r2(quantile(sorted, 0.5)),
    meanReturnPercent: r2(rets.reduce((a, b) => a + b, 0) / rets.length),
    meanVsBtcPercent: r2(meanEx),
    tStat: sd > 0 ? r2(meanEx / (sd / Math.sqrt(ex.length))) : 0,
    p10ReturnPercent: r2(quantile(sorted, 0.1)),
    p90ReturnPercent: r2(quantile(sorted, 0.9)),
  };
}

/** Per-day boolean series for every backtested signal. Index-aligned with `candles`. */
export function signalSeries(candles: Kline[], btcCloseByDay: Map<number, number> | null): Record<BacktestSignal, boolean[]> {
  const n = candles.length;
  const closes = candles.map((k) => k.close);
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  const r14 = rsi(closes, 14);
  const bb = bollinger(closes, 20, 2);
  const width = closes.map((_, i) => {
    const u = bb.upper[i];
    const l = bb.lower[i];
    const m = bb.middle[i];
    return u != null && l != null && m != null && m > 0 ? (u - l) / m : null;
  });
  const out = Object.fromEntries(BACKTEST_SIGNALS.map((s) => [s, new Array<boolean>(n).fill(false)])) as Record<BacktestSignal, boolean[]>;

  const day = (i: number) => Math.floor(candles[i]!.openTime / 86_400_000);
  const ret = (i: number, d: number) => (i - d >= 0 && closes[i - d]! > 0 ? (closes[i]! / closes[i - d]! - 1) * 100 : null);
  const btcRet = (i: number, d: number) => {
    if (!btcCloseByDay || i - d < 0) return null;
    const a = btcCloseByDay.get(day(i - d));
    const b = btcCloseByDay.get(day(i));
    return a && b ? (b / a - 1) * 100 : null;
  };

  let lastCross = -Infinity;
  for (let i = 1; i < n; i++) {
    const c = closes[i]!;
    // Golden cross bookkeeping runs on every day so the lookback is right from the warm-up on.
    if (s50[i] != null && s200[i] != null && s50[i - 1] != null && s200[i - 1] != null && s50[i]! > s200[i]! && s50[i - 1]! <= s200[i - 1]!) {
      lastCross = i;
    }
    if (i < WARMUP) continue;

    const qv = candles.slice(i - 30, i).map((k) => k.quoteVolume);
    const usual = median(qv);
    if (usual > 0 && candles[i]!.quoteVolume / usual >= THRESHOLDS.volumeSurgeRatio) out.volume_surge[i] = true;

    const r7 = ret(i, 7);
    const r30 = ret(i, 30);
    const b7 = btcRet(i, 7);
    const b30 = btcRet(i, 30);
    if (r7 !== null && r30 !== null && b7 !== null && b30 !== null) {
      const rel7 = ((1 + r7 / 100) / (1 + b7 / 100) - 1) * 100;
      const rel30 = ((1 + r30 / 100) / (1 + b30 / 100) - 1) * 100;
      if (rel7 > 0 && rel30 >= THRESHOLDS.outperform30dPercent) out.outperforming_btc[i] = true;
    }

    if (s50[i] != null && s200[i] != null && s50[i]! > s200[i]! && i - lastCross <= THRESHOLDS.crossLookbackDays) out.golden_cross[i] = true;

    const recentRsi = r14.slice(i - THRESHOLDS.bounceLookbackDays, i).filter((v): v is number => v !== null);
    if (recentRsi.length && r14[i] != null && Math.min(...recentRsi) <= THRESHOLDS.oversoldRsi && r14[i]! >= THRESHOLDS.bounceRsi) {
      out.oversold_bounce[i] = true;
    }

    let high90 = -Infinity;
    for (let j = i - THRESHOLDS.breakoutDays; j < i; j++) high90 = Math.max(high90, candles[j]!.high);
    if (c > high90) out.breakout[i] = true;

    const w = width[i];
    if (w != null) {
      const win = width.slice(Math.max(0, i - THRESHOLDS.squeezeLookbackDays + 1), i + 1).filter((v): v is number => v !== null);
      if (win.length >= THRESHOLDS.squeezeLookbackDays * 0.8) {
        const pct = (win.filter((v) => v < w).length / (win.length - 1)) * 100;
        if (pct <= THRESHOLDS.squeezePercentile) out.volatility_squeeze[i] = true;
      }
    }

    if (s50[i] != null && s200[i] != null && s50[i]! > s200[i]! && c > s200[i]! && r14[i] != null && r14[i]! >= THRESHOLDS.pullbackRsiLow && r14[i]! <= THRESHOLDS.pullbackRsiHigh) {
      out.trend_pullback[i] = true;
    }

    if (
      isFibPullback(candles, i, c, {
        lookback: THRESHOLDS.fibLookbackDays,
        minSwingPercent: THRESHOLDS.fibMinSwingPercent,
        maxDaysSinceHigh: THRESHOLDS.fibMaxDaysSinceHigh,
      })
    ) {
      out.fib_pullback[i] = true;
    }

    const d = THRESHOLDS.accumulationDays;
    let flow = 0;
    let total = 0;
    for (let j = i - d + 1; j <= i; j++) {
      flow += Math.sign(closes[j]! - closes[j - 1]!) * candles[j]!.volume;
      total += candles[j]!.volume;
    }
    const move = ret(i, d);
    if (total > 0 && move !== null && flow / total >= THRESHOLDS.accumulationFlow && Math.abs(move) < THRESHOLDS.accumulationMaxMovePercent) {
      out.accumulation[i] = true;
    }
  }
  return out;
}

/** Index of each new event: the signal fires and has been off for the cooldown. */
export function onsets(series: boolean[]): number[] {
  const out: number[] = [];
  let lastOn = -Infinity;
  for (let i = 0; i < series.length; i++) {
    if (!series[i]) continue;
    if (i - lastOn > COOLDOWN_DAYS) out.push(i);
    lastOn = i;
  }
  return out;
}

export interface PairInput {
  symbol: string;
  candles: Kline[];
}

export interface BacktestResult {
  pairs: number;
  from: number | null;
  to: number | null;
  results: SignalResult[];
}

export function runBacktest(pairs: PairInput[], btc: Kline[] | null): BacktestResult {
  const btcByDay = btc ? new Map(btc.map((k) => [Math.floor(k.openTime / 86_400_000), k.close])) : null;
  const buckets = new Map<BacktestKey, EventSample[]>();
  const push = (k: BacktestKey, s: EventSample) => {
    const list = buckets.get(k);
    if (list) list.push(s);
    else buckets.set(k, [s]);
  };
  let from: number | null = null;
  let to: number | null = null;

  for (const p of pairs) {
    const k = p.candles;
    if (k.length < WARMUP + 10) continue;
    const closes = k.map((x) => x.close);
    const sample = (i: number): EventSample => {
      const s: EventSample = { ret: {}, vsBtc: {} };
      for (const h of HORIZONS) {
        if (i + h >= k.length) continue;
        const r = (closes[i + h]! / closes[i]! - 1) * 100;
        s.ret[h] = r;
        const a = btcByDay?.get(Math.floor(k[i]!.openTime / 86_400_000));
        const b = btcByDay?.get(Math.floor(k[i + h]!.openTime / 86_400_000));
        if (a && b) s.vsBtc[h] = r - (b / a - 1) * 100;
      }
      return s;
    };
    const series = signalSeries(k, btcByDay);
    for (const sig of BACKTEST_SIGNALS) for (const i of onsets(series[sig])) push(sig, sample(i));
    // Two or more signals on the same day (the "Top signals" screen).
    const multi = k.map((_, i) => BACKTEST_SIGNALS.filter((s) => series[s][i]).length >= 2);
    for (const i of onsets(multi)) push("two_plus", sample(i));
    // Baseline: every 5th day after warm-up, i.e. "buy a random liquid coin".
    for (let i = WARMUP; i < k.length; i += COOLDOWN_DAYS) push("baseline", sample(i));
    from = from === null ? k[WARMUP]!.openTime : Math.min(from, k[WARMUP]!.openTime);
    to = to === null ? k[k.length - 1]!.closeTime : Math.max(to, k[k.length - 1]!.closeTime);
  }

  const keys: BacktestKey[] = [...BACKTEST_SIGNALS, "two_plus", "baseline"];
  return {
    pairs: pairs.filter((p) => p.candles.length >= WARMUP + 10).length,
    from,
    to,
    results: keys.map((key) => ({
      key,
      stats: HORIZONS.map((h) => summarize(buckets.get(key) ?? [], h)).filter((s): s is HorizonStats => s !== null),
    })),
  };
}

/** Edge a signal has shown over 7 days vs BTC, used by Autopilot; null when the sample is too small. */
export function signalEdge(result: BacktestResult | null, key: BacktestSignal): { edge: number; tStat: number; events: number } | null {
  const s = result?.results.find((r) => r.key === key)?.stats.find((x) => x.horizonDays === 7);
  if (!s || s.events < 30) return null;
  return { edge: s.meanVsBtcPercent, tStat: s.tStat, events: s.events };
}
