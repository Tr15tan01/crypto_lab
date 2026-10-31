import { z } from "zod";
import { MarketUnavailableError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { assetName } from "@/services/market/asset-names";
import type { BinanceHttpClient } from "./http";
import { MarketCache, type MarketResult } from "./cache";
import {
  exchangeInfoSchema,
  exchangeSymbolSchema,
  parseKlines,
  ticker24hSchema,
  type Kline,
  type Ticker24h,
} from "./schemas";
import {
  INTERVAL_MS,
  MAX_CANDLES,
  PERIOD_MS,
  isAllowedCombination,
  klineTtlSeconds,
  type ChartPeriod,
  type KlineInterval,
} from "./intervals";

export interface SymbolInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  /** True only for status TRADING with spot trading allowed. */
  tradable: boolean;
}

export interface MarketTicker {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  name: string | null;
  price: number;
  priceChange: number;
  priceChangePercent: number;
  open: number;
  high: number;
  low: number;
  weightedAvgPrice: number;
  volume: number;
  quoteVolume: number;
  tradeCount: number;
  openTime: number;
  closeTime: number;
}

export interface MarketStatus {
  state: "live" | "stale" | "unavailable";
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  pausedUntil: number | null;
}

export interface MarketDataConfig {
  tickerTtlSeconds: number;
}

const SYMBOL_RE = /^[A-Z0-9]{2,20}$/;

export function normalizeSymbol(input: string): string {
  const s = input.trim().toUpperCase();
  if (!SYMBOL_RE.test(s)) throw new ValidationError("Invalid trading pair symbol.");
  return s;
}

function toMarketTicker(t: Ticker24h, info: SymbolInfo): MarketTicker {
  return {
    symbol: t.symbol,
    baseAsset: info.baseAsset,
    quoteAsset: info.quoteAsset,
    name: assetName(info.baseAsset),
    price: t.lastPrice,
    priceChange: t.priceChange,
    priceChangePercent: t.priceChangePercent,
    open: t.openPrice,
    high: t.highPrice,
    low: t.lowPrice,
    weightedAvgPrice: t.weightedAvgPrice,
    volume: t.volume,
    quoteVolume: t.quoteVolume,
    tradeCount: t.count,
    openTime: t.openTime,
    closeTime: t.closeTime,
  };
}

/**
 * Binance Spot market-data service. All reads go through MarketCache, so callers always get
 * the fetch timestamp and a stale flag, and repeated requests are served from memory.
 */
export class BinanceMarketData {
  private lastSuccessAt: number | null = null;
  private lastFailureAt: number | null = null;
  private lastOutcome: "success" | "failure" | null = null;

