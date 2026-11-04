import "server-only";
import { z } from "zod";
import { appEnv } from "@/lib/env";
import { externalCache, fetchJson } from "@/services/external/http";
import type { MarketResult } from "@/services/binance";

/**
 * Binance Futures copy-trading ("lead trader") data, read from the endpoints behind the public
 * copy-trading pages on binance.com. They are NOT an official API: shapes can change and
 * requests can be blocked at any time, so everything here is parsed leniently, cached, and
 * callers must treat failure as normal.
 *
 * These are USD-M futures portfolios: positions are leveraged and can be long or short.
 */
export type CopyTimeRange = "7D" | "30D" | "90D";
export type CopySort = "ROI" | "PNL";

const LIST_TTL = 30 * 60;
const DETAIL_TTL = 30 * 60;

const num = z.union([z.number(), z.string()]).transform(Number).pipe(z.number().finite());
const numOrNull = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => (v === null || v === undefined || v === "" ? null : Number(v)))
  .pipe(z.number().finite().nullable());

function envelope<T extends z.ZodType>(data: T) {
  return z.object({ code: z.string(), data, success: z.boolean().optional() });
}

const chartPoint = z.object({ value: num, dateTime: num });

const listItem = z.object({
  leadPortfolioId: z.string(),
  nickname: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  currentCopyCount: numOrNull,
  maxCopyCount: numOrNull,
  roi: numOrNull,
  pnl: numOrNull,
  aum: numOrNull,
  mdd: numOrNull,
  winRate: numOrNull,
  copierPnl: numOrNull,
  sharpRatio: numOrNull,
  chartItems: z.array(chartPoint).nullable().optional(),
});

const detailSchema = z.object({
  leadPortfolioId: z.string(),
  nickname: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  startTime: numOrNull,
  closedTime: numOrNull,
  marginBalance: numOrNull,
  initInvestAsset: z.string().nullable().optional(),
  currentCopyCount: numOrNull,
  profitSharingRate: numOrNull,
  tagItemVos: z
    .array(z.object({ tagName: z.string().nullable().optional(), tagLangKeyMessage: z.string().nullable().optional() }))
    .nullable()
    .optional(),
});

const performanceSchema = z.object({
  roi: numOrNull,
  pnl: numOrNull,
  mdd: numOrNull,
  winRate: numOrNull,
  winOrders: numOrNull,
  totalOrder: numOrNull,
  sharpRatio: numOrNull,
});

const historyItem = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  positionId: z.union([z.string(), z.number()]).transform(String).nullable().optional(),
  symbol: z.string(),
  opened: num,
  closed: numOrNull,
  avgCost: num,
  avgClosePrice: numOrNull,
  closingPnl: numOrNull,
  maxOpenInterest: numOrNull,
  closedVolume: numOrNull,
  side: z.string(),
  status: z.string().nullable().optional(),
  leverage: numOrNull,
});

export interface LeaderboardRow {
  portfolioId: string;
  name: string;
  avatarUrl: string | null;
  profileUrl: string;
  roiPercent: number | null;
  pnl: number | null;
  maxDrawdownPercent: number | null;
  winRatePercent: number | null;
  aum: number | null;
  copierPnl: number | null;
  copiers: number | null;
  sharpe: number | null;
  /** Cumulative ROI (percent) per day over the range. */
  roiSeries: Array<{ t: number; roi: number }>;
}

export interface TraderDetail {
  portfolioId: string;
  name: string;
  avatarUrl: string | null;
  description: string | null;
  status: string | null;
  startedAt: number | null;
  closedAt: number | null;
  marginBalance: number | null;
  quoteAsset: string;
  copiers: number | null;
  profitSharingPercent: number | null;
  tags: string[];
}

export interface TraderPerformance {
  range: CopyTimeRange;
  roiPercent: number | null;
  pnl: number | null;
  maxDrawdownPercent: number | null;
  winRatePercent: number | null;
  winOrders: number | null;
  totalOrders: number | null;
  sharpe: number | null;
}

export interface CopyPosition {
  externalId: string;
  symbol: string;
  side: "long" | "short";
  leverage: number | null;
  openedAt: number;
  closedAt: number | null;
  entryPrice: number;
  exitPrice: number | null;
  /** Largest position size reached, in base units. */
  quantity: number | null;
  pnl: number | null;
  status: "open" | "partial" | "closed";
}

export function profileUrl(portfolioId: string) {
  return `https://www.binance.com/en/copy-trading/lead-details/${portfolioId}`;
}

function base() {
  return appEnv().BINANCE_WEB_BASE.replace(/\/$/, "");
}

const friendly = () => `${base()}/bapi/futures/v1/friendly/future/copy-trade`;
const publicApi = () => `${base()}/bapi/futures/v1/public/future/copy-trade`;

export async function fetchLeaderboard(
  range: CopyTimeRange,
  sort: CopySort,
  pageSize = 50,
): Promise<MarketResult<LeaderboardRow[]>> {
  return externalCache().get(
    `copy:list:${range}:${sort}:${pageSize}`,
    LIST_TTL,
    async () => {
      const raw = await fetchJson(`${friendly()}/home-page/query-list`, {
        method: "POST",
        body: { pageNumber: 1, pageSize, timeRange: range, dataType: sort, favoriteOnly: false, hideFull: false, nickname: "", order: "DESC" },
      });
      const parsed = envelope(z.object({ list: z.array(z.unknown()).nullable() })).parse(raw);
      const rows: LeaderboardRow[] = [];
      for (const item of parsed.data.list ?? []) {
        const r = listItem.safeParse(item);
        if (!r.success) continue;
        const d = r.data;
        rows.push({
          portfolioId: d.leadPortfolioId,
          name: d.nickname?.trim() || `Trader ${d.leadPortfolioId.slice(-6)}`,
          avatarUrl: d.avatarUrl ?? null,
          profileUrl: profileUrl(d.leadPortfolioId),
          roiPercent: d.roi,
          pnl: d.pnl,
          maxDrawdownPercent: d.mdd,
          winRatePercent: d.winRate,
          aum: d.aum,
          copierPnl: d.copierPnl,
          copiers: d.currentCopyCount,
          sharpe: d.sharpRatio,
          roiSeries: (d.chartItems ?? []).map((p) => ({ t: p.dateTime, roi: p.value })),
        });
      }
      return rows;
    },
    { persist: true, persistEverySeconds: LIST_TTL },
  );
}

