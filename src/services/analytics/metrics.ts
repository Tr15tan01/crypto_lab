/**
 * Pure performance metrics, unit-tested. Definitions are shown in the Analytics UI.
 */

export interface TxLike {
  id: string;
  type: "BUY" | "SELL";
  symbol: string;
  quantity: number;
  price: number;
  grossAmount: number;
  total: number;
  fee: number;
  realizedPnL?: number;
  costBasisSold?: number;
  timestamp: number;
}

export interface PositionRound {
  symbol: string;
  openedAt: number;
  closedAt: number | null;
  holdMs: number;
  buyCount: number;
  sellCount: number;
  invested: number; // sum of buy totals (incl. fees)
  proceeds: number; // sum of net sell proceeds
  realizedPnL: number;
  realizedReturnPercent: number | null; // realizedPnL / cost basis sold
  averageEntry: number; // quantity-weighted buy price
  averageExit: number | null; // quantity-weighted sell price
  buyIds: string[];
}

/** Groups trades into position "rounds": from the first buy (flat → long) until fully sold. */
export function positionRounds(txs: TxLike[], now = Date.now()): PositionRound[] {
  const sorted = [...txs].sort((a, b) => a.timestamp - b.timestamp);
  const open = new Map<string, PositionRound & { qty: number; buyQty: number; buyNotional: number; sellQty: number; sellNotional: number; basisSold: number }>();
  const done: PositionRound[] = [];

  for (const t of sorted) {
    let r = open.get(t.symbol);
    if (t.type === "BUY") {
      if (!r) {
        r = {
          symbol: t.symbol,
          openedAt: t.timestamp,
          closedAt: null,
          holdMs: 0,
          buyCount: 0,
          sellCount: 0,
          invested: 0,
          proceeds: 0,
          realizedPnL: 0,
          realizedReturnPercent: null,
          averageEntry: 0,
          averageExit: null,
          buyIds: [],
          qty: 0,
          buyQty: 0,
          buyNotional: 0,
          sellQty: 0,
          sellNotional: 0,
          basisSold: 0,
        };
        open.set(t.symbol, r);
      }
      r.buyCount++;
      r.invested += t.total;
      r.qty += t.quantity;
      r.buyQty += t.quantity;
      r.buyNotional += t.grossAmount;
      r.buyIds.push(t.id);
    } else if (r) {
      r.sellCount++;
      r.proceeds += t.total;
      r.realizedPnL += t.realizedPnL ?? 0;
      r.basisSold += t.costBasisSold ?? 0;
      r.qty -= t.quantity;
      r.sellQty += t.quantity;
      r.sellNotional += t.grossAmount;
      if (r.qty <= 1e-9) {
        r.closedAt = t.timestamp;
        done.push(finish(r, now));
        open.delete(t.symbol);
      }
    }
  }
  for (const r of open.values()) done.push(finish(r, now));
  return done.sort((a, b) => b.openedAt - a.openedAt);

  function finish(r: PositionRound & { buyQty: number; buyNotional: number; sellQty: number; sellNotional: number; basisSold: number }, at: number): PositionRound {
    return {
      symbol: r.symbol,
      openedAt: r.openedAt,
      closedAt: r.closedAt,
      holdMs: (r.closedAt ?? at) - r.openedAt,
      buyCount: r.buyCount,
      sellCount: r.sellCount,
      invested: r.invested,
      proceeds: r.proceeds,
      realizedPnL: r.realizedPnL,
      realizedReturnPercent: r.basisSold > 0 ? (r.realizedPnL / r.basisSold) * 100 : null,
      averageEntry: r.buyQty > 0 ? r.buyNotional / r.buyQty : 0,
      averageExit: r.sellQty > 0 ? r.sellNotional / r.sellQty : null,
      buyIds: r.buyIds,
    };
  }
}

export interface SellStats {
  count: number;
  wins: number;
  winRatePercent: number | null;
  averageReturnPercent: number | null;
  best: TxLike | null;
  worst: TxLike | null;
  totalRealized: number;
}

