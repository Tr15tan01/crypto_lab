import type { Kline } from "@/services/binance/schemas";
import { atr, bollinger, ema, last, logReturnStdDev, macd, rsi, sma, swingLevels } from "./core";

export type Reading = "bullish" | "bearish" | "neutral";

export interface IndicatorSignal {
  name: string;
  value: string;
  reading: Reading;
  note: string;
}

export interface IndicatorSummary {
  interval: string;
  candles: number;
  asOf: number | null; // close time of the last candle used
  price: number;
  rsi14: number | null;
  macd: { macd: number; signal: number; histogram: number } | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  sma50: number | null;
  bollinger: { upper: number; middle: number; lower: number; bandwidthPercent: number; percentB: number } | null;
  atr14: number | null;
  atrPercent: number | null;
  volume: { last: number; sma20: number | null; ratio: number | null };
  volatility: { periodStdPercent: number | null; annualizedPercent: number | null };
  returns: Record<string, number | null>;
  range: { high: number; low: number; positionPercent: number | null } | null;
  levels: { support: number[]; resistance: number[] };
  signals: IndicatorSignal[];
  warnings: string[];
}

const PERIODS_PER_YEAR: Record<string, number> = { "1h": 24 * 365, "4h": 6 * 365, "1d": 365, "1w": 52 };

function pct(a: number, b: number): number | null {
  return b === 0 ? null : ((a - b) / b) * 100;
}

function fmt(n: number, d = 2) {
  return Number.isFinite(n) ? n.toFixed(d) : "n/a";
}

/**
 * Computes indicators from closed candles and produces rule-based readings.
 * Readings are conventional interpretations, not forecasts; the warnings list explains gaps.
 */
