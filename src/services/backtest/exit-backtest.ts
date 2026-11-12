import type { Kline } from "@/services/binance/schemas";
import { atr, sma } from "@/services/indicators/core";
import { BACKTEST_SIGNALS, onsets, signalSeries } from "./signal-backtest";

/**
 * Exit-rule backtest: the same entries, closed in different ways. Answers "once I am in, how
 * should I get out?" Entries are at the daily close of the signal day; exits are simulated on
 * the following daily candles. Conservative fills: when a candle touches both the stop and the
 * target, the stop is taken; a gap through the stop fills at the open.
 * No fees or slippage (they would lower every row, most for the rules that trade most often).
 */
export const EXIT_RULES = [
  { key: "hold7", label: "Sell after 7 days", detail: "No stop. Exit at the close 7 days later." },
  { key: "hold30", label: "Sell after 30 days", detail: "No stop. Exit at the close 30 days later." },
  { key: "stop_target", label: "Fixed stop and target", detail: "Stop 2×ATR below entry, target 4×ATR above (2:1). Out after 30 days at the latest." },
  { key: "trail3", label: "Trailing stop", detail: "Stop 3×ATR below the highest high since entry; it only moves up." },
  { key: "trend20", label: "Trend exit", detail: "Hard stop 3×ATR below entry; otherwise sell on the first daily close below the 20-day average." },
  { key: "be_trail", label: "Break-even, then trail", detail: "Stop 2×ATR below entry; moved to the entry price once +2×ATR is reached, then trails 3×ATR below the high." },
  { key: "scale_out", label: "Sell half at +2R, trail the rest", detail: "Stop 2×ATR. Half is sold at +4×ATR (2R); the stop moves to entry and the rest trails 3×ATR below the high." },
] as const;
export type ExitRule = (typeof EXIT_RULES)[number]["key"];

export const ENTRY_SETS = [
  { key: "breakout", label: "90-day high breakouts" },
  { key: "two_plus", label: "Two or more signals" },
  { key: "baseline", label: "Any day (baseline)" },
] as const;
export type EntrySet = (typeof ENTRY_SETS)[number]["key"];

const MAX_HOLD = 60;

export interface ExitTrade {
  returnPercent: number;
  holdDays: number;
}

/** Simulates one trade entered at the close of day `i`. Returns null if the data ends first. */
export function simulateExit(candles: Kline[], i: number, atrAtEntry: number, sma20: Array<number | null>, rule: ExitRule): ExitTrade | null {
  const entry = candles[i]!.close;
  if (!(entry > 0) || !(atrAtEntry > 0)) return null;
  const n = candles.length;
  const pct = (px: number) => (px / entry - 1) * 100;

  if (rule === "hold7" || rule === "hold30") {
    const d = rule === "hold7" ? 7 : 30;
    return i + d < n ? { returnPercent: pct(candles[i + d]!.close), holdDays: d } : null;
  }

  const R = 2 * atrAtEntry;
  let stop = rule === "trail3" || rule === "trend20" ? entry - 3 * atrAtEntry : entry - R;
  const target = rule === "stop_target" || rule === "scale_out" ? entry + 2 * R : null;
  const maxHold = rule === "stop_target" ? 30 : MAX_HOLD;
  let high = candles[i]!.high;
  let atBreakEven = false;
  /** Realised part for scale-out: return already banked on half the position. */
  let banked: number | null = null;

  for (let j = i + 1; j < n; j++) {
    const c = candles[j]!;
    const held = j - i;
    if (c.low <= stop) {
      const r = pct(Math.min(c.open, stop));
      return { returnPercent: banked !== null ? (banked + r) / 2 : r, holdDays: held };
    }
    if (target !== null && banked === null && c.high >= target) {
      if (rule === "stop_target") return { returnPercent: pct(target), holdDays: held };
      banked = pct(target);
      stop = Math.max(stop, entry);
      atBreakEven = true;
    }
    high = Math.max(high, c.high);
    if (rule === "trail3") stop = Math.max(stop, high - 3 * atrAtEntry);
    if (rule === "be_trail" || rule === "scale_out") {
      if (!atBreakEven && high >= entry + R) {
        stop = Math.max(stop, entry);
        atBreakEven = true;
      }
      if (atBreakEven) stop = Math.max(stop, high - 3 * atrAtEntry);
    }
    if (rule === "trend20" && sma20[j] != null && c.close < sma20[j]!) {
      return { returnPercent: pct(c.close), holdDays: held };
    }
    if (held >= maxHold) {
      const r = pct(c.close);
      return { returnPercent: banked !== null ? (banked + r) / 2 : r, holdDays: held };
    }
  }
  return null;
}

