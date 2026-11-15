import type { Kline } from "@/services/binance/schemas";
import { atr, bollinger, sma } from "@/services/indicators/core";
import type { Regime } from "@/services/market/direction";
import { exitStats, simulateExit, type ExitStats, type ExitTrade } from "./exit-backtest";
import { onsets, signalSeries } from "./signal-backtest";

/**
 * Complete strategies (an entry rule plus an exit rule) replayed on daily history. Pure.
 * Each trade is tagged with the market regime on its entry day, so every strategy also shows
 * when it worked: in up, sideways or down markets. Same caveats as the other backtests: coins
 * listed today only, daily closes, no fees or slippage.
 */
type Exit = "trend20" | "trend50" | "hold7" | "hold30" | "hold14_stop";

export const STRATEGIES = [
  {
    key: "breakout_trend",
    name: "Breakout, ride the trend",
    idea: "Buy strength: a close above the 90-day high, held for as long as the trend lasts.",
    entry: "Daily close above the highest high of the previous 90 days.",
    exit: "First daily close below the 20-day average; safety stop 3×ATR below entry.",
    exitRule: "trend20",
  },
  {
    key: "trend_follow",
    name: "Trend following",
    idea: "Own coins only while they are in a confirmed uptrend.",
    entry: "Price moves above its 20- and 50-day averages while the 50-day is above the 200-day.",
    exit: "First daily close below the 50-day average; safety stop 3×ATR below entry.",
    exitRule: "trend50",
  },
  {
    key: "golden_cross",
    name: "Golden cross",
    idea: "A long-term trend change: the 50-day average crosses above the 200-day.",
    entry: "50-day average crosses above the 200-day average.",
    exit: "First daily close below the 50-day average; safety stop 3×ATR below entry.",
    exitRule: "trend50",
  },
  {
    key: "volume_momentum",
    name: "Volume surge on an up day",
    idea: "Fresh buying interest: unusual volume while the price rises above its short-term average.",
    entry: "Volume at least 2× usual, the day closes higher than it opened and above the 20-day average.",
    exit: "First daily close below the 20-day average; safety stop 3×ATR below entry.",
    exitRule: "trend20",
  },
  {
    key: "rs_leader",
    name: "Relative-strength leader",
    idea: "Buy the coins that are beating Bitcoin and hold them while their trend lasts.",
    entry: "Beating BTC over 7 days and by 10%+ over 30 days, with the price above its 20-day average.",
    exit: "First daily close below the 20-day average; safety stop 3×ATR below entry.",
    exitRule: "trend20",
  },
  {
    key: "squeeze_breakout",
    name: "Volatility squeeze breakout",
    idea: "After an unusually quiet spell, join the move once it breaks upward.",
    entry: "A volatility squeeze in the last 5 days, then a daily close above the upper Bollinger Band.",
    exit: "First daily close below the 20-day average; safety stop 3×ATR below entry.",
    exitRule: "trend20",
  },
  {
    key: "dip_in_uptrend",
    name: "Dip in an uptrend",
    idea: "Buy a pullback inside a long-term uptrend, expecting the trend to resume.",
    entry: "50-day above 200-day, price above the 200-day, RSI(14) dips to 35–48.",
    exit: "Sell after 14 days; safety stop 3×ATR below entry.",
    exitRule: "hold14_stop",
  },
  {
    key: "fib_pullback",
    name: "Fibonacci pullback",
    idea: "After a strong rise, buy when half to two-thirds of it has been given back.",
    entry: "A 25%+ rise that peaked within 30 days, price back in the 0.5–0.618 retracement band.",
    exit: "Sell after 14 days; safety stop 3×ATR below entry.",
    exitRule: "hold14_stop",
  },
  {
    key: "oversold_bounce",
    name: "Oversold bounce",
    idea: "Buy the rebound after a washout.",
    entry: "RSI(14) fell to 30 or below in the last 10 days and has recovered to 40+.",
    exit: "Sell after 14 days; safety stop 3×ATR below entry.",
    exitRule: "hold14_stop",
  },
  {
    key: "buy_fear",
    name: "Buy extreme fear",
    idea: "Contrarian: buy when the whole market is frightened.",
    entry: "The Fear & Greed index drops to 25 or below.",
    exit: "Sell after 30 days. No stop.",
    exitRule: "hold30",
  },
  {
    key: "baseline",
    name: "Baseline: buy on any day",
    idea: "No strategy at all. Every other row should be judged against this one.",
    entry: "Every fifth day, whatever the market looks like.",
    exit: "Sell after 30 days. No stop.",
    exitRule: "hold30",
  },
] as const satisfies ReadonlyArray<{ key: string; name: string; idea: string; entry: string; exit: string; exitRule: Exit }>;
export type StrategyKey = (typeof STRATEGIES)[number]["key"];

