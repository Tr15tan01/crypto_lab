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
