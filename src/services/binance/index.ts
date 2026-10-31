import "server-only";
import { appEnv } from "@/lib/env";
import { getCollections } from "@/lib/mongodb/collections";
import { BinanceHttpClient } from "./http";
import { MarketCache, type PersistentStore } from "./cache";
import { BinanceMarketData } from "./market-data";

export type { MarketResult } from "./cache";
export type { MarketTicker, SymbolInfo, MarketStatus } from "./market-data";
export { normalizeSymbol } from "./market-data";

/** Last successful market data persisted in MongoDB (best effort). */
const mongoStore: PersistentStore = {
  async read(key) {
    const { marketCache } = await getCollections();
    const doc = await marketCache.findOne({ _id: key });
    return doc ? { data: doc.data, fetchedAt: doc.fetchedAt.getTime() } : null;
  },
  async write(key, data, fetchedAt) {
    const { marketCache } = await getCollections();
    await marketCache.updateOne(
      { _id: key },
      { $set: { data, fetchedAt: new Date(fetchedAt) } },
      { upsert: true },
    );
  },
};

const globalForMarket = globalThis as unknown as { __cryptoLabMarket?: BinanceMarketData };

export function marketData(): BinanceMarketData {
  if (!globalForMarket.__cryptoLabMarket) {
    const env = appEnv();
    const http = new BinanceHttpClient({ baseUrl: env.BINANCE_API_BASE, timeoutMs: env.BINANCE_REQUEST_TIMEOUT_MS });
    globalForMarket.__cryptoLabMarket = new BinanceMarketData(http, new MarketCache(mongoStore), {
      tickerTtlSeconds: env.MARKET_TICKER_TTL_SECONDS,
    });
  }
  return globalForMarket.__cryptoLabMarket;
}
