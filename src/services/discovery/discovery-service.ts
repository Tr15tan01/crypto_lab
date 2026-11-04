import "server-only";
import { ObjectId } from "mongodb";
import { aiEnv } from "@/lib/env";
import { getCollections } from "@/lib/mongodb/collections";
import { AppError, MarketUnavailableError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { marketData, mongoStore, type MarketResult, type MarketTicker } from "@/services/binance";
import { MarketCache } from "@/services/binance/cache";
import type { Kline } from "@/services/binance/schemas";
import { getAIProvider } from "@/services/ai/providers/factory";
import { SHORTLIST_SYSTEM_PROMPT } from "@/services/ai/orchestration/prompts";
import type { DiscoveryShortlistDoc } from "@/models";
import { analyzePair, benchmarkReturns, type Benchmark, type DiscoveryRow } from "./screens";
import { SIGNAL_INFO, THRESHOLDS } from "./signals";

/**
 * Discovery scan: the liquid USDT pairs, each with its recent daily candles run through the
 * screens. One scan costs a few hundred Binance requests (weight 2 each), so the whole result
 * is cached for SCAN_TTL_SECONDS and persisted as the last good copy.
 */
const QUOTE_ASSET = "USDT";
const BENCHMARK_SYMBOL = "BTCUSDT";
export const MIN_QUOTE_VOLUME = 250_000;
const MAX_PAIRS = 300;
const CONCURRENCY = 12;
const SCAN_TTL_SECONDS = 15 * 60;
/** A scan with more failed pairs than this share is treated as failed (stale copy served instead). */
const MAX_FAILURE_SHARE = 0.25;
export const MAX_SHORTLIST = 8;

/** Stablecoins and fiat tokens: their "moves" are noise for discovery purposes. */
const EXCLUDED_BASES = new Set([
  "USDC", "FDUSD", "TUSD", "USDP", "DAI", "BUSD", "USDE", "PYUSD", "USD1", "XUSD", "BFUSD", "RLUSD",
  "EUR", "EURI", "AEUR", "GBP", "TRY", "BRL", "AUD", "UAH", "ZAR", "PLN", "RON", "ARS", "JPY", "MXN", "COP", "CZK",
]);

export interface DiscoveryScan {
  rows: DiscoveryRow[];
  benchmark: Benchmark & { symbol: string };
  universe: { quoteAsset: string; minQuoteVolume: number; candidates: number; scanned: number; failed: number };
}

const globalForDiscovery = globalThis as unknown as { __cryptoLabDiscoveryCache?: MarketCache };

function scanCache(): MarketCache {
  globalForDiscovery.__cryptoLabDiscoveryCache ??= new MarketCache(mongoStore, Date.now, 4);
  return globalForDiscovery.__cryptoLabDiscoveryCache;
}

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

export function scanUniverse(tickers: MarketTicker[]): MarketTicker[] {
  return tickers
    .filter((t) => t.quoteAsset === QUOTE_ASSET && t.quoteVolume >= MIN_QUOTE_VOLUME && !EXCLUDED_BASES.has(t.baseAsset))
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, MAX_PAIRS);
}

async function runScan(): Promise<DiscoveryScan> {
  const md = marketData();
  const tickers = await md.allTickers();
  if (tickers.stale) throw new MarketUnavailableError("Live tickers are unavailable, so a new discovery scan was not run.");

  const universe = scanUniverse(tickers.data);
  if (!universe.some((t) => t.symbol === BENCHMARK_SYMBOL)) {
    const btc = tickers.data.find((t) => t.symbol === BENCHMARK_SYMBOL);
    if (btc) universe.unshift(btc);
  }

  const histories = await mapLimit(universe, CONCURRENCY, (t) =>
    md.recentDailyCandles(t.symbol, THRESHOLDS.historyDays).catch((): Kline[] | null => null),
  );
  const failed = histories.filter((h) => h === null).length;
  if (failed > universe.length * MAX_FAILURE_SHARE) {
    throw new MarketUnavailableError(`Daily history could not be loaded for ${failed} of ${universe.length} pairs.`);
  }

  const now = Date.now();
  const btcIndex = universe.findIndex((t) => t.symbol === BENCHMARK_SYMBOL);
  const btcHistory = btcIndex >= 0 ? histories[btcIndex] : null;
  const benchmark: Benchmark = btcHistory
    ? benchmarkReturns(universe[btcIndex]!.price, btcHistory, now)
    : { return7d: null, return30d: null };

  const rows: DiscoveryRow[] = [];
  universe.forEach((t, i) => {
    const h = histories[i];
    if (h && h.length > 0) rows.push(analyzePair(t, h, { now, historyLimit: THRESHOLDS.historyDays, benchmark }));
  });
  logger.info("discovery.scanned", { pairs: rows.length, failed });

  return {
    rows,
    benchmark: { symbol: BENCHMARK_SYMBOL, ...benchmark },
    universe: { quoteAsset: QUOTE_ASSET, minQuoteVolume: MIN_QUOTE_VOLUME, candidates: universe.length, scanned: rows.length, failed },
  };
}