interface Trade extends ExitTrade {
  day: number;
  /** BTC's return over the same holding period. */
  btcPercent: number | null;
}

const DAY = 86_400_000;
const dayOf = (t: number) => Math.floor(t / DAY);

function simulate(candles: Kline[], i: number, a: number, s20: Array<number | null>, s50: Array<number | null>, exit: Exit): ExitTrade | null {
  if (exit === "trend20" || exit === "hold7" || exit === "hold30") return simulateExit(candles, i, a, s20, exit);
  const entry = candles[i]!.close;
  if (!(entry > 0) || !(a > 0)) return null;
  const stop = entry - 3 * a;
  const maxHold = exit === "trend50" ? 120 : 14;
  for (let j = i + 1; j < candles.length; j++) {
    const c = candles[j]!;
    if (c.low <= stop) return { returnPercent: (Math.min(c.open, stop) / entry - 1) * 100, holdDays: j - i };
    if (exit === "trend50" && s50[j] != null && c.close < s50[j]!) return { returnPercent: (c.close / entry - 1) * 100, holdDays: j - i };
    if (j - i >= maxHold) return { returnPercent: (c.close / entry - 1) * 100, holdDays: j - i };
  }
  return null;
}

export interface StrategyResult {
  key: StrategyKey;
  overall: ExitStats | null;
  /** Average trade result minus BTC's return over the same days. */
  avgVsBtcPercent: number | null;
  byRegime: Record<Regime, ExitStats | null>;
  /** Coins whose entry rule fired on one of the last two completed days. */
  firingNow: string[];
}

export interface StrategyBacktest {
  pairs: number;
  from: number | null;
  to: number | null;
  results: StrategyResult[];
}