export function summarizeIndicators(klines: Kline[], interval: string, currentPrice?: number): IndicatorSummary {
  const now = Date.now();
  // Exclude a still-forming candle so indicators are computed on closed data only.
  const closed = klines.filter((k) => k.closeTime < now);
  const closes = closed.map((k) => k.close);
  const volumes = closed.map((k) => k.volume);
  const price = currentPrice ?? closes[closes.length - 1] ?? NaN;
  const warnings: string[] = [];
  const need = (n: number, what: string) => {
    if (closes.length < n) warnings.push(`Not enough history for ${what} (needs ${n} candles, have ${closes.length}).`);
  };
  need(15, "RSI(14)");
  need(35, "MACD(12,26,9)");
  need(20, "Bollinger Bands(20,2)");
  need(50, "EMA(50)");
  need(200, "EMA(200)");

  const rsi14 = last(rsi(closes, 14));
  const m = macd(closes);
  const macdVal = last(m.macd);
  const sigVal = last(m.signal);
  const histVal = last(m.histogram);
  const ema20 = last(ema(closes, 20));
  const ema50 = last(ema(closes, 50));
  const ema200 = last(ema(closes, 200));
  const sma50 = last(sma(closes, 50));
  const bb = bollinger(closes, 20, 2);
  const bbU = last(bb.upper);
  const bbM = last(bb.middle);
  const bbL = last(bb.lower);
  const atr14 = last(atr(closed, 14));
  const volSma = last(sma(volumes, 20));
  const lastVol = volumes[volumes.length - 1] ?? 0;

  const recent = closes.slice(-30);
  const stdev = logReturnStdDev(recent);
  const perYear = PERIODS_PER_YEAR[interval];

  const ret = (n: number) => (closes.length > n ? pct(price, closes[closes.length - 1 - n]!) : null);
  const returns: Record<string, number | null> =
    interval === "1d"
      ? { "1d": ret(1), "7d": ret(7), "30d": ret(30), "90d": ret(90), "365d": ret(365) }
      : { "1": ret(1), "6": ret(6), "24": ret(24) };

  const window = closed.slice(-90);
  const range =
    window.length > 0
      ? (() => {
          const high = Math.max(...window.map((k) => k.high));
          const low = Math.min(...window.map((k) => k.low));
          return { high, low, positionPercent: high > low ? ((price - low) / (high - low)) * 100 : null };
        })()
      : null;

  const signals: IndicatorSignal[] = [];
  if (rsi14 !== null) {
    signals.push({
      name: "RSI(14)",
      value: fmt(rsi14, 1),
      reading: rsi14 >= 70 ? "bearish" : rsi14 <= 30 ? "bullish" : "neutral",
      note:
        rsi14 >= 70
          ? "Above 70 — conventionally 'overbought'; strong trends can stay overbought for long periods."
          : rsi14 <= 30
            ? "Below 30 — conventionally 'oversold'; falling markets can stay oversold."
            : "Between 30 and 70 — no extreme reading.",
    });
  }
  if (macdVal !== null && sigVal !== null && histVal !== null) {
    signals.push({
      name: "MACD(12,26,9)",
      value: `${fmt(macdVal, 4)} / signal ${fmt(sigVal, 4)}`,
      reading: histVal > 0 ? "bullish" : histVal < 0 ? "bearish" : "neutral",
      note: histVal > 0 ? "MACD above its signal line — positive momentum." : "MACD below its signal line — negative momentum.",
    });
  }
  if (ema50 !== null && ema200 !== null) {
    signals.push({
      name: "EMA 50 vs 200",
      value: `${fmt(ema50)} vs ${fmt(ema200)}`,
      reading: ema50 > ema200 ? "bullish" : "bearish",
      note:
        ema50 > ema200
          ? "50 EMA above 200 EMA — longer-term uptrend structure."
          : "50 EMA below 200 EMA — longer-term downtrend structure.",
    });
  }
  if (ema20 !== null) {
    signals.push({
      name: "Price vs EMA 20",
      value: `${fmt(pct(price, ema20) ?? NaN)}%`,
      reading: price > ema20 ? "bullish" : "bearish",
      note: price > ema20 ? "Price above its short-term average." : "Price below its short-term average.",
    });
  }
  if (bbU !== null && bbL !== null) {
    const pb = bbU > bbL ? (price - bbL) / (bbU - bbL) : 0.5;
    signals.push({
      name: "Bollinger %B",
      value: fmt(pb * 100, 0),
      reading: "neutral",
      note:
        pb > 1
          ? "Price above the upper band — stretched relative to recent volatility."
          : pb < 0
            ? "Price below the lower band — stretched to the downside."
            : "Price inside the bands.",
    });
  }
  if (volSma !== null && volSma > 0) {
    const ratio = lastVol / volSma;
    signals.push({
      name: "Volume vs 20-period average",
      value: `${fmt(ratio, 2)}×`,
      reading: "neutral",
      note:
        ratio >= 2
          ? "Volume is unusually high (≥2× average) — moves on high volume are often considered more significant."
          : ratio <= 0.5
            ? "Volume is unusually low (≤0.5× average)."
            : "Volume is within a normal range.",
    });
  }

  return {
    interval,
    candles: closes.length,
    asOf: closed.length ? closed[closed.length - 1]!.closeTime : null,
    price,
    rsi14,
    macd: macdVal !== null && sigVal !== null && histVal !== null ? { macd: macdVal, signal: sigVal, histogram: histVal } : null,
    ema20,
    ema50,
    ema200,
    sma50,
    bollinger:
      bbU !== null && bbM !== null && bbL !== null
        ? {
            upper: bbU,
            middle: bbM,
            lower: bbL,
            bandwidthPercent: bbM ? ((bbU - bbL) / bbM) * 100 : 0,
            percentB: bbU > bbL ? ((price - bbL) / (bbU - bbL)) * 100 : 50,
          }
        : null,
    atr14,
    atrPercent: atr14 !== null && price ? (atr14 / price) * 100 : null,
    volume: { last: lastVol, sma20: volSma, ratio: volSma ? lastVol / volSma : null },
    volatility: {
      periodStdPercent: stdev !== null ? stdev * 100 : null,
      annualizedPercent: stdev !== null && perYear ? stdev * Math.sqrt(perYear) * 100 : null,
    },
    returns,
    range,
    levels: swingLevels(closed.slice(-120), price),
    signals,
    warnings,
  };
}