export async function getDiscoveryScan(): Promise<MarketResult<DiscoveryScan>> {
  return scanCache().get("discovery:v2", SCAN_TTL_SECONDS, runScan, { persist: true, persistEverySeconds: SCAN_TTL_SECONDS });
}

/* ───────────── AI shortlist ───────────── */

function compactRow(r: DiscoveryRow) {
  const n = (v: number | null) => (v === null ? null : Number(v.toPrecision(5)));
  return {
    pair: r.symbol,
    name: r.name,
    price: r.price,
    change24hPercent: n(r.change24h),
    quoteVolume24h: Math.round(r.quoteVolume24h),
    volumeVsUsual: n(r.volumeRatio),
    return7dPercent: n(r.return7d),
    return30dPercent: n(r.return30d),
    vsBtc7dPercent: n(r.vsBtc7d),
    vsBtc30dPercent: n(r.vsBtc30d),
    firstAvailableBinanceTradingData: r.firstTradeAt ? new Date(r.firstTradeAt).toISOString() : null,
    sma50: n(r.sma50),
    sma200: n(r.sma200),
    goldenCrossDaysAgo: r.goldenCrossDaysAgo,
    rsi14: n(r.rsi14),
    rsiLowLast10d: n(r.rsiLow),
    high90d: r.high90d,
    fromHigh90dPercent: n(r.fromHigh90d),
    signals: r.signals.map((s) => SIGNAL_INFO[s].label),
    cautions: r.cautions,
  };
}

/** Asks the AI for a for/against review of up to MAX_SHORTLIST candidates from the current scan, and stores it. */
export async function generateShortlist(userId: string, screen: string, symbols: string[], signal?: AbortSignal) {
  const provider = getAIProvider(); // fails fast with a clear configuration error
  const scan = await getDiscoveryScan();
  const bySymbol = new Map(scan.data.rows.map((r) => [r.symbol, r]));
  const rows = [...new Set(symbols)].map((s) => bySymbol.get(s)).filter((r): r is DiscoveryRow => Boolean(r)).slice(0, MAX_SHORTLIST);
  if (rows.length === 0) throw new ValidationError("None of these pairs are in the current discovery scan. Refresh the page and try again.");

  const candidates = rows.map(compactRow);
  const context = {
    source: "Binance Spot public market data, daily candles; screens computed by the application",
    scanTimestamp: new Date(scan.fetchedAt).toISOString(),
    scanStale: scan.stale,
    benchmark: scan.data.benchmark,
    signalDefinitions: Object.fromEntries(Object.values(SIGNAL_INFO).map((s) => [s.label, s.description])),
    notes: [
      "volumeVsUsual = 24h quote volume / median daily quote volume of the last 30 closed days.",
      "vsBtc = performance relative to BTC over the same window, in percent.",
      "firstAvailableBinanceTradingData is null when the pair has more history than the scan requested.",
    ],
    candidates,
  };

  const raw = await provider.generate({
    system: SHORTLIST_SYSTEM_PROMPT,
    messages: [{ role: "user", content: `APPLICATION CONTEXT (JSON):\n${JSON.stringify(context)}\n\nReview these ${rows.length} candidates.` }],
    signal,
    maxOutputTokens: Math.max(aiEnv().AI_MAX_OUTPUT_TOKENS, 4000),
  });
  if (!raw.trim()) throw new AppError("AI_UNAVAILABLE", "The AI provider returned an empty review. Retry.", { retryable: true });

  const { discoveryShortlists } = await getCollections();
  const doc: DiscoveryShortlistDoc = {
    _id: new ObjectId(),
    userId,
    provider: provider.name,
    model: provider.model,
    screen,
    symbols: rows.map((r) => r.symbol),
    candidates,
    content: raw.trim(),
    scanTimestamp: new Date(scan.fetchedAt),
    scanStale: scan.stale,
    timestamp: new Date(),
  };
  await discoveryShortlists.insertOne(doc);
  logger.info("discovery.shortlist_generated", { screen, count: rows.length, provider: doc.provider });
  return doc;
}

export async function listShortlists(userId: string, limit = 10) {
  const { discoveryShortlists } = await getCollections();
  return discoveryShortlists
    .find({ userId }, { projection: { candidates: 0 } })
    .sort({ timestamp: -1 })
    .limit(Math.min(limit, 50))
    .toArray();
}
