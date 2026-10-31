import "server-only";
import { ObjectId } from "mongodb";
import type { ClientSession } from "mongodb";
import { getCollections } from "@/lib/mongodb/collections";
import type { MarketSnapshotDoc } from "@/models";
import type { MarketTicker } from "@/services/binance/market-data";

/** Stores the market data a decision or analysis was based on, for later comparison. */
export async function recordMarketSnapshot(
  ticker: MarketTicker,
  meta: { fetchedAt: number; stale: boolean; reason: MarketSnapshotDoc["reason"] },
  session?: ClientSession,
): Promise<ObjectId> {
  const { marketSnapshots } = await getCollections();
  const doc: MarketSnapshotDoc = {
    _id: new ObjectId(),
    symbol: ticker.symbol,
    price: ticker.price,
    volume: ticker.volume,
    quoteVolume: ticker.quoteVolume,
    marketData: {
      priceChange: ticker.priceChange,
      priceChangePercent: ticker.priceChangePercent,
      highPrice: ticker.high,
      lowPrice: ticker.low,
      openPrice: ticker.open,
      weightedAvgPrice: ticker.weightedAvgPrice,
      tradeCount: ticker.tradeCount,
    },
    source: meta.stale ? "cache" : "live",
    dataTimestamp: new Date(meta.fetchedAt),
    timestamp: new Date(),
    reason: meta.reason,
  };
  await marketSnapshots.insertOne(doc, { session });
  return doc._id;
}