export async function fetchTraderDetail(portfolioId: string): Promise<TraderDetail> {
  const res = await externalCache().get(`copy:detail:${portfolioId}`, DETAIL_TTL, async () => {
    const raw = await fetchJson(`${friendly()}/lead-portfolio/detail?portfolioId=${encodeURIComponent(portfolioId)}`);
    const d = envelope(detailSchema).parse(raw).data;
    return {
      portfolioId: d.leadPortfolioId,
      name: d.nickname?.trim() || `Trader ${d.leadPortfolioId.slice(-6)}`,
      avatarUrl: d.avatarUrl ?? null,
      description: d.description ?? null,
      status: d.status ?? null,
      startedAt: d.startTime,
      closedAt: d.closedTime,
      marginBalance: d.marginBalance,
      quoteAsset: d.initInvestAsset ?? "USDT",
      copiers: d.currentCopyCount,
      profitSharingPercent: d.profitSharingRate,
      tags: (d.tagItemVos ?? []).map((t) => t.tagLangKeyMessage || t.tagName || "").filter(Boolean),
    } satisfies TraderDetail;
  });
  return res.data;
}

export async function fetchPerformance(portfolioId: string, range: CopyTimeRange): Promise<TraderPerformance> {
  const res = await externalCache().get(`copy:perf:${portfolioId}:${range}`, DETAIL_TTL, async () => {
    const raw = await fetchJson(
      `${publicApi()}/lead-portfolio/performance?portfolioId=${encodeURIComponent(portfolioId)}&timeRange=${range}`,
    );
    const d = envelope(performanceSchema).parse(raw).data;
    return {
      range,
      roiPercent: d.roi,
      pnl: d.pnl,
      maxDrawdownPercent: d.mdd,
      winRatePercent: d.winRate,
      winOrders: d.winOrders,
      totalOrders: d.totalOrder,
      sharpe: d.sharpRatio,
    } satisfies TraderPerformance;
  });
  return res.data;
}

/** Daily cumulative ROI (percent) for the range. */
export async function fetchRoiSeries(portfolioId: string, range: CopyTimeRange = "90D") {
  const res = await externalCache().get(`copy:roi:${portfolioId}:${range}`, DETAIL_TTL, async () => {
    const raw = await fetchJson(
      `${publicApi()}/lead-portfolio/chart-data?dataType=ROI&portfolioId=${encodeURIComponent(portfolioId)}&timeRange=${range}`,
    );
    return envelope(z.array(chartPoint)).parse(raw).data.map((p) => ({ t: p.dateTime, roi: p.value }));
  });
  return res.data;
}

/** Share of traded volume per asset over the range, in percent. */
export async function fetchCoinMix(portfolioId: string, range: CopyTimeRange = "30D") {
  const res = await externalCache().get(`copy:coins:${portfolioId}:${range}`, DETAIL_TTL, async () => {
    const raw = await fetchJson(
      `${publicApi()}/lead-portfolio/performance/coin?portfolioId=${encodeURIComponent(portfolioId)}&timeRange=${range}`,
    );
    const d = envelope(z.object({ data: z.array(z.object({ asset: z.string(), volume: num })).nullable() })).parse(raw).data;
    return (d.data ?? []).map((x) => ({ asset: x.asset, sharePercent: x.volume }));
  });
  return res.data;
}

function toPosition(h: z.infer<typeof historyItem>): CopyPosition {
  const status = (h.status ?? "").toLowerCase();
  return {
    externalId: h.positionId || h.id,
    symbol: h.symbol.toUpperCase(),
    side: h.side.toLowerCase().startsWith("s") ? "short" : "long",
    leverage: h.leverage,
    openedAt: h.opened,
    closedAt: h.closed,
    entryPrice: h.avgCost,
    exitPrice: h.avgClosePrice && h.avgClosePrice > 0 ? h.avgClosePrice : null,
    quantity: h.maxOpenInterest,
    pnl: h.closingPnl,
    status: status.includes("partial") ? "partial" : h.closed ? "closed" : "open",
  };
}

/** Position history, newest first. `pages` × `pageSize` positions at most. */
export async function fetchPositionHistory(portfolioId: string, pages = 4, pageSize = 50): Promise<CopyPosition[]> {
  const res = await externalCache().get(`copy:history:${portfolioId}:${pages}:${pageSize}`, 15 * 60, async () => {
    const out: CopyPosition[] = [];
    for (let page = 1; page <= pages; page++) {
      const raw = await fetchJson(`${friendly()}/lead-portfolio/position-history`, {
        method: "POST",
        body: { pageNumber: page, pageSize, portfolioId },
      });
      const d = envelope(z.object({ total: numOrNull, list: z.array(z.unknown()).nullable() })).parse(raw).data;
      const list = d.list ?? [];
      for (const item of list) {
        const r = historyItem.safeParse(item);
        if (r.success) out.push(toPosition(r.data));
      }
      if (list.length < pageSize) break;
    }
    return out;
  });
  return res.data;
}
