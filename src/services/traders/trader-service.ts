import "server-only";
import { ObjectId, type AnyBulkWriteOperation } from "mongodb";
import { getCollections } from "@/lib/mongodb/collections";
import { AppError, NotFoundError, ValidationError, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { TraderDoc, TraderTradeDoc } from "@/models";
import {
  fetchCoinMix,
  fetchLeaderboard,
  fetchPerformance,
  fetchPositionHistory,
  fetchRoiSeries,
  fetchTraderDetail,
  profileUrl,
  type CopySort,
  type CopyTimeRange,
} from "./binance-copy";
import {
  detectStrategyChange,
  equityFromRoi,
  equityFromTrades,
  returnMetrics,
  tradeStats,
  type CsvTrade,
  type TradeLike,
} from "./metrics";

const SYNC_EVERY_MS = 60 * 60_000;
const MAX_TRADERS = 50;
const MAX_TRADES_PER_TRADER = 5000;

function toTradeLike(t: TraderTradeDoc): TradeLike {
  return {
    symbol: t.symbol,
    side: t.side,
    leverage: t.leverage,
    openedAt: t.openedAt.getTime(),
    closedAt: t.closedAt ? t.closedAt.getTime() : null,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    quantity: t.quantity,
    pnl: t.pnl,
  };
}

/** Everything the pages show for one trader, computed from the stored data. */
export function traderMetrics(trader: TraderDoc, trades: TraderTradeDoc[], now = Date.now()) {
  const like = trades.map(toTradeLike);
  const equity =
    trader.source === "binance_copy"
      ? equityFromRoi(trader.remote?.roiSeries ?? [])
      : trader.startingValue
        ? equityFromTrades(trader.startingValue, like, now)
        : [];
  const returns = returnMetrics(equity);
  const perf = (r: "7D" | "30D" | "90D") => trader.remote?.performance.find((p) => p.range === r) ?? null;
  const stats = tradeStats(like, now);
  return {
    equity: equity.map((p) => ({ t: p.t, v: p.v })),
    returns: {
      dailyReturnPercent: returns.dailyReturnPercent,
      weeklyReturnPercent: returns.weeklyReturnPercent,
      // Binance's own 30-day ROI is authoritative when available; ours is derived from the daily curve.
      monthlyRoiPercent: perf("30D")?.roiPercent ?? returns.monthlyReturnPercent,
      maxDrawdownPercent: perf("90D")?.maxDrawdownPercent ?? returns.maxDrawdownPercent,
      totalReturnPercent: returns.totalReturnPercent,
      upDaysPercent: returns.upDaysPercent,
      winRatePercent: perf("30D")?.winRatePercent ?? stats.winRatePercent,
    },
    daily: returns.daily,
    stats,
    strategy: detectStrategyChange(like, now),
  };
}

/* ───────────── Leaderboard ───────────── */

export async function getLeaderboard(userId: string, range: CopyTimeRange, sort: CopySort) {
  const [board, tracked] = await Promise.all([
    fetchLeaderboard(range, sort, 50),
    getCollections().then(({ traders }) =>
      traders.find({ userId, source: "binance_copy" }, { projection: { externalId: 1 } }).toArray(),
    ),
  ]);
  const trackedIds = new Map(tracked.map((t) => [t.externalId, t._id.toString()]));
  return {
    rows: board.data.map((r) => {
      const m = returnMetrics(equityFromRoi(r.roiSeries));
      return {
        ...r,
        weeklyReturnPercent: m.weeklyReturnPercent,
        dailyReturnPercent: m.dailyReturnPercent,
        trackedId: trackedIds.get(r.portfolioId) ?? null,
      };
    }),
    fetchedAt: new Date(board.fetchedAt).toISOString(),
    stale: board.stale,
  };
}

/* ───────────── Tracked traders ───────────── */

async function ownTrader(userId: string, id: string) {
  const { traders } = await getCollections();
  const t = await traders.findOne({ _id: new ObjectId(id), userId });
  if (!t) throw new NotFoundError("Trader not found.");
  return t;
}

export async function listTraders(userId: string) {
  const { traders, traderTrades } = await getCollections();
  const list = await traders.find({ userId }).sort({ createdAt: -1 }).limit(MAX_TRADERS).toArray();
  const trades = await traderTrades
    .find({ traderId: { $in: list.map((t) => t._id) } })
    .sort({ openedAt: -1 })
    .limit(MAX_TRADES_PER_TRADER)
    .toArray();
  const byTrader = new Map<string, TraderTradeDoc[]>();
  for (const t of trades) byTrader.set(t.traderId.toString(), [...(byTrader.get(t.traderId.toString()) ?? []), t]);
  const now = Date.now();
  return list.map((t) => {
    const m = traderMetrics(t, byTrader.get(t._id.toString()) ?? [], now);
    return {
      trader: t,
      returns: m.returns,
      stats: { trades: m.stats.trades, open: m.stats.open, avgHoldingHours: m.stats.avgHoldingHours, topCoins: m.stats.coins.slice(0, 3).map((c) => c.symbol) },
      strategy: { status: m.strategy.status, score: m.strategy.score },
    };
  });
}

export async function getTrader(userId: string, id: string) {
  const trader = await ownTrader(userId, id);
  // Refresh Binance data in the background of this request when it is older than an hour.
  let syncError: string | null = null;
  let current = trader;
  if (trader.source === "binance_copy" && (!trader.lastSyncedAt || Date.now() - trader.lastSyncedAt.getTime() > SYNC_EVERY_MS)) {
    try {
      current = await syncTrader(userId, id);
    } catch (err) {
      syncError = isAppError(err) ? err.publicMessage : "Sync failed.";
    }
  }
  const { traderTrades } = await getCollections();
  const trades = await traderTrades.find({ traderId: current._id }).sort({ openedAt: -1 }).limit(MAX_TRADES_PER_TRADER).toArray();
  const asOf = Date.now();
  return { trader: current, trades, metrics: traderMetrics(current, trades, asOf), syncError, asOf };
}

export async function trackBinanceTrader(userId: string, portfolioId: string) {
  if (!/^\d{6,30}$/.test(portfolioId)) throw new ValidationError("Invalid Binance lead-portfolio id.");
  const { traders } = await getCollections();
  const existing = await traders.findOne({ userId, externalId: portfolioId });
  if (existing) return existing;
  if ((await traders.countDocuments({ userId })) >= MAX_TRADERS) {
    throw new ValidationError(`You can track up to ${MAX_TRADERS} traders. Remove one first.`);
  }
  const detail = await fetchTraderDetail(portfolioId);
  const now = new Date();
  const doc: TraderDoc = {
    _id: new ObjectId(),
    userId,
    source: "binance_copy",
    externalId: portfolioId,
    name: detail.name,
    profileUrl: profileUrl(portfolioId),
    avatarUrl: detail.avatarUrl,
    startingValue: null,
    startingValueSource: null,
    quoteAsset: detail.quoteAsset,
    createdAt: now,
    updatedAt: now,
    lastSyncedAt: null,
    lastSyncError: null,
    remote: null,
  };
  await traders.insertOne(doc);
  try {
    return await syncTrader(userId, doc._id.toString());
  } catch (err) {
    logger.warn("traders.initial_sync_failed", { portfolioId, error: err });
    return doc;
  }
}

export async function createManualTrader(
  userId: string,
  input: { name: string; profileUrl?: string | null; startingValue: number; notes?: string },
) {
  const { traders } = await getCollections();
  if ((await traders.countDocuments({ userId })) >= MAX_TRADERS) {
    throw new ValidationError(`You can track up to ${MAX_TRADERS} traders. Remove one first.`);
  }
  const now = new Date();
  const doc: TraderDoc = {
    _id: new ObjectId(),
    userId,
    source: "manual",
    externalId: null,
    name: input.name,
    profileUrl: input.profileUrl ?? null,
    avatarUrl: null,
    startingValue: input.startingValue,
    startingValueSource: "user",
    quoteAsset: "USDT",
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
    lastSyncedAt: null,
    lastSyncError: null,
    remote: null,
  };
  await traders.insertOne(doc);
  return doc;
}

export async function updateTrader(
  userId: string,
  id: string,
  patch: { name?: string; profileUrl?: string | null; startingValue?: number | null; notes?: string },
) {
  const trader = await ownTrader(userId, id);
  const { traders } = await getCollections();
  const $set: Partial<TraderDoc> = { updatedAt: new Date() };
  if (patch.name !== undefined) $set.name = patch.name;
  if (patch.profileUrl !== undefined && trader.source === "manual") $set.profileUrl = patch.profileUrl;
  if (patch.notes !== undefined) $set.notes = patch.notes;
  if (patch.startingValue !== undefined) {
    $set.startingValue = patch.startingValue;
    $set.startingValueSource = patch.startingValue === null ? null : "user";
  }
  const res = await traders.findOneAndUpdate({ _id: trader._id, userId }, { $set }, { returnDocument: "after" });
  return res!;
}

export async function deleteTrader(userId: string, id: string) {
  const trader = await ownTrader(userId, id);
  const { traders, traderTrades } = await getCollections();
  await traderTrades.deleteMany({ traderId: trader._id, userId });
  await traders.deleteOne({ _id: trader._id, userId });
}

/** Pulls the latest performance and position history from Binance and upserts the positions. */
export async function syncTrader(userId: string, id: string): Promise<TraderDoc> {
  const trader = await ownTrader(userId, id);
  if (trader.source !== "binance_copy" || !trader.externalId) {
    throw new AppError("CONFLICT", "Only traders imported from Binance can be synced.");
  }
  const pid = trader.externalId;
  const { traders, traderTrades } = await getCollections();
  try {
    const [detail, p7, p30, p90, roiSeries, coinMix, positions] = await Promise.all([
      fetchTraderDetail(pid),
      fetchPerformance(pid, "7D"),
      fetchPerformance(pid, "30D"),
      fetchPerformance(pid, "90D"),
      fetchRoiSeries(pid, "90D"),
      fetchCoinMix(pid, "30D").catch(() => []),
      fetchPositionHistory(pid),
    ]);

    const ops: AnyBulkWriteOperation<TraderTradeDoc>[] = positions.map((p) => ({
      updateOne: {
        filter: { traderId: trader._id, externalId: p.externalId },
        update: {
          $set: {
            symbol: p.symbol,
            side: p.side,
            leverage: p.leverage,
            quantity: p.quantity,
            entryPrice: p.entryPrice,
            exitPrice: p.exitPrice,
            openedAt: new Date(p.openedAt),
            closedAt: p.closedAt ? new Date(p.closedAt) : null,
            pnl: p.pnl,
            status: p.status,
          },
          $setOnInsert: { _id: new ObjectId(), userId, traderId: trader._id, externalId: p.externalId, source: "binance_copy", createdAt: new Date() },
        },
        upsert: true,
      },
    }));
    if (ops.length) await traderTrades.bulkWrite(ops, { ordered: false });

    // Starting capital implied by the 90-day figures: P&L = start × ROI.
    const implied = p90.pnl !== null && p90.roiPercent ? p90.pnl / (p90.roiPercent / 100) : null;
    const startingValue =
      trader.startingValueSource === "user" ? trader.startingValue : implied !== null && implied > 0 ? implied : null;

    const updated = await traders.findOneAndUpdate(
      { _id: trader._id, userId },
      {
        $set: {
          name: detail.name,
          avatarUrl: detail.avatarUrl,
          quoteAsset: detail.quoteAsset,
          startingValue,
          startingValueSource: trader.startingValueSource === "user" ? "user" : startingValue !== null ? "implied" : null,
          lastSyncedAt: new Date(),
          lastSyncError: null,
          updatedAt: new Date(),
          remote: {
            status: detail.status,
            description: detail.description,
            tags: detail.tags,
            startedAt: detail.startedAt ? new Date(detail.startedAt) : null,
            marginBalance: detail.marginBalance,
            copiers: detail.copiers,
            roiSeries,
            performance: [p7, p30, p90].map((p) => ({
              range: p.range,
              roiPercent: p.roiPercent,
              pnl: p.pnl,
              maxDrawdownPercent: p.maxDrawdownPercent,
              winRatePercent: p.winRatePercent,
              totalOrders: p.totalOrders,
            })),
            coinMix,
          },
        },
      },
      { returnDocument: "after" },
    );
    logger.info("traders.synced", { portfolioId: pid, positions: positions.length });
    return updated!;
  } catch (err) {
    const message = isAppError(err) ? err.publicMessage : "Sync failed.";
    await traders.updateOne({ _id: trader._id }, { $set: { lastSyncError: message, lastSyncedAt: new Date() } });
    throw isAppError(err) ? err : new AppError("MARKET_UNAVAILABLE", "Binance copy-trading data could not be loaded.", { cause: err, retryable: true });
  }
}

/** Cron: refreshes Binance traders whose data is older than an hour. */
export async function syncDueTraders(userId: string, max = 5): Promise<number> {
  const { traders } = await getCollections();
  const due = await traders
    .find({
      userId,
      source: "binance_copy",
      $or: [{ lastSyncedAt: null }, { lastSyncedAt: { $lte: new Date(Date.now() - SYNC_EVERY_MS) } }],
    })
    .sort({ lastSyncedAt: 1 })
    .limit(max)
    .toArray();
  let ok = 0;
  for (const t of due) {
    try {
      await syncTrader(userId, t._id.toString());
      ok++;
    } catch {
      /* recorded on the trader */
    }
  }
  return ok;
}

/* ───────────── Manual trades ───────────── */

export async function addTrades(userId: string, id: string, trades: CsvTrade[], source: "manual" | "csv") {
  const trader = await ownTrader(userId, id);
  if (trader.source !== "manual") throw new AppError("CONFLICT", "Trades of Binance traders come from Binance; add trades to a manual trader.");
  const { traderTrades } = await getCollections();
  if ((await traderTrades.countDocuments({ traderId: trader._id })) + trades.length > MAX_TRADES_PER_TRADER) {
    throw new ValidationError(`A trader can have up to ${MAX_TRADES_PER_TRADER} trades.`);
  }
  const now = new Date();
  const docs: TraderTradeDoc[] = trades.map((t) => ({
    _id: new ObjectId(),
    userId,
    traderId: trader._id,
    externalId: null,
    symbol: t.symbol,
    side: t.side,
    leverage: t.leverage,
    quantity: t.quantity,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    openedAt: new Date(t.openedAt),
    closedAt: t.closedAt ? new Date(t.closedAt) : null,
    pnl: t.pnl,
    status: t.closedAt ? "closed" : "open",
    source,
    createdAt: now,
  }));
  if (docs.some((d) => d.closedAt && d.closedAt < d.openedAt)) throw new ValidationError("A trade cannot close before it opens.");
  if (docs.length) await traderTrades.insertMany(docs);
  return docs.length;
}

export async function deleteTrade(userId: string, id: string, tradeId: string) {
  const trader = await ownTrader(userId, id);
  if (trader.source !== "manual") throw new AppError("CONFLICT", "Trades of Binance traders cannot be edited.");
  const { traderTrades } = await getCollections();
  const res = await traderTrades.deleteOne({ _id: new ObjectId(tradeId), traderId: trader._id, userId });
  if (!res.deletedCount) throw new NotFoundError("Trade not found.");
}
