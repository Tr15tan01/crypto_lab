import "server-only";
import { ObjectId } from "mongodb";
import { getCollections } from "@/lib/mongodb/collections";
import { appEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { PortfolioSnapshotDoc } from "@/models";
import { getPortfolioState } from "./portfolio-service";

/**
 * Portfolio snapshots record the value at a point in time using the prices available at that
 * time. Historical charts are built only from snapshots — never by re-pricing old holdings with
 * today's prices. A snapshot is skipped (not faked) when live prices are unavailable.
 */
export async function createPortfolioSnapshot(
  userId: string,
  reason: PortfolioSnapshotDoc["reason"],
): Promise<{ created: boolean; reason?: string }> {
  const state = await getPortfolioState(userId);
  const v = state.valuation;
  if (v.unpricedSymbols.length > 0 || v.stalePricedSymbols.length > 0 || state.pricesStale) {
    logger.info("snapshot.skipped_no_live_prices", { reason });
    return { created: false, reason: "Live prices are not available for every holding." };
  }
  const { portfolioSnapshots } = await getCollections();
  const now = new Date();
  await portfolioSnapshots.insertOne({
    _id: new ObjectId(),
    userId,
    portfolioId: state.portfolio._id,
    timestamp: now,
    totalValue: v.totalValue,
    availableBalance: v.cash,
    investedValue: v.investedValue,
    marketValue: v.marketValue,
    realizedPnL: v.realizedPnL,
    unrealizedPnL: v.unrealizedPnL,
    holdingsSnapshot: v.positions.map((p) => ({
      symbol: p.symbol,
      quantity: p.quantity,
      price: p.price!,
      value: p.marketValue!,
      averageCost: p.averageCost,
    })),
    reason,
    pricesAsOf: state.pricesFetchedAt ? new Date(state.pricesFetchedAt) : now,
  });
  return { created: true };
}

/** Creates a scheduled snapshot if the last one is older than SNAPSHOT_INTERVAL_MINUTES. */
export async function maybeCreateScheduledSnapshot(userId: string): Promise<boolean> {
  const { portfolioSnapshots, portfolios } = await getCollections();
  const portfolio = await portfolios.findOne({ userId, status: "active" });
  if (!portfolio) return false;
  const last = await portfolioSnapshots.findOne({ portfolioId: portfolio._id }, { sort: { timestamp: -1 } });
  const intervalMs = appEnv().SNAPSHOT_INTERVAL_MINUTES * 60_000;
  if (last && Date.now() - last.timestamp.getTime() < intervalMs) return false;
  const res = await createPortfolioSnapshot(userId, "scheduled");
  return res.created;
}

export async function listSnapshots(userId: string, portfolioId: ObjectId, since?: Date) {
  const { portfolioSnapshots } = await getCollections();
  return portfolioSnapshots
    .find({ userId, portfolioId, ...(since ? { timestamp: { $gte: since } } : {}) })
    .sort({ timestamp: 1 })
    .limit(5000)
    .toArray();
}
