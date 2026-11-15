import "server-only";
import { logger } from "@/lib/logger";
import { marketData, mongoStore, type MarketResult } from "@/services/binance";
import type { Kline } from "@/services/binance/schemas";
import { getDiscoveryScan } from "@/services/discovery/discovery-service";
import { isLikelyTokenizedStock } from "@/services/market/asset-names";
import { externalCache } from "@/services/external/http";
import { MarketCache } from "@/services/binance/cache";
import { runBacktest, type BacktestResult } from "./signal-backtest";
import { runExitBacktest, type ExitBacktestResult } from "./exit-backtest";
import { runStrategyBacktest, type StrategyBacktest } from "./strategy-backtest";
import { directionHistory } from "@/services/market/direction-service";
import { regimeOf } from "@/services/market/direction";
import { fearGreedHistory } from "@/services/signals/market-intel";
import { isTrackerOrPegged } from "@/services/market/asset-names";

/**
 * Signal Lab: runs the signal backtest over the most liquid pairs of the current discovery scan
 * with up to 1000 daily candles each (~2.7 years). Costs ~100 Binance requests, so the result is
 * cached for 12 hours and persisted.
 */
const KEY = "backtest:signals:v2";
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

export interface UniverseHistories {
  /** Closed daily candles per pair (BTCUSDT included), oldest first. */
  pairs: Array<{ symbol: string; candles: Kline[] }>;
  btc: Kline[] | null;
  /** Today's still-forming candle per pair, as of `loadedAt` (for scoring with current prices). */
  live: Record<string, Kline>;
  loadedAt: number;
}

const globalForHistories = globalThis as unknown as { __cryptoLabHistories?: MarketCache };

/**
 * Up to 1000 closed daily candles for the most liquid pairs. Shared by Signal Lab and the
 * learning model; kept in memory only (too large to persist) for 3 hours.
 */
export async function loadUniverseHistories(): Promise<UniverseHistories> {
  globalForHistories.__cryptoLabHistories ??= new MarketCache(null, Date.now, 2);
  const res = await globalForHistories.__cryptoLabHistories.get("universe:histories", 3 * 60 * 60, loadHistories);
  return res.data;
}

async function loadHistories(): Promise<UniverseHistories> {
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
  const live: Record<string, Kline> = {};
  const pairs = universe
    .map((symbol, i) => {
      const all = histories[i] ?? [];
      const forming = all[all.length - 1];
      if (forming && forming.closeTime >= now) live[symbol] = forming;
      return { symbol, candles: all.filter((k) => k.closeTime < now) };
    })
    .filter((p) => p.candles.length > 0);
  return { pairs, btc: pairs.find((p) => p.symbol === "BTCUSDT")?.candles ?? null, live, loadedAt: now };
}

async function compute(): Promise<SignalBacktest> {
  const started = Date.now();
  const { pairs, btc } = await loadUniverseHistories();
  const result = runBacktest(pairs.filter((p) => p.symbol !== "BTCUSDT"), btc);
  logger.info("backtest.computed", { pairs: result.pairs, ms: Date.now() - started });
  return { ...result, universe: pairs.map((p) => p.symbol) };
}

/** Exit-rule comparison on the same universe; cached like the signal backtest. */
export async function getExitBacktest(): Promise<MarketResult<ExitBacktestResult>> {
  return externalCache().get(
    "backtest:exits:v1",
    TTL,
    async () => {
      const { pairs, btc } = await loadUniverseHistories();
      return runExitBacktest(pairs.filter((p) => p.symbol !== "BTCUSDT"), btc);
    },
    { persist: true, persistEverySeconds: TTL },
  );
}

/** Complete strategies with their outcomes overall and per market regime; cached like the others. */
export async function getStrategyBacktest(): Promise<MarketResult<StrategyBacktest>> {
  return externalCache().get(
    "backtest:strategies:v1",
    TTL,
    async () => {
      const [{ pairs, btc }, history, fng] = await Promise.all([loadUniverseHistories(), directionHistory(), fearGreedHistory()]);
      const regimeByDay = new Map(history.map((d) => [Math.floor(d.t / 86_400_000), regimeOf(d.score)]));
      const alts = pairs.filter((p) => p.symbol !== "BTCUSDT" && !isTrackerOrPegged(p.symbol.replace(/USDT$/, ""), p.candles.map((k) => k.close)));
      return runStrategyBacktest(alts, btc, regimeByDay, fng);
    },
    { persist: true, persistEverySeconds: TTL },
  );
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
