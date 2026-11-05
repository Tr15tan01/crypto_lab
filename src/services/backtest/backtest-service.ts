import "server-only";
import { logger } from "@/lib/logger";
import { marketData, mongoStore, type MarketResult } from "@/services/binance";
import type { Kline } from "@/services/binance/schemas";
import { getDiscoveryScan } from "@/services/discovery/discovery-service";
import { isLikelyTokenizedStock } from "@/services/market/asset-names";
import { externalCache } from "@/services/external/http";
import { runBacktest, type BacktestResult } from "./signal-backtest";

/**
 * Signal Lab: runs the signal backtest over the most liquid pairs of the current discovery scan
 * with up to 1000 daily candles each (~2.7 years). Costs ~100 Binance requests, so the result is
 * cached for 12 hours and persisted.
 */
const KEY = "backtest:signals:v1";
const TTL = 12 * 60 * 60;
const PAIRS = 100;
const CANDLES = 1000;
const CONCURRENCY = 8;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export type SignalBacktest = BacktestResult & { universe: string[] };

async function compute(): Promise<SignalBacktest> {
  const started = Date.now();
  const scan = await getDiscoveryScan();
  const universe = scan.data.rows
    .filter((r) => r.quoteAsset === "USDT" && !isLikelyTokenizedStock(r.baseAsset))
    .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h)
    .slice(0, PAIRS)
    .map((r) => r.symbol);
  if (!universe.includes("BTCUSDT")) universe.unshift("BTCUSDT");
  const md = marketData();
  const histories = await mapLimit(universe, CONCURRENCY, (s) => md.recentDailyCandles(s, CANDLES).catch((): Kline[] | null => null));
  const now = Date.now();
  const pairs = universe
    .map((symbol, i) => ({ symbol, candles: (histories[i] ?? []).filter((k) => k.closeTime < now) }))
    .filter((p) => p.candles.length > 0);
  const btc = pairs.find((p) => p.symbol === "BTCUSDT")?.candles ?? null;
  const result = runBacktest(pairs.filter((p) => p.symbol !== "BTCUSDT"), btc);
  logger.info("backtest.computed", { pairs: result.pairs, ms: Date.now() - started });
  return { ...result, universe: pairs.map((p) => p.symbol) };
}

export async function getSignalBacktest(): Promise<MarketResult<SignalBacktest>> {
  return externalCache().get(KEY, TTL, compute, { persist: true, persistEverySeconds: TTL });
}

/** The last computed backtest without triggering a new run (for Autopilot, which must stay fast). */
export async function cachedSignalBacktest(): Promise<SignalBacktest | null> {
  const mem = externalCache().peek(KEY);
  if (mem) return mem.data as SignalBacktest;
  const persisted = await mongoStore.read(KEY).catch(() => null);
  return persisted ? (persisted.data as SignalBacktest) : null;
}