export interface ExitStats {
  rule: ExitRule;
  trades: number;
  winRatePercent: number;
  avgReturnPercent: number;
  medianReturnPercent: number;
  avgHoldDays: number;
  /** Average return divided by average days held: how hard the capital worked. */
  returnPerDayPercent: number;
  /** Total gains ÷ total losses. */
  profitFactor: number | null;
  /** 10th-percentile trade: a typical bad outcome. */
  p10ReturnPercent: number;
  worstReturnPercent: number;
}

function quantile(sorted: number[], q: number) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function exitStats(rule: ExitRule, trades: ExitTrade[]): ExitStats | null {
  if (!trades.length) return null;
  const rets = trades.map((t) => t.returnPercent);
  const sorted = [...rets].sort((a, b) => a - b);
  const avg = rets.reduce((a, b) => a + b, 0) / rets.length;
  const hold = trades.reduce((a, t) => a + t.holdDays, 0) / trades.length;
  const gains = rets.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const losses = -rets.filter((r) => r < 0).reduce((a, b) => a + b, 0);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    rule,
    trades: trades.length,
    winRatePercent: r2((rets.filter((r) => r > 0).length / rets.length) * 100),
    avgReturnPercent: r2(avg),
    medianReturnPercent: r2(quantile(sorted, 0.5)),
    avgHoldDays: r2(hold),
    returnPerDayPercent: hold > 0 ? Math.round((avg / hold) * 1000) / 1000 : 0,
    profitFactor: losses > 0 ? r2(gains / losses) : null,
    p10ReturnPercent: r2(quantile(sorted, 0.1)),
    worstReturnPercent: r2(sorted[0]!),
  };
}

export interface ExitBacktestResult {
  pairs: number;
  results: Array<{ entry: EntrySet; stats: ExitStats[] }>;
}

export function runExitBacktest(pairs: Array<{ symbol: string; candles: Kline[] }>, btc: Kline[] | null): ExitBacktestResult {
  const btcByDay = btc ? new Map(btc.map((k) => [Math.floor(k.openTime / 86_400_000), k.close])) : null;
  const buckets = new Map<string, ExitTrade[]>();
  const push = (entry: EntrySet, rule: ExitRule, t: ExitTrade) => {
    const k = `${entry}:${rule}`;
    const list = buckets.get(k);
    if (list) list.push(t);
    else buckets.set(k, [t]);
  };
  let used = 0;
  for (const p of pairs) {
    const k = p.candles;
    if (k.length < 260) continue;
    used++;
    const closes = k.map((x) => x.close);
    const a14 = atr(k, 14);
    const s20 = sma(closes, 20);
    const series = signalSeries(k, btcByDay);
    const multi = k.map((_, i) => BACKTEST_SIGNALS.filter((s) => series[s][i]).length >= 2);
    const baseline: number[] = [];
    for (let i = 200; i < k.length; i += 5) baseline.push(i);
    const entries: Record<EntrySet, number[]> = { breakout: onsets(series.breakout), two_plus: onsets(multi), baseline };
    for (const set of ENTRY_SETS) {
      for (const i of entries[set.key]) {
        const a = a14[i];
        if (a == null) continue;
        for (const rule of EXIT_RULES) {
          const t = simulateExit(k, i, a, s20, rule.key);
          if (t) push(set.key, rule.key, t);
        }
      }
    }
  }
  return {
    pairs: used,
    results: ENTRY_SETS.map((set) => ({
      entry: set.key,
      stats: EXIT_RULES.map((r) => exitStats(r.key, buckets.get(`${set.key}:${r.key}`) ?? [])).filter((s): s is ExitStats => s !== null),
    })),
  };
}