export function sellStats(txs: TxLike[]): SellStats {
  const sells = txs.filter((t) => t.type === "SELL" && t.realizedPnL !== undefined);
  const returns = sells
    .filter((s) => (s.costBasisSold ?? 0) > 0)
    .map((s) => (s.realizedPnL! / s.costBasisSold!) * 100);
  const sorted = [...sells].sort((a, b) => b.realizedPnL! - a.realizedPnL!);
  const wins = sells.filter((s) => s.realizedPnL! > 0).length;
  return {
    count: sells.length,
    wins,
    winRatePercent: sells.length ? (wins / sells.length) * 100 : null,
    averageReturnPercent: returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : null,
    best: sorted[0] ?? null,
    worst: sorted.length > 1 ? sorted[sorted.length - 1]! : null,
    totalRealized: sells.reduce((s, t) => s + t.realizedPnL!, 0),
  };
}

export interface Point {
  t: number;
  v: number;
}

/** Largest peak-to-trough decline, in percent (negative number) with its dates. */
export function maxDrawdown(series: Point[]): { percent: number; peakAt: number; troughAt: number } | null {
  if (series.length < 2) return null;
  let peak = series[0]!;
  let worst = { percent: 0, peakAt: peak.t, troughAt: peak.t };
  for (const p of series) {
    if (p.v > peak.v) peak = p;
    const dd = peak.v > 0 ? ((p.v - peak.v) / peak.v) * 100 : 0;
    if (dd < worst.percent) worst = { percent: dd, peakAt: peak.t, troughAt: p.t };
  }
  return worst;
}

/** Month-over-month change of portfolio value from snapshots (UTC months). */
export function monthlyReturns(series: Point[]): Array<{ month: string; startValue: number; endValue: number; returnPercent: number }> {
  if (series.length < 2) return [];
  const sorted = [...series].sort((a, b) => a.t - b.t);
  const byMonth = new Map<string, Point[]>();
  for (const p of sorted) {
    const d = new Date(p.t);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(p);
  }
  const months = [...byMonth.keys()];
  const out: Array<{ month: string; startValue: number; endValue: number; returnPercent: number }> = [];
  let prevEnd: number | null = null;
  for (const m of months) {
    const pts = byMonth.get(m)!;
    const start = prevEnd ?? pts[0]!.v;
    const end = pts[pts.length - 1]!.v;
    if (start > 0) out.push({ month: m, startValue: start, endValue: end, returnPercent: ((end - start) / start) * 100 });
    prevEnd = end;
  }
  return out;
}

/** Where a price sits in the prior high–low range (0 = at the low, 100 = at the high). */
export function rangePosition(price: number, highs: number[], lows: number[]): number | null {
  if (!highs.length || !lows.length) return null;
  const hi = Math.max(...highs);
  const lo = Math.min(...lows);
  if (hi <= lo) return null;
  return Math.min(100, Math.max(0, ((price - lo) / (hi - lo)) * 100));
}

/** Value of `amount` put into an asset at `startPrice`, priced along a close series. */
export function buyAndHoldSeries(amount: number, startPrice: number, closes: Point[]): Point[] {
  if (startPrice <= 0) return [];
  const units = amount / startPrice;
  return closes.map((c) => ({ t: c.t, v: units * c.v }));
}