export function runStrategyBacktest(
  pairs: Array<{ symbol: string; candles: Kline[] }>,
  btc: Kline[] | null,
  regimeByDay: Map<number, Regime>,
  fearGreedByDay: Map<number, number>,
): StrategyBacktest {
  const btcByDay = btc ? new Map(btc.map((k) => [dayOf(k.openTime), k.close])) : null;
  const trades = new Map<StrategyKey, Trade[]>(STRATEGIES.map((s) => [s.key, []]));
  const firing = new Map<StrategyKey, string[]>(STRATEGIES.map((s) => [s.key, []]));
  let used = 0;
  let from: number | null = null;
  let to: number | null = null;

  for (const p of pairs) {
    const k = p.candles;
    const n = k.length;
    if (n < 260) continue;
    used++;
    from = from === null ? k[200]!.openTime : Math.min(from, k[200]!.openTime);
    to = to === null ? k[n - 1]!.closeTime : Math.max(to, k[n - 1]!.closeTime);
    const closes = k.map((x) => x.close);
    const a14 = atr(k, 14);
    const s20 = sma(closes, 20);
    const s50 = sma(closes, 50);
    const s200 = sma(closes, 200);
    const bb = bollinger(closes, 20, 2);
    const sig = signalSeries(k, btcByDay);
    const cond = (fn: (i: number) => boolean) => k.map((_, i) => i >= 200 && fn(i));
    const above = (i: number, line: Array<number | null>) => line[i] != null && closes[i]! > line[i]!;
    const recentSqueeze = (i: number) => {
      for (let j = Math.max(0, i - 5); j <= i; j++) if (sig.volatility_squeeze[j]) return true;
      return false;
    };
    const fearDay = (i: number) => {
      const v = fearGreedByDay.get(dayOf(k[i]!.openTime));
      return v !== undefined && v <= 25;
    };
    const baseline: number[] = [];
    for (let i = 200; i < n; i += 5) baseline.push(i);

    const entries: Record<StrategyKey, number[]> = {
      breakout_trend: onsets(sig.breakout),
      trend_follow: onsets(cond((i) => above(i, s20) && above(i, s50) && s50[i] != null && s200[i] != null && s50[i]! > s200[i]!)),
      golden_cross: onsets(sig.golden_cross),
      volume_momentum: onsets(cond((i) => sig.volume_surge[i]! && closes[i]! > k[i]!.open && above(i, s20))),
      rs_leader: onsets(cond((i) => sig.outperforming_btc[i]! && above(i, s20))),
      squeeze_breakout: onsets(cond((i) => recentSqueeze(i) && bb.upper[i] != null && closes[i]! > bb.upper[i]!)),
      dip_in_uptrend: onsets(sig.trend_pullback),
      fib_pullback: onsets(sig.fib_pullback),
      oversold_bounce: onsets(sig.oversold_bounce),
      buy_fear: onsets(cond(fearDay)),
      baseline,
    };

    for (const st of STRATEGIES) {
      const list = entries[st.key];
      if (st.key !== "baseline" && st.key !== "buy_fear" && list.some((i) => i >= n - 2)) firing.get(st.key)!.push(p.symbol);
      for (const i of list) {
        const a = a14[i];
        if (a == null) continue;
        const t = simulate(k, i, a, s20, s50, st.exitRule);
        if (!t) continue;
        const b0 = btcByDay?.get(dayOf(k[i]!.openTime));
        const b1 = btcByDay?.get(dayOf(k[Math.min(n - 1, i + t.holdDays)]!.openTime));
        trades.get(st.key)!.push({ ...t, day: dayOf(k[i]!.openTime), btcPercent: b0 && b1 ? (b1 / b0 - 1) * 100 : null });
      }
    }
  }

  return {
    pairs: used,
    from,
    to,
    results: STRATEGIES.map((st) => {
      const all = trades.get(st.key)!;
      const vs = all.filter((t) => t.btcPercent !== null);
      const regime = (r: Regime) => {
        const sel = all.filter((t) => regimeByDay.get(t.day) === r);
        return sel.length >= 20 ? exitStats(st.key, sel) : null;
      };
      return {
        key: st.key,
        overall: exitStats(st.key, all),
        avgVsBtcPercent: vs.length ? Math.round((vs.reduce((s, t) => s + (t.returnPercent - t.btcPercent!), 0) / vs.length) * 100) / 100 : null,
        byRegime: { up: regime("up"), sideways: regime("sideways"), down: regime("down") },
        firingNow: firing.get(st.key)!,
      };
    }),
  };
}

export type Verdict = "worked" | "mixed" | "lost" | "few";

/** Plain verdict from the trade statistics. */
export function verdictOf(s: ExitStats | null): Verdict {
  if (!s || s.trades < 30) return "few";
  if ((s.profitFactor ?? 0) >= 1.3 && s.avgReturnPercent > 0) return "worked";
  if ((s.profitFactor ?? 0) < 1 || s.avgReturnPercent < 0) return "lost";
  return "mixed";
}

/** Strategies ranked for a regime: by profit factor there, needing a real sample. */
export function bestFor(results: StrategyResult[], regime: Regime): StrategyResult[] {
  return results
    .filter((r) => r.key !== "baseline" && r.byRegime[regime] && r.byRegime[regime]!.trades >= 30)
    .sort((a, b) => (b.byRegime[regime]!.profitFactor ?? 0) - (a.byRegime[regime]!.profitFactor ?? 0));
}