  constructor(
    private readonly http: BinanceHttpClient,
    private readonly cache: MarketCache,
    private readonly config: MarketDataConfig,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Runs a fetch. Only the live ticker feed (`critical`) drives the overall status, so a bad
   * request for one symbol does not mark the whole market feed as stale.
   */
  private async track<T>(fn: () => Promise<T>, critical = false): Promise<T> {
    try {
      const r = await fn();
      if (critical) {
        this.lastSuccessAt = this.now();
        this.lastOutcome = "success";
      }
      return r;
    } catch (err) {
      if (critical) {
        this.lastFailureAt = this.now();
        this.lastOutcome = "failure";
      }
      throw err;
    }
  }

  status(): MarketStatus {
    const pausedUntil = this.http.isPaused ? this.http.pausedUntilMs : null;
    let state: MarketStatus["state"] = "unavailable";
    if (this.lastSuccessAt) {
      state = this.lastOutcome === "failure" || pausedUntil ? "stale" : "live";
    }
    return { state, lastSuccessAt: this.lastSuccessAt, lastFailureAt: this.lastFailureAt, pausedUntil };
  }

  /* ───────────── Exchange info ───────────── */

  async exchangeSymbols(): Promise<MarketResult<SymbolInfo[]>> {
    return this.cache.get(
      "exchangeInfo:v1",
      3600,
      () =>
        this.track(async () => {
          const raw = exchangeInfoSchema.parse(
            await this.http.getJson("/api/v3/exchangeInfo", { permissions: "SPOT", showPermissionSets: "false" }),
          );
          const out: SymbolInfo[] = [];
          for (const s of raw.symbols) {
            const parsed = exchangeSymbolSchema.safeParse(s);
            if (!parsed.success) continue;
            const d = parsed.data;
            out.push({
              symbol: d.symbol,
              baseAsset: d.baseAsset,
              quoteAsset: d.quoteAsset,
              status: d.status,
              tradable: d.status === "TRADING" && d.isSpotTradingAllowed !== false,
            });
          }
          if (out.length === 0) throw new MarketUnavailableError("Binance returned no symbols.");
          return out;
        }),
      { persist: true, persistEverySeconds: 3600 },
    );
  }

  async symbolMap(): Promise<MarketResult<Map<string, SymbolInfo>>> {
    const res = await this.exchangeSymbols();
    return { ...res, data: new Map(res.data.map((s) => [s.symbol, s])) };
  }

  /** `null` data means the pair is not listed on Binance Spot (never listed or removed). */
  async symbolInfo(symbol: string): Promise<MarketResult<SymbolInfo | null>> {
    const res = await this.symbolMap();
    return { ...res, data: res.data.get(normalizeSymbol(symbol)) ?? null };
  }

  /* ───────────── Tickers ───────────── */

  private async rawTickers(): Promise<MarketResult<Ticker24h[]>> {
    return this.cache.get(
      "tickers24h:v1",
      this.config.tickerTtlSeconds,
      () =>
        this.track(async () => {
          const raw = z.array(z.unknown()).parse(await this.http.getJson("/api/v3/ticker/24hr"));
          const out: Ticker24h[] = [];
          let invalid = 0;
          for (const row of raw) {
            const p = ticker24hSchema.safeParse(row);
            if (p.success) out.push(p.data);
            else invalid++;
          }
          if (invalid > 0) logger.debug("binance.tickers_skipped_invalid", { invalid });
          if (out.length === 0) throw new MarketUnavailableError("Binance returned no tickers.");
          return out;
        }, true),
      { persist: true, persistEverySeconds: 120 },
    );
  }

  /** All currently tradable Binance Spot pairs with their 24h statistics. */
  async allTickers(): Promise<MarketResult<MarketTicker[]>> {
    const [tickers, symbols] = await Promise.all([this.rawTickers(), this.symbolMap()]);
    const out: MarketTicker[] = [];
    for (const t of tickers.data) {
      const info = symbols.data.get(t.symbol);
      if (!info?.tradable) continue;
      // A tradable pair with no trades in 24h reports lastPrice 0 — that is "no data", not a price.
      if (t.lastPrice <= 0) continue;
      out.push(toMarketTicker(t, info));
    }
    return {
      data: out,
      fetchedAt: Math.min(tickers.fetchedAt, symbols.fetchedAt),
      stale: tickers.stale || symbols.stale,
      source: tickers.source,
    };
  }

  /**
   * A fresh ticker for one pair. `maxAgeSeconds` bounds how old a cached value may be
   * (trades use a short window). Returns `null` data if the pair is not listed.
   */
  async ticker(symbol: string, maxAgeSeconds = 10): Promise<MarketResult<MarketTicker | null>> {
    const sym = normalizeSymbol(symbol);
    const infoRes = await this.symbolInfo(sym);
    if (!infoRes.data) return { ...infoRes, data: null };
    const info = infoRes.data;

    const res = await this.cache.get(`ticker:${sym}`, maxAgeSeconds, () =>
      this.track(async () => ticker24hSchema.parse(await this.http.getJson("/api/v3/ticker/24hr", { symbol: sym }))),
    ).catch(async (err) => {
      // Fall back to the bulk ticker cache (possibly stale) before giving up.
      const all = await this.rawTickers().catch(() => null);
      const t = all?.data.find((x) => x.symbol === sym);
      if (!all || !t) throw err;
      return { data: t, fetchedAt: all.fetchedAt, stale: true, source: all.source } as MarketResult<Ticker24h>;
    });

    if (res.data.lastPrice <= 0) {
      throw new MarketUnavailableError(`No recent trades for ${sym}; a current price is not available.`);
    }
    return { ...res, data: toMarketTicker(res.data, info) };
  }

  /** Last prices for several pairs from the bulk ticker cache (one request for all). */
  async prices(symbols: string[]): Promise<MarketResult<Map<string, number>>> {
    const all = await this.rawTickers();
    const wanted = new Set(symbols);
    const map = new Map<string, number>();
    for (const t of all.data) if (wanted.has(t.symbol) && t.lastPrice > 0) map.set(t.symbol, t.lastPrice);
    return { ...all, data: map };
  }

  /* ───────────── Klines ───────────── */

  async klines(
    symbol: string,
    interval: KlineInterval,
    period: ChartPeriod,
  ): Promise<MarketResult<Kline[]>> {
    if (!isAllowedCombination(period, interval)) {
      throw new ValidationError(`Interval ${interval} is not available for the ${period} period.`);
    }
    const sym = normalizeSymbol(symbol);
    return this.cache.get(`klines:${sym}:${interval}:${period}`, klineTtlSeconds(interval), () =>
      this.track(async () => {
        const startTime = period === "all" ? 0 : this.now() - PERIOD_MS[period];
        return this.fetchBackwards(sym, interval, startTime);
      }),
    );
  }

  /** Candles for an explicit time window (used by analytics and prediction evaluation). */
  async klinesBetween(
    symbol: string,
    interval: KlineInterval,
    startTime: number,
    endTime: number,
  ): Promise<MarketResult<Kline[]>> {
    const sym = normalizeSymbol(symbol);
    const expected = Math.ceil((endTime - startTime) / INTERVAL_MS[interval]);
    if (expected > MAX_CANDLES) throw new ValidationError("Requested window is too large for this interval.");
    // Round the key so repeated requests for "now" share a cache entry.
    const bucket = Math.floor(endTime / (INTERVAL_MS[interval] * 5));
    return this.cache.get(
      `klinesBetween:${sym}:${interval}:${Math.floor(startTime / INTERVAL_MS[interval])}:${bucket}`,
      klineTtlSeconds(interval),
      () =>
        this.track(async () => {
          const out: Kline[] = [];
          let cursor = startTime;
          while (cursor < endTime && out.length < MAX_CANDLES) {
            const page = parseKlines(
              await this.http.getJson("/api/v3/klines", {
                symbol: sym,
                interval,
                startTime: cursor,
                endTime,
                limit: 1000,
              }),
            );
            if (page.length === 0) break;
            out.push(...page);
            cursor = page[page.length - 1]!.openTime + INTERVAL_MS[interval];
            if (page.length < 1000) break;
          }
          return out;
        }),
    );
  }

  /** Walks backwards from now so the most recent candles are always included. */
  private async fetchBackwards(symbol: string, interval: KlineInterval, startTime: number): Promise<Kline[]> {
    const pages: Kline[][] = [];
    let total = 0;
    let endTime: number | undefined;
    while (total < MAX_CANDLES) {
      const page = parseKlines(
        await this.http.getJson("/api/v3/klines", { symbol, interval, endTime, limit: 1000 }),
      );
      if (page.length === 0) break;
      pages.unshift(page);
      total += page.length;
      const earliest = page[0]!.openTime;
      if (page.length < 1000 || earliest <= startTime) break;
      endTime = earliest - 1;
    }
    const all = pages.flat().filter((k) => k.openTime >= startTime);
    // De-duplicate on openTime in case pages overlap.
    const seen = new Set<number>();
    return all.filter((k) => (seen.has(k.openTime) ? false : (seen.add(k.openTime), true)));
  }

  /**
   * The first daily candle Binance has for a pair: "first available Binance trading data".
   * This is NOT the project launch date or listing announcement date.
   */
  async firstCandle(symbol: string): Promise<MarketResult<Kline | null>> {
    const sym = normalizeSymbol(symbol);
    return this.cache.get(
      `firstCandle:${sym}`,
      24 * 3600,
      () =>
        this.track(async () => {
          const page = parseKlines(
            await this.http.getJson("/api/v3/klines", { symbol: sym, interval: "1d", startTime: 0, limit: 1 }),
          );
          return page[0] ?? null;
        }),
      { persist: true, persistEverySeconds: 24 * 3600 },
    );
  }
}
