import type { Kline } from "@/services/binance/schemas";
import type { MarketTicker } from "@/services/binance/market-data";
import { bollinger, last, rsi, sma } from "@/services/indicators/core";
import { pctChange } from "@/lib/utils/math";
import { formatCompact } from "@/lib/utils/format";
import { THRESHOLDS, type DiscoverySignal } from "./signals";

/**
 * Discovery screens. Pure functions, no I/O: one pair's live ticker plus its recent daily
 * candles in, one row of metrics and signals out. Signals describe unusual activity; they are
 * not forecasts, and the cautions list says what makes a flagged pair riskier.
 */
const DAY_MS = 24 * 60 * 60_000;

export interface Benchmark {
  return7d: number | null;
  return30d: number | null;
}

export interface DiscoveryRow {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  name: string | null;
  price: number;
  change24h: number;
  quoteVolume24h: number;
  /** First daily candle when the whole Binance history fits in the requested window, else null. */
  firstTradeAt: number | null;
  listedDays: number | null;
  /** 24h quote volume divided by the median daily quote volume of the last 30 closed days. */
  volumeRatio: number | null;
  return7d: number | null;
  return30d: number | null;
  /** Relative strength vs BTC in percent: ((1 + r) / (1 + r_btc) − 1) × 100. */
  vsBtc7d: number | null;
  vsBtc30d: number | null;
  sma50: number | null;
  sma200: number | null;
  goldenCrossDaysAgo: number | null;
  /** RSI(14) with the live price standing in for today's close. */
  rsi14: number | null;
  rsiLow: number | null;
  high90d: number | null;
  fromHigh90d: number | null;
  /** Percentile (0–100) of today's Bollinger bandwidth within the squeeze lookback. Low = quiet. */
  bandwidthPercentile: number | null;
  /** 20-day on-balance-volume flow as a share of 20-day volume (−1 … +1). */
  volumeFlow20d: number | null;
  signals: DiscoverySignal[];
  cautions: string[];
  /** Number of independent signals firing. */
  score: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Return from the close `n` closed candles back to the current price (same convention as the indicator summary). */
function returnOver(closes: number[], price: number, n: number): number | null {
  return closes.length > n ? pctChange(closes[closes.length - 1 - n]!, price) : null;
}

function relativeTo(r: number | null, benchmark: number | null): number | null {
  if (r === null || benchmark === null || benchmark <= -100) return null;
  return ((1 + r / 100) / (1 + benchmark / 100) - 1) * 100;
}

function closedCandles(candles: Kline[], now: number): Kline[] {
  return candles.filter((k) => k.closeTime < now);
}

export function benchmarkReturns(price: number, candles: Kline[], now: number): Benchmark {
  const closes = closedCandles(candles, now).map((k) => k.close);
  return { return7d: returnOver(closes, price, 7), return30d: returnOver(closes, price, 30) };
}

/** Days since the most recent SMA 50 / SMA 200 upward cross, if within the lookback and still above. */
function goldenCross(closes: number[]): number | null {
  const fast = sma(closes, 50);
  const slow = sma(closes, 200);
  const n = closes.length;
  if (n < 201 || !(fast[n - 1]! > slow[n - 1]!)) return null;
  for (let i = n - 1; i >= Math.max(200, n - THRESHOLDS.crossLookbackDays); i--) {
    const above = fast[i]! > slow[i]!;
    const wasAbove = fast[i - 1]! > slow[i - 1]!;
    if (above && !wasAbove) return n - 1 - i;
  }
  return null;
}

/** Where today's Bollinger bandwidth ranks among the last `lookback` days, in percent. */
export function bandwidthPercentile(closes: number[], lookback: number): number | null {
  const bb = bollinger(closes, 20, 2);
  const widths: number[] = [];
  for (let i = Math.max(0, closes.length - lookback); i < closes.length; i++) {
    const u = bb.upper[i];
    const l = bb.lower[i];
    const m = bb.middle[i];
    if (u !== null && l !== null && m !== null && m !== undefined && u !== undefined && l !== undefined && m > 0) widths.push((u - l) / m);
  }
  if (widths.length < lookback * 0.8) return null;
  const today = widths[widths.length - 1]!;
  return (widths.filter((w) => w < today).length / (widths.length - 1)) * 100;
}

/** Net on-balance volume over the last `days` closed candles, divided by their total volume. */
export function volumeFlow(candles: Kline[], days: number): number | null {
  if (candles.length <= days) return null;
  let flow = 0;
  let total = 0;
  for (let i = candles.length - days; i < candles.length; i++) {
    const dir = Math.sign(candles[i]!.close - candles[i - 1]!.close);
    flow += dir * candles[i]!.volume;
    total += candles[i]!.volume;
  }
  return total > 0 ? flow / total : null;
}

export function analyzePair(
  ticker: MarketTicker,
  candles: Kline[],
  opts: { now: number; historyLimit: number; benchmark: Benchmark | null },
): DiscoveryRow {
  const { now, historyLimit, benchmark } = opts;
  const closed = closedCandles(candles, now);
  const closes = closed.map((k) => k.close);
  const price = ticker.price;

  // Fewer candles than requested means Binance has no older data: the first one is the first trading day.
  const firstTradeAt = candles.length > 0 && candles.length < historyLimit ? candles[0]!.openTime : null;
  const listedDays = firstTradeAt !== null ? Math.floor((now - firstTradeAt) / DAY_MS) : null;

  const usualVolume = closed.length >= 7 ? median(closed.slice(-30).map((k) => k.quoteVolume)) : null;
  const volumeRatio = usualVolume ? ticker.quoteVolume / usualVolume : null;

  const return7d = returnOver(closes, price, 7);
  const return30d = returnOver(closes, price, 30);
  const vsBtc7d = relativeTo(return7d, benchmark?.return7d ?? null);
  const vsBtc30d = relativeTo(return30d, benchmark?.return30d ?? null);

  const rsiSeries = rsi([...closes, price], 14);
  const rsi14 = last(rsiSeries);
  const recentRsi = rsiSeries.slice(-THRESHOLDS.bounceLookbackDays - 1, -1).filter((v): v is number => v !== null);
  const rsiLow = recentRsi.length ? Math.min(...recentRsi) : null;

  const window = closed.slice(-THRESHOLDS.breakoutDays);
  const high90d = window.length >= THRESHOLDS.breakoutDays ? Math.max(...window.map((k) => k.high)) : null;

  const signals: DiscoverySignal[] = [];
  if (listedDays !== null && listedDays <= THRESHOLDS.newListingDays) signals.push("new_listing");
  if (volumeRatio !== null && volumeRatio >= THRESHOLDS.volumeSurgeRatio) signals.push("volume_surge");
  if (vsBtc7d !== null && vsBtc30d !== null && vsBtc7d > 0 && vsBtc30d >= THRESHOLDS.outperform30dPercent) {
    signals.push("outperforming_btc");
  }
  const goldenCrossDaysAgo = goldenCross(closes);
  if (goldenCrossDaysAgo !== null) signals.push("golden_cross");
  if (rsiLow !== null && rsi14 !== null && rsiLow <= THRESHOLDS.oversoldRsi && rsi14 >= THRESHOLDS.bounceRsi) {
    signals.push("oversold_bounce");
  }
  if (high90d !== null && price > high90d) signals.push("breakout");

  const bwPct = bandwidthPercentile(closes, THRESHOLDS.squeezeLookbackDays);
  if (bwPct !== null && bwPct <= THRESHOLDS.squeezePercentile) signals.push("volatility_squeeze");

  const sma50v = last(sma(closes, 50));
  const sma200v = last(sma(closes, 200));
  if (
    sma50v !== null && sma200v !== null && sma50v > sma200v && price > sma200v &&
    rsi14 !== null && rsi14 >= THRESHOLDS.pullbackRsiLow && rsi14 <= THRESHOLDS.pullbackRsiHigh
  ) {
    signals.push("trend_pullback");
  }

  const flow = volumeFlow(closed, THRESHOLDS.accumulationDays);
  const move = returnOver(closes, price, THRESHOLDS.accumulationDays);
  if (flow !== null && move !== null && flow >= THRESHOLDS.accumulationFlow && Math.abs(move) < THRESHOLDS.accumulationMaxMovePercent) {
    signals.push("accumulation");
  }

  const cautions: string[] = [];
  if (ticker.quoteVolume < THRESHOLDS.thinLiquidity) {
    cautions.push(
      `Thin liquidity: under ${formatCompact(THRESHOLDS.thinLiquidity)} traded in 24h, so small orders can move the price sharply.`,
    );
  }
  if (return7d !== null && return7d >= 50) {
    cautions.push(`Already up ${return7d.toFixed(0)}% in 7 days; entries after large runs carry high pullback risk.`);
  }
  if (ticker.priceChangePercent >= 25 && volumeRatio !== null && volumeRatio >= 5) {
    cautions.push("Large 24h move on extreme volume: consistent with a short-lived pump.");
  }
  if (listedDays !== null && listedDays < 14) {
    cautions.push("Under 14 days of trading history: indicators are unreliable and new listings are often volatile.");
  }

  return {
    symbol: ticker.symbol,
    baseAsset: ticker.baseAsset,
    quoteAsset: ticker.quoteAsset,
    name: ticker.name,
    price,
    change24h: ticker.priceChangePercent,
    quoteVolume24h: ticker.quoteVolume,
    firstTradeAt,
    listedDays,
    volumeRatio,
    return7d,
    return30d,
    vsBtc7d,
    vsBtc30d,
    sma50: sma50v,
    sma200: sma200v,
    goldenCrossDaysAgo,
    rsi14,
    rsiLow,
    high90d,
    fromHigh90d: high90d !== null ? pctChange(high90d, price) : null,
    bandwidthPercentile: bwPct,
    volumeFlow20d: flow,
    signals,
    cautions,
    score: signals.length,
  };
}