/** Last value at or before t (series sorted ascending). */
export function valueAt(series: Point[], t: number): number | null {
  let lo = 0;
  let hi = series.length - 1;
  let ans: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid]!.t <= t) {
      ans = series[mid]!.v;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/* ───────────── Trade quality and "what works for you" ───────────── */

/** A position round with its result in percent (realised if closed, unrealised if open). */
export interface ScoredRound {
  symbol: string;
  openedAt: number;
  closedAt: number | null;
  holdMs: number;
  pnl: number;
  returnPercent: number | null;
}

export interface TradeQuality {
  closed: number;
  wins: number;
  losses: number;
  avgWinPercent: number | null;
  avgLossPercent: number | null;
  /** Average win ÷ average loss (size of wins vs losses). */
  payoffRatio: number | null;
  /** Gross profit ÷ gross loss: above 1 means the strategy made money. */
  profitFactor: number | null;
  /** Average P/L per closed round, in currency and percent. */
  expectancy: number | null;
  expectancyPercent: number | null;
  /** Win rate needed to break even at the current payoff ratio. */
  breakEvenWinRate: number | null;
  longestWinStreak: number;
  longestLossStreak: number;
}

export function tradeQuality(rounds: ScoredRound[]): TradeQuality {
  const closed = rounds.filter((r) => r.closedAt !== null).sort((a, b) => a.closedAt! - b.closedAt!);
  const wins = closed.filter((r) => r.pnl > 0);
  const losses = closed.filter((r) => r.pnl < 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const avgWin = mean(wins.map((r) => r.returnPercent).filter((v): v is number => v !== null));
  const avgLoss = mean(losses.map((r) => r.returnPercent).filter((v): v is number => v !== null));
  const grossWin = wins.reduce((s, r) => s + r.pnl, 0);
  const grossLoss = -losses.reduce((s, r) => s + r.pnl, 0);
  const payoff = avgWin !== null && avgLoss !== null && avgLoss < 0 ? avgWin / Math.abs(avgLoss) : null;
  let streak = 0;
  let bestW = 0;
  let bestL = 0;
  for (const r of closed) {
    if (r.pnl > 0) streak = streak > 0 ? streak + 1 : 1;
    else if (r.pnl < 0) streak = streak < 0 ? streak - 1 : -1;
    else streak = 0;
    bestW = Math.max(bestW, streak);
    bestL = Math.max(bestL, -streak);
  }
  return {
    closed: closed.length,
    wins: wins.length,
    losses: losses.length,
    avgWinPercent: avgWin,
    avgLossPercent: avgLoss,
    payoffRatio: payoff,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    expectancy: mean(closed.map((r) => r.pnl)),
    expectancyPercent: mean(closed.map((r) => r.returnPercent).filter((v): v is number => v !== null)),
    breakEvenWinRate: payoff !== null ? (1 / (1 + payoff)) * 100 : null,
    longestWinStreak: bestW,
    longestLossStreak: bestL,
  };
}

export interface Bucket {
  key: string;
  label: string;
  rounds: number;
  /** Share of rounds with a positive result (closed: realised; open: unrealised). */
  winRatePercent: number | null;
  avgReturnPercent: number | null;
  totalPnl: number;
}

/** Groups rounds into labelled buckets (in the given order); rounds mapped to null are skipped. */
export function bucketRounds(
  rounds: ScoredRound[],
  keyOf: (r: ScoredRound) => string | null,
  order: Array<{ key: string; label: string }>,
): Bucket[] {
  return order
    .map(({ key, label }) => {
      const sel = rounds.filter((r) => keyOf(r) === key);
      const rets = sel.map((r) => r.returnPercent).filter((v): v is number => v !== null);
      return {
        key,
        label,
        rounds: sel.length,
        winRatePercent: rets.length ? (rets.filter((v) => v > 0).length / rets.length) * 100 : null,
        avgReturnPercent: rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : null,
        totalPnl: sel.reduce((s, r) => s + r.pnl, 0),
      };
    })
    .filter((b) => b.rounds > 0);
}

export interface Insight {
  tone: "up" | "down" | "info";
  text: string;
}

/**
 * Plain-language takeaways: for each breakdown, the best and worst bucket when they differ
 * clearly and both have enough trades. Never more than a handful, strongest first.
 */
const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function insightsFrom(groups: Array<{ name: string; buckets: Bucket[] }>, minRounds = 3): Insight[] {
  const out: Array<Insight & { gap: number }> = [];
  for (const g of groups) {
    const usable = g.buckets.filter((b) => b.rounds >= minRounds && b.avgReturnPercent !== null);
    if (usable.length < 2) continue;
    const best = usable.reduce((a, b) => (b.avgReturnPercent! > a.avgReturnPercent! ? b : a));
    const worst = usable.reduce((a, b) => (b.avgReturnPercent! < a.avgReturnPercent! ? b : a));
    const gap = best.avgReturnPercent! - worst.avgReturnPercent!;
    if (gap < 2) continue;
    out.push({
      tone: "info",
      gap,
      text: `${g.name}: your trades ${lc(best.label)} averaged ${best.avgReturnPercent! >= 0 ? "+" : ""}${best.avgReturnPercent!.toFixed(1)}% (${best.rounds} trades) vs ${worst.avgReturnPercent! >= 0 ? "+" : ""}${worst.avgReturnPercent!.toFixed(1)}% ${lc(worst.label)} (${worst.rounds}).`,
    });
  }
  return out
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 6)
    .map((x) => ({ tone: x.tone, text: x.text }));
}
