/**
 * Pure performance metrics for tracked traders. No I/O, so every number on the traders pages
 * is unit-tested. Equity is a daily series of portfolio values (any unit: a multiple of the
 * starting capital works as well as dollars).
 */
const DAY = 86_400_000;

export interface EquityPoint {
  t: number;
  v: number;
}

export interface TradeLike {
  symbol: string;
  side: "long" | "short";
  leverage: number | null;
  openedAt: number;
  closedAt: number | null;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number | null;
  pnl: number | null;
}

export interface ReturnMetrics {
  dailyReturnPercent: number | null;
  weeklyReturnPercent: number | null;
  monthlyReturnPercent: number | null;
  totalReturnPercent: number | null;
  maxDrawdownPercent: number | null;
  /** Share of days that closed up. */
  upDaysPercent: number | null;
  /** Daily returns, for charts. */
  daily: Array<{ t: number; returnPercent: number }>;
}

/** Converts Binance's cumulative ROI series (percent of starting capital) into equity multiples. */
export function equityFromRoi(series: Array<{ t: number; roi: number }>): EquityPoint[] {
  return series
    .filter((p) => Number.isFinite(p.roi) && p.roi > -100)
    .sort((a, b) => a.t - b.t)
    .map((p) => ({ t: p.t, v: 1 + p.roi / 100 }));
}

/** Value at the last point at or before `t`. */
function valueAt(points: EquityPoint[], t: number): number | null {
  let out: number | null = null;
  for (const p of points) {
    if (p.t <= t) out = p.v;
    else break;
  }
  return out;
}

function change(from: number | null, to: number | null): number | null {
  return from === null || to === null || from <= 0 ? null : (to / from - 1) * 100;
}

export function maxDrawdownPercent(points: EquityPoint[]): number | null {
  if (points.length < 2) return null;
  let peak = points[0]!.v;
  let worst = 0;
  for (const p of points) {
    peak = Math.max(peak, p.v);
    if (peak > 0) worst = Math.min(worst, (p.v / peak - 1) * 100);
  }
  return -worst;
}

export function returnMetrics(points: EquityPoint[]): ReturnMetrics {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const empty: ReturnMetrics = {
    dailyReturnPercent: null,
    weeklyReturnPercent: null,
    monthlyReturnPercent: null,
    totalReturnPercent: null,
    maxDrawdownPercent: null,
    upDaysPercent: null,
    daily: [],
  };
  if (sorted.length < 2) return empty;
  const lastP = sorted[sorted.length - 1]!;
  const first = sorted[0]!;
  const daily: ReturnMetrics["daily"] = [];
  for (let i = 1; i < sorted.length; i++) {
    const r = change(sorted[i - 1]!.v, sorted[i]!.v);
    if (r !== null) daily.push({ t: sorted[i]!.t, returnPercent: r });
  }
  const span = lastP.t - first.t;
  return {
    dailyReturnPercent: daily.length ? daily[daily.length - 1]!.returnPercent : null,
    weeklyReturnPercent: span >= 7 * DAY - DAY / 2 ? change(valueAt(sorted, lastP.t - 7 * DAY), lastP.v) : null,
    monthlyReturnPercent: span >= 30 * DAY - DAY / 2 ? change(valueAt(sorted, lastP.t - 30 * DAY), lastP.v) : null,
    totalReturnPercent: change(first.v, lastP.v),
    maxDrawdownPercent: maxDrawdownPercent(sorted),
    upDaysPercent: daily.length ? (daily.filter((d) => d.returnPercent > 0).length / daily.length) * 100 : null,
    daily,
  };
}

/** Realised P&L of a closed trade when the quantity is known (linear, before fees). */
export function tradePnl(t: TradeLike): number | null {
  if (t.pnl !== null) return t.pnl;
  if (t.exitPrice === null || t.quantity === null) return null;
  const dir = t.side === "long" ? 1 : -1;
  return (t.exitPrice - t.entryPrice) * t.quantity * dir;
}

/** Return on the position's own price move (× leverage when known), in percent. */
export function tradeReturnPercent(t: TradeLike): number | null {
  if (t.exitPrice === null || t.entryPrice <= 0) return null;
  const dir = t.side === "long" ? 1 : -1;
  return ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100 * dir * (t.leverage ?? 1);
}

/**
 * Equity for a manually tracked trader: starting capital plus realised P&L, by close day.
 * Open trades are not marked to market (their outcome is unknown until closed).
 */
