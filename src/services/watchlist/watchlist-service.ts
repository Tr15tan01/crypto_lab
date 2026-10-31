import "server-only";
import { MongoServerError, ObjectId } from "mongodb";
import { getCollections } from "@/lib/mongodb/collections";
import { AppError, NotFoundError, ValidationError } from "@/lib/errors";
import { marketData, type MarketTicker } from "@/services/binance";
import { assetName } from "@/services/market/asset-names";
import { recordMarketSnapshot } from "@/services/market/snapshots";
import type { WatchlistDoc } from "@/models";

export async function addToWatchlist(
  userId: string,
  input: { symbol: string; reason?: string; notes?: string; targetPrice?: number | null },
) {
  const md = marketData();
  const info = (await md.symbolInfo(input.symbol)).data;
  if (!info) throw new ValidationError(`${input.symbol} is not listed on Binance Spot.`);
  if (!info.tradable) throw new ValidationError(`${input.symbol} is not currently tradable on Binance.`);

  let ticker: MarketTicker | null = null;
  let fetchedAt = Date.now();
  let stale = false;
  try {
    const res = await md.ticker(input.symbol);
    ticker = res.data;
    fetchedAt = res.fetchedAt;
    stale = res.stale;
  } catch {
    // The entry is still useful without a starting price; performance-since-added shows "—".
  }

  const { watchlist } = await getCollections();
  const now = new Date();
  const doc: WatchlistDoc = {
    _id: new ObjectId(),
    userId,
    symbol: info.symbol,
    baseAsset: info.baseAsset,
    quoteAsset: info.quoteAsset,
    addedAt: now,
    priceAtAdd: ticker && !stale ? ticker.price : null,
    reason: input.reason,
    notes: input.notes,
    targetPrice: input.targetPrice ?? null,
    personalRanking: null,
    active: true,
    removedAt: null,
    updatedAt: now,
  };
  try {
    await watchlist.insertOne(doc);
  } catch (err) {
    if (err instanceof MongoServerError && err.code === 11000) {
      throw new AppError("CONFLICT", `${info.symbol} is already on your watchlist.`);
    }
    throw err;
  }
  if (ticker && !stale) await recordMarketSnapshot(ticker, { fetchedAt, stale, reason: "watchlist" }).catch(() => {});
  return doc;
}

export async function updateWatchlistItem(
  userId: string,
  id: string,
  input: { reason?: string; notes?: string; targetPrice?: number | null; personalRanking?: number | null },
) {
  const { watchlist } = await getCollections();
  const $set: Partial<WatchlistDoc> = { updatedAt: new Date() };
  if (input.reason !== undefined) $set.reason = input.reason;
  if (input.notes !== undefined) $set.notes = input.notes;
  if (input.targetPrice !== undefined) $set.targetPrice = input.targetPrice;
  if (input.personalRanking !== undefined) $set.personalRanking = input.personalRanking;
  const res = await watchlist.findOneAndUpdate(
    { _id: new ObjectId(id), userId, active: true },
    { $set },
    { returnDocument: "after" },
  );
  if (!res) throw new NotFoundError("Watchlist entry not found.");
  return res;
}

/** Removal keeps the record (active=false) so it stays in your history. */
export async function removeFromWatchlist(userId: string, id: string) {
  const { watchlist, alerts } = await getCollections();
  const res = await watchlist.findOneAndUpdate(
    { _id: new ObjectId(id), userId, active: true },
    { $set: { active: false, removedAt: new Date(), updatedAt: new Date() } },
  );
  if (!res) throw new NotFoundError("Watchlist entry not found.");
  await alerts.updateMany({ userId, symbol: res.symbol, status: "active" }, { $set: { status: "disabled" } });
}

export interface WatchlistRow {
  id: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  name: string | null;
  addedAt: string;
  removedAt: string | null;
  active: boolean;
  priceAtAdd: number | null;
  reason: string | null;
  notes: string | null;
  targetPrice: number | null;
  personalRanking: number | null;
  price: number | null;
  change24h: number | null;
  changeSinceAdded: number | null;
  distanceToTarget: number | null;
  tradable: boolean | null;
}

export async function listWatchlist(userId: string, opts: { includeRemoved?: boolean } = {}) {
  const { watchlist } = await getCollections();
  const docs = await watchlist
    .find({ userId, ...(opts.includeRemoved ? {} : { active: true }) })
    .sort({ active: -1, personalRanking: 1, addedAt: -1 })
    .limit(500)
    .toArray();

  const md = marketData();
  let tickers = new Map<string, MarketTicker>();
  let symbols = new Map<string, { tradable: boolean }>();
  let fetchedAt: number | null = null;
  let stale = false;
  try {
    const [all, sym] = await Promise.all([md.allTickers(), md.symbolMap()]);
    tickers = new Map(all.data.map((t) => [t.symbol, t]));
    symbols = sym.data;
    fetchedAt = all.fetchedAt;
    stale = all.stale;
  } catch {
    stale = true;
  }

  const rows: WatchlistRow[] = docs.map((d) => {
    const t = tickers.get(d.symbol);
    const price = t?.price ?? null;
    return {
      id: d._id.toString(),
      symbol: d.symbol,
      baseAsset: d.baseAsset,
      quoteAsset: d.quoteAsset,
      name: assetName(d.baseAsset),
      addedAt: d.addedAt.toISOString(),
      removedAt: d.removedAt ? d.removedAt.toISOString() : null,
      active: d.active,
      priceAtAdd: d.priceAtAdd,
      reason: d.reason ?? null,
      notes: d.notes ?? null,
      targetPrice: d.targetPrice ?? null,
      personalRanking: d.personalRanking ?? null,
      price,
      change24h: t?.priceChangePercent ?? null,
      changeSinceAdded: price !== null && d.priceAtAdd ? ((price - d.priceAtAdd) / d.priceAtAdd) * 100 : null,
      distanceToTarget: price !== null && d.targetPrice ? ((d.targetPrice - price) / price) * 100 : null,
      // Unknown (null) when exchange info is unavailable — never guessed.
      tradable: symbols.size ? (symbols.get(d.symbol)?.tradable ?? false) : null,
    };
  });

  return { rows, fetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null, stale };
}
