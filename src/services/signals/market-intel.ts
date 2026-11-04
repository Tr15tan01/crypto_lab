import "server-only";
import { z } from "zod";
import { appEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { externalCache, fetchJson } from "@/services/external/http";
import { fetchLeaderboard, fetchPositionHistory } from "@/services/traders/binance-copy";

/**
 * Optional "market intelligence" layers on top of spot candles. Every function resolves to null
 * when its source is unreachable (e.g. Binance futures data is blocked in some regions), so the
 * features using them keep working with fewer inputs.
 */

const num = z.union([z.number(), z.string()]).transform(Number).pipe(z.number().finite());

/* ───────────── Fear & Greed ───────────── */

export interface FearGreed {
  value: number;
  label: string;
  /** Value one week earlier, when available. */
  weekAgo: number | null;
  at: number;
}

export async function fearGreed(): Promise<FearGreed | null> {
  const url = appEnv().FEAR_GREED_URL;
  if (!url || url === "off") return null;
  try {
    const res = await externalCache().get(
      "intel:fng",
      60 * 60,
      async () => {
        const raw = z
          .object({ data: z.array(z.object({ value: num, value_classification: z.string(), timestamp: num })) })
          .parse(await fetchJson(url));
        const [latest] = raw.data;
        if (!latest) throw new Error("empty");
        return {
          value: latest.value,
          label: latest.value_classification,
          weekAgo: raw.data[7]?.value ?? raw.data[raw.data.length - 1]?.value ?? null,
          at: latest.timestamp * 1000,
        } satisfies FearGreed;
      },
      { persist: true, persistEverySeconds: 3600 },
    );
    return res.data;
  } catch {
    return null;
  }
}

/* ───────────── Futures positioning ───────────── */

export interface Derivatives {
  /** Last funding rate, percent per 8h. Positive: longs pay shorts (crowded longs). */
  fundingRatePercent: number;
  openInterestChange1dPercent: number | null;
  openInterestChange7dPercent: number | null;
  /** Share of all accounts that are net long, percent. */
  longAccountsPercent: number | null;
  /** Long/short ratio of the top 20% of traders by margin (positions). */
  topTraderLongShortRatio: number | null;
  /** Taker buy volume / taker sell volume over the last day. >1 = aggressive buying. */
  takerBuySellRatio: number | null;
}

const NOT_LISTED = "not_listed";

export async function derivatives(spotSymbol: string): Promise<Derivatives | null> {
  const base = appEnv().BINANCE_FUTURES_API_BASE.replace(/\/$/, "");
  const sym = encodeURIComponent(spotSymbol);
  try {
    const res = await externalCache().get(`intel:deriv:${spotSymbol}`, 15 * 60, async () => {
      let premium: unknown;
      try {
        premium = await fetchJson(`${base}/fapi/v1/premiumIndex?symbol=${sym}`, { retries: 0, timeoutMs: 6000, quiet: true });
      } catch {
        // No perpetual for this pair (HTTP 400) or region blocked: remember it for the TTL.
        return NOT_LISTED;
      }
      const funding = z.object({ lastFundingRate: num }).parse(premium).lastFundingRate * 100;
      const settle = <T,>(p: Promise<T>) => p.catch(() => null);
      const [oi, accounts, top, taker] = await Promise.all([
        settle(fetchJson(`${base}/futures/data/openInterestHist?symbol=${sym}&period=1d&limit=8`, { retries: 0 })),
        settle(fetchJson(`${base}/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=1d&limit=1`, { retries: 0 })),
        settle(fetchJson(`${base}/futures/data/topLongShortPositionRatio?symbol=${sym}&period=1d&limit=1`, { retries: 0 })),
        settle(fetchJson(`${base}/futures/data/takerlongshortRatio?symbol=${sym}&period=1d&limit=1`, { retries: 0 })),
      ]);
      const oiRows = z.array(z.object({ sumOpenInterestValue: num })).safeParse(oi);
      const oiValues = oiRows.success ? oiRows.data.map((r) => r.sumOpenInterestValue) : [];
      const pct = (from?: number, to?: number) => (from && to ? (to / from - 1) * 100 : null);
      const lastOf = <T,>(schema: z.ZodType<T>, v: unknown): T | null => {
        const r = z.array(schema).safeParse(v);
        return r.success && r.data.length ? r.data[r.data.length - 1]! : null;
      };
      const acc = lastOf(z.object({ longAccount: num }), accounts);
      const topRow = lastOf(z.object({ longShortRatio: num }), top);
      const takerRow = lastOf(z.object({ buySellRatio: num }), taker);
      return {
        fundingRatePercent: funding,
        openInterestChange1dPercent: pct(oiValues[oiValues.length - 2], oiValues[oiValues.length - 1]),
        openInterestChange7dPercent: pct(oiValues[0], oiValues[oiValues.length - 1]),
        longAccountsPercent: acc ? acc.longAccount * 100 : null,
        topTraderLongShortRatio: topRow?.longShortRatio ?? null,
        takerBuySellRatio: takerRow?.buySellRatio ?? null,
      } satisfies Derivatives;
    });
    return res.data === NOT_LISTED ? null : (res.data as Derivatives);
  } catch (err) {
    logger.warn("intel.derivatives_failed", { symbol: spotSymbol, error: err });
    return null;
  }
}

/* ───────────── Order book ───────────── */

export interface OrderBook {
  /** (bid depth − ask depth) / total depth within ±2% of mid. +1 = only bids, −1 = only asks. */
  imbalance: number;
  spreadPercent: number;
  /** Quote value resting within ±2% of the mid price. */
  depthQuote2Percent: number;
}

export function bookImbalance(bids: Array<[number, number]>, asks: Array<[number, number]>, bandPercent = 2): OrderBook | null {
  const bestBid = bids[0]?.[0];
  const bestAsk = asks[0]?.[0];
  if (!bestBid || !bestAsk) return null;
  const mid = (bestBid + bestAsk) / 2;
  const lo = mid * (1 - bandPercent / 100);
  const hi = mid * (1 + bandPercent / 100);
  const bidQ = bids.filter(([p]) => p >= lo).reduce((a, [p, q]) => a + p * q, 0);
  const askQ = asks.filter(([p]) => p <= hi).reduce((a, [p, q]) => a + p * q, 0);
  const total = bidQ + askQ;
  if (total <= 0) return null;
  return { imbalance: (bidQ - askQ) / total, spreadPercent: ((bestAsk - bestBid) / mid) * 100, depthQuote2Percent: total };
}

export async function orderBook(spotSymbol: string): Promise<OrderBook | null> {
  const base = appEnv().BINANCE_API_BASE.replace(/\/$/, "");
  try {
    const res = await externalCache().get(`intel:book:${spotSymbol}`, 60, async () => {
      const raw = z
        .object({ bids: z.array(z.tuple([num, num])), asks: z.array(z.tuple([num, num])) })
        .parse(await fetchJson(`${base}/api/v3/depth?symbol=${encodeURIComponent(spotSymbol)}&limit=500`, { retries: 0 }));
      const book = bookImbalance(raw.bids, raw.asks);
      if (!book) throw new Error("empty book");
      return book;
    });
    return res.data;
  } catch {
    return null;
  }
}

/* ───────────── Smart money (top copy traders) ───────────── */

export interface SmartMoneyEntry {
  /** Spot pair, e.g. PEPEUSDT (futures "1000PEPEUSDT" is mapped to it). */
  symbol: string;
  longs: number;
  shorts: number;
  /** Distinct top traders who opened a position in the window. */
  traders: number;
}

export interface SmartMoney {
  window: string;
  tradersSampled: number;
  entries: SmartMoneyEntry[];
}

/** "1000PEPEUSDT" → "PEPEUSDT": futures quote some small-priced coins in multiples. */
export function futuresToSpot(symbol: string): string {
  return symbol.toUpperCase().replace(/^(1000000|100000|10000|1000|1M)(?=[A-Z])/, "");
}

const SMART_SAMPLE = 15;
const SMART_WINDOW_DAYS = 7;

/**
 * What the top Binance lead traders (by 90-day P&L, drawdown under 50%) opened in the last
 * 7 days. A crowd signal, not a guarantee: these are leveraged futures traders.
 */
export async function smartMoney(): Promise<SmartMoney | null> {
  try {
    const res = await externalCache().get(
      "intel:smart:v1",
      30 * 60,
      async () => {
        const board = await fetchLeaderboard("90D", "PNL", 50);
        const picks = board.data
          .filter((r) => (r.maxDrawdownPercent ?? 100) < 50 && (r.roiPercent ?? 0) > 0)
          .slice(0, SMART_SAMPLE);
        const since = Date.now() - SMART_WINDOW_DAYS * 86_400_000;
        const agg = new Map<string, { longs: number; shorts: number; traders: Set<string> }>();
        let sampled = 0;
        for (const p of picks) {
          const history = await fetchPositionHistory(p.portfolioId, 1, 30).catch(() => null);
          if (!history) continue;
          sampled++;
          for (const pos of history) {
            if (pos.openedAt < since) continue;
            const s = futuresToSpot(pos.symbol);
            const e = agg.get(s) ?? { longs: 0, shorts: 0, traders: new Set<string>() };
            if (pos.side === "long") e.longs++;
            else e.shorts++;
            e.traders.add(p.portfolioId);
            agg.set(s, e);
          }
        }
        if (sampled === 0) throw new Error("no trader history available");
        return {
          window: `${SMART_WINDOW_DAYS}d`,
          tradersSampled: sampled,
          entries: [...agg.entries()]
            .map(([symbol, e]) => ({ symbol, longs: e.longs, shorts: e.shorts, traders: e.traders.size }))
            .sort((a, b) => b.traders - a.traders || b.longs + b.shorts - (a.longs + a.shorts)),
        } satisfies SmartMoney;
      },
      { persist: true, persistEverySeconds: 30 * 60 },
    );
    return res.data;
  } catch (err) {
    logger.warn("intel.smart_money_failed", { error: err });
    return null;
  }
}