export function equityFromTrades(startingValue: number, trades: TradeLike[], now = Date.now()): EquityPoint[] {
  const closed = trades
    .filter((t) => t.closedAt !== null && tradePnl(t) !== null)
    .sort((a, b) => a.closedAt! - b.closedAt!);
  const firstOpen = trades.length ? Math.min(...trades.map((t) => t.openedAt)) : now;
  const startDay = Math.floor(firstOpen / DAY) * DAY;
  const endDay = Math.floor(now / DAY) * DAY;
  const points: EquityPoint[] = [];
  let equity = startingValue;
  let i = 0;
  for (let d = startDay; d <= endDay && points.length < 3650; d += DAY) {
    while (i < closed.length && closed[i]!.closedAt! < d + DAY) equity += tradePnl(closed[i++]!)!;
    points.push({ t: d, v: equity });
  }
  return points;
}

export interface CoinActivity {
  symbol: string;
  trades: number;
  longs: number;
  shorts: number;
  open: number;
  pnl: number | null;
  winRatePercent: number | null;
  avgHoldingHours: number | null;
}

export interface TradeStats {
  trades: number;
  closed: number;
  open: number;
  winRatePercent: number | null;
  avgHoldingHours: number | null;
  medianHoldingHours: number | null;
  avgLeverage: number | null;
  longSharePercent: number | null;
  coins: CoinActivity[];
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export function holdingHours(t: TradeLike, now = Date.now()): number {
  return ((t.closedAt ?? now) - t.openedAt) / 3_600_000;
}

export function tradeStats(trades: TradeLike[], now = Date.now()): TradeStats {
  const closed = trades.filter((t) => t.closedAt !== null);
  const outcomes = closed.map(tradePnl).filter((p): p is number => p !== null);
  const holds = closed.map((t) => holdingHours(t, now));
  const leverages = trades.map((t) => t.leverage).filter((l): l is number => l !== null && l > 0);

  const bySymbol = new Map<string, TradeLike[]>();
  for (const t of trades) bySymbol.set(t.symbol, [...(bySymbol.get(t.symbol) ?? []), t]);
  const coins: CoinActivity[] = [...bySymbol.entries()].map(([symbol, list]) => {
    const c = list.filter((t) => t.closedAt !== null);
    const pnls = c.map(tradePnl).filter((p): p is number => p !== null);
    return {
      symbol,
      trades: list.length,
      longs: list.filter((t) => t.side === "long").length,
      shorts: list.filter((t) => t.side === "short").length,
      open: list.length - c.length,
      pnl: pnls.length ? pnls.reduce((a, b) => a + b, 0) : null,
      winRatePercent: pnls.length ? (pnls.filter((p) => p > 0).length / pnls.length) * 100 : null,
      avgHoldingHours: mean(c.map((t) => holdingHours(t, now))),
    };
  });
  coins.sort((a, b) => b.trades - a.trades || (b.pnl ?? 0) - (a.pnl ?? 0));

  return {
    trades: trades.length,
    closed: closed.length,
    open: trades.length - closed.length,
    winRatePercent: outcomes.length ? (outcomes.filter((p) => p > 0).length / outcomes.length) * 100 : null,
    avgHoldingHours: mean(holds),
    medianHoldingHours: median(holds),
    avgLeverage: mean(leverages),
    longSharePercent: trades.length ? (trades.filter((t) => t.side === "long").length / trades.length) * 100 : null,
    coins,
  };
}

export interface StrategyChange {
  status: "changing" | "stable" | "insufficient_data";
  /** 0 … 100: how many of the tracked dimensions shifted, weighted. */
  score: number;
  changes: string[];
  window: { recentDays: number; recentTrades: number; baselineTrades: number };
}

const RECENT_DAYS = 14;
const BASELINE_DAYS = 90;
const MIN_TRADES = 3;

/**
 * Compares the last 14 days of trading with the 14–90 days before on five dimensions:
 * holding time, leverage, long/short mix, trade frequency, and which coins are traded.
 */
export function detectStrategyChange(trades: TradeLike[], now = Date.now()): StrategyChange {
  const split = now - RECENT_DAYS * DAY;
  const recent = trades.filter((t) => t.openedAt >= split);
  const baseline = trades.filter((t) => t.openedAt < split && t.openedAt >= now - BASELINE_DAYS * DAY);
  const window = { recentDays: RECENT_DAYS, recentTrades: recent.length, baselineTrades: baseline.length };
  if (recent.length < MIN_TRADES || baseline.length < MIN_TRADES) {
    return { status: "insufficient_data", score: 0, changes: [], window };
  }

  const changes: string[] = [];
  let score = 0;

  const holdR = median(recent.map((t) => holdingHours(t, now)));
  const holdB = median(baseline.map((t) => holdingHours(t, now)));
  if (holdR !== null && holdB !== null && holdB > 0) {
    const ratio = holdR / holdB;
    if (ratio >= 2 || ratio <= 0.5) {
      score += 25;
      changes.push(`Holding time ${ratio >= 2 ? "longer" : "shorter"}: median ${fmtHours(holdR)} now vs ${fmtHours(holdB)} before.`);
    }
  }

  const levR = mean(recent.map((t) => t.leverage).filter((l): l is number => l !== null));
  const levB = mean(baseline.map((t) => t.leverage).filter((l): l is number => l !== null));
  if (levR !== null && levB !== null && levB > 0 && Math.abs(levR / levB - 1) >= 0.5) {
    score += 20;
    changes.push(`Leverage ${levR > levB ? "up" : "down"}: average ${levR.toFixed(1)}× now vs ${levB.toFixed(1)}× before.`);
  }

  const longR = (recent.filter((t) => t.side === "long").length / recent.length) * 100;
  const longB = (baseline.filter((t) => t.side === "long").length / baseline.length) * 100;
  if (Math.abs(longR - longB) >= 30) {
    score += 20;
    changes.push(`Direction mix shifted: ${longR.toFixed(0)}% longs now vs ${longB.toFixed(0)}% before.`);
  }

  const baselineDays = BASELINE_DAYS - RECENT_DAYS;
  const freqR = recent.length / RECENT_DAYS;
  const freqB = baseline.length / baselineDays;
  if (freqB > 0 && (freqR / freqB >= 2 || freqR / freqB <= 0.5)) {
    score += 15;
    changes.push(`Trading ${freqR > freqB ? "more" : "less"} often: ${(freqR * 7).toFixed(1)} trades/week now vs ${(freqB * 7).toFixed(1)} before.`);
  }

  const coinsR = new Set(recent.map((t) => t.symbol));
  const coinsB = new Set(baseline.map((t) => t.symbol));
  const overlap = [...coinsR].filter((c) => coinsB.has(c)).length;
  const jaccard = overlap / new Set([...coinsR, ...coinsB]).size;
  if (jaccard < 0.2) {
    score += 20;
    const fresh = [...coinsR].filter((c) => !coinsB.has(c)).slice(0, 4);
    changes.push(`Trading different coins: ${Math.round(jaccard * 100)}% overlap with before${fresh.length ? ` (new: ${fresh.join(", ")})` : ""}.`);
  }

  return { status: score >= 35 ? "changing" : "stable", score, changes, window };
}

function fmtHours(h: number) {
  return h >= 48 ? `${(h / 24).toFixed(1)}d` : `${h.toFixed(h < 10 ? 1 : 0)}h`;
}

export interface CsvTrade {
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  exitPrice: number | null;
  quantity: number | null;
  leverage: number | null;
  openedAt: number;
  closedAt: number | null;
  pnl: number | null;
}

/**
 * Parses pasted CSV with a header row. Required columns: symbol, side, entry, opened.
 * Optional: exit, quantity, leverage, closed, pnl. Side accepts buy/long or sell/short.
 * Returns parsed rows plus per-line errors (bad lines are skipped, never guessed at).
 */
export function parseTradesCsv(text: string): { trades: CsvTrade[]; errors: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { trades: [], errors: ["Paste a header row and at least one trade."] };
  const sep = lines[0]!.includes(";") && !lines[0]!.includes(",") ? ";" : lines[0]!.includes("\t") ? "\t" : ",";
  const header = lines[0]!.split(sep).map((h) => h.trim().toLowerCase().replace(/[^a-z]/g, ""));
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const idx = {
    symbol: col("symbol", "pair", "coin"),
    side: col("side", "type", "direction"),
    entry: col("entry", "entryprice", "buyprice", "open", "openprice"),
    exit: col("exit", "exitprice", "sellprice", "close", "closeprice"),
    qty: col("quantity", "qty", "amount", "size"),
    lev: col("leverage", "lev"),
    opened: col("opened", "openedat", "opentime", "entrytime", "date", "time"),
    closed: col("closed", "closedat", "closetime", "exittime"),
    pnl: col("pnl", "profit", "realizedpnl"),
  };
  const missing = (["symbol", "side", "entry", "opened"] as const).filter((k) => idx[k] < 0);
  if (missing.length) return { trades: [], errors: [`Missing column(s): ${missing.join(", ")}.`] };

  const trades: CsvTrade[] = [];
  const errors: string[] = [];
  const numAt = (cells: string[], i: number) => {
    if (i < 0 || !cells[i]) return null;
    const n = Number(cells[i]!.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : NaN;
  };
  const dateAt = (cells: string[], i: number) => {
    if (i < 0 || !cells[i]) return null;
    const raw = cells[i]!;
    const n = Number(raw);
    const t = Number.isFinite(n) ? (n < 1e12 ? n * 1000 : n) : Date.parse(raw);
    return Number.isFinite(t) ? t : NaN;
  };
  lines.slice(1, 2001).forEach((line, li) => {
    const cells = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    const lineNo = li + 2;
    const symbol = (cells[idx.symbol] ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const sideRaw = (cells[idx.side] ?? "").toLowerCase();
    const side = /^(buy|long|b|l)/.test(sideRaw) ? "long" : /^(sell|short|s)/.test(sideRaw) ? "short" : null;
    const entryPrice = numAt(cells, idx.entry);
    const exitPrice = numAt(cells, idx.exit);
    const quantity = numAt(cells, idx.qty);
    const leverage = numAt(cells, idx.lev);
    const pnl = numAt(cells, idx.pnl);
    const openedAt = dateAt(cells, idx.opened);
    const closedAt = dateAt(cells, idx.closed);
    const bad = [
      !/^[A-Z0-9]{2,20}$/.test(symbol) && "symbol",
      !side && "side",
      !(entryPrice !== null && entryPrice > 0) && "entry",
      openedAt === null || Number.isNaN(openedAt) ? "opened" : null,
      Number.isNaN(exitPrice as number) && "exit",
      Number.isNaN(quantity as number) && "quantity",
      Number.isNaN(closedAt as number) && "closed",
    ].filter(Boolean);
    if (bad.length) {
      errors.push(`Line ${lineNo}: invalid ${bad.join(", ")}.`);
      return;
    }
    trades.push({
      symbol,
      side: side!,
      entryPrice: entryPrice!,
      exitPrice: exitPrice !== null && exitPrice > 0 ? exitPrice : null,
      quantity: quantity !== null && quantity > 0 ? quantity : null,
      leverage: leverage !== null && Number.isFinite(leverage) && leverage > 0 ? leverage : null,
      openedAt: openedAt!,
      closedAt: closedAt ?? null,
      pnl: pnl !== null && Number.isFinite(pnl) ? pnl : null,
    });
  });
  return { trades, errors: errors.slice(0, 20) };
}

/* ───────────── What a trader is doing ───────────── */

export interface HoldingView {
  symbol: string;
  side: "long" | "short";
  leverage: number | null;
  openedAt: number;
  entryPrice: number;
  /** Largest size reached, in base units (Binance reports the peak, not the remainder). */
  quantity: number | null;
  /** Position value at entry (quantity × entry). */
  notional: number | null;
  /** Own capital at entry (notional ÷ leverage). */
  margin: number | null;
  markPrice: number | null;
  /** Price move in the position's favour, percent (before leverage). */
  movePercent: number | null;
  /** Return on margin, percent (move × leverage). */
  roePercent: number | null;
  unrealizedPnl: number | null;
  partlyClosed: boolean;
  realizedSoFar: number | null;
}

export function holdingsView(
  open: Array<TradeLike & { status: "open" | "partial" | "closed" }>,
  markPrice: (symbol: string) => number | null,
): HoldingView[] {
  return open
    .filter((t) => t.status !== "closed")
    .map((t) => {
      const mark = markPrice(t.symbol);
      const dir = t.side === "long" ? 1 : -1;
      const notional = t.quantity !== null ? t.quantity * t.entryPrice : null;
      const move = mark !== null && t.entryPrice > 0 ? ((mark - t.entryPrice) / t.entryPrice) * 100 * dir : null;
      return {
        symbol: t.symbol,
        side: t.side,
        leverage: t.leverage,
        openedAt: t.openedAt,
        entryPrice: t.entryPrice,
        quantity: t.quantity,
        notional,
        margin: notional !== null ? notional / (t.leverage && t.leverage > 0 ? t.leverage : 1) : null,
        markPrice: mark,
        movePercent: move,
        roePercent: move !== null ? move * (t.leverage ?? 1) : null,
        unrealizedPnl: mark !== null && t.quantity !== null ? (mark - t.entryPrice) * t.quantity * dir : null,
        partlyClosed: (t as { status: string }).status === "partial",
        realizedSoFar: t.pnl,
      };
    })
    .sort((a, b) => (b.notional ?? 0) - (a.notional ?? 0));
}

export interface ActivityEvent {
  t: number;
  kind: "open" | "close";
  symbol: string;
  side: "long" | "short";
  leverage: number | null;
  price: number;
  notional: number | null;
  pnl: number | null;
  holdingHours: number | null;
}

/** Every open and close as a dated event, newest first. */
export function activityTimeline(trades: TradeLike[], limit = 80): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const t of trades) {
    const notional = t.quantity !== null ? t.quantity * t.entryPrice : null;
    events.push({ t: t.openedAt, kind: "open", symbol: t.symbol, side: t.side, leverage: t.leverage, price: t.entryPrice, notional, pnl: null, holdingHours: null });
    if (t.closedAt !== null && t.exitPrice !== null) {
      events.push({
        t: t.closedAt,
        kind: "close",
        symbol: t.symbol,
        side: t.side,
        leverage: t.leverage,
        price: t.exitPrice,
        notional: t.quantity !== null ? t.quantity * t.exitPrice : null,
        pnl: tradePnl(t),
        holdingHours: (t.closedAt - t.openedAt) / 3_600_000,
      });
    }
  }
  return events.sort((a, b) => b.t - a.t).slice(0, limit);
}

export interface CapitalByCoin {
  symbol: string;
  /** Sum of position values at entry. */
  notional: number;
  sharePercent: number;
  avgLeverage: number | null;
  positions: number;
  lastTradedAt: number;
}

/** Where the trader puts their money: position value at entry, per coin. */
export function capitalByCoin(trades: TradeLike[]): CapitalByCoin[] {
  const map = new Map<string, { notional: number; lev: number[]; n: number; last: number }>();
  for (const t of trades) {
    if (t.quantity === null) continue;
    const e = map.get(t.symbol) ?? { notional: 0, lev: [], n: 0, last: 0 };
    e.notional += t.quantity * t.entryPrice;
    if (t.leverage) e.lev.push(t.leverage);
    e.n++;
    e.last = Math.max(e.last, t.closedAt ?? t.openedAt);
    map.set(t.symbol, e);
  }
  const total = [...map.values()].reduce((s, e) => s + e.notional, 0);
  return [...map.entries()]
    .map(([symbol, e]) => ({
      symbol,
      notional: e.notional,
      sharePercent: total > 0 ? (e.notional / total) * 100 : 0,
      avgLeverage: e.lev.length ? e.lev.reduce((a, b) => a + b, 0) / e.lev.length : null,
      positions: e.n,
      lastTradedAt: e.last,
    }))
    .sort((a, b) => b.notional - a.notional);
}

export interface Exposure {
  openPositions: number;
  longNotional: number;
  shortNotional: number;
  /** (long − short) ÷ (long + short): +1 all long, −1 all short. */
  netBias: number | null;
  totalMargin: number;
  avgLeverage: number | null;
  unrealizedPnl: number | null;
  opened7d: number;
  closed7d: number;
  coins7d: string[];
}

export function exposure(holdings: HoldingView[], trades: TradeLike[], now = Date.now()): Exposure {
  const long = holdings.filter((h) => h.side === "long").reduce((s, h) => s + (h.notional ?? 0), 0);
  const short = holdings.filter((h) => h.side === "short").reduce((s, h) => s + (h.notional ?? 0), 0);
  const levs = holdings.map((h) => h.leverage).filter((l): l is number => l !== null);
  const upnl = holdings.map((h) => h.unrealizedPnl).filter((v): v is number => v !== null);
  const weekAgo = now - 7 * 86_400_000;
  return {
    openPositions: holdings.length,
    longNotional: long,
    shortNotional: short,
    netBias: long + short > 0 ? (long - short) / (long + short) : null,
    totalMargin: holdings.reduce((s, h) => s + (h.margin ?? 0), 0),
    avgLeverage: levs.length ? levs.reduce((a, b) => a + b, 0) / levs.length : null,
    unrealizedPnl: upnl.length ? upnl.reduce((a, b) => a + b, 0) : null,
    opened7d: trades.filter((t) => t.openedAt >= weekAgo).length,
    closed7d: trades.filter((t) => t.closedAt !== null && t.closedAt >= weekAgo).length,
    coins7d: [...new Set(trades.filter((t) => t.openedAt >= weekAgo).map((t) => t.symbol))].slice(0, 10),
  };
}
