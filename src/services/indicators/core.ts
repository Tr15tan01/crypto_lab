/**
 * Deterministic technical indicators. Pure functions, no I/O.
 *
 * Every series function returns an array aligned with the input, with `null` where there is not
 * enough history yet. Nothing is extrapolated or back-filled.
 */
export type Series = Array<number | null>;

export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** EMA seeded with the SMA of the first `period` values (standard convention). */
export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** EMA over a series that may start with nulls (used for the MACD signal line). */
function emaOfSeries(series: Series, period: number): Series {
  const out: Series = new Array(series.length).fill(null);
  const firstIdx = series.findIndex((v) => v !== null);
  if (firstIdx < 0) return out;
  const values = series.slice(firstIdx) as number[];
  const e = ema(values, period);
  for (let i = 0; i < e.length; i++) out[firstIdx + i] = e[i]!;
  return out;
}

/** Relative Strength Index with Wilder's smoothing. */
export function rsi(closes: number[], period = 14): Series {
  const out: Series = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  const value = () => (avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss));
  out[period] = value();
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = value();
  }
  return out;
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  histogram: Series;
}

export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line: Series = closes.map((_, i) => (ef[i] !== null && es[i] !== null ? ef[i]! - es[i]! : null));
  const signal = emaOfSeries(line, signalPeriod);
  const histogram: Series = line.map((v, i) => (v !== null && signal[i] !== null ? v - signal[i]! : null));
  return { macd: line, signal, histogram };
}

export interface BollingerResult {
  upper: Series;
  middle: Series;
  lower: Series;
}

export function bollinger(closes: number[], period = 20, mult = 2): BollingerResult {
  const middle = sma(closes, period);
  const upper: Series = new Array(closes.length).fill(null);
  const lower: Series = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const m = middle[i]!;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (closes[j]! - m) ** 2;
    const sd = Math.sqrt(variance / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { upper, middle, lower };
}

export interface OHLC {
  high: number;
  low: number;
  close: number;
}

/** Average True Range with Wilder's smoothing. */
export function atr(candles: OHLC[], period = 14): Series {
  const out: Series = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const tr: number[] = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1]!.close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
  let prev = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = prev;
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]!) / period;
    out[i] = prev;
  }
  return out;
}

/** Standard deviation of log returns (as a fraction, not %). */
export function logReturnStdDev(closes: number[]): number | null {
  if (closes.length < 3) return null;
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1]! > 0 && closes[i]! > 0) r.push(Math.log(closes[i]! / closes[i - 1]!));
  }
  if (r.length < 2) return null;
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const variance = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(variance);
}

export function last<T>(series: Array<T | null>): T | null {
  for (let i = series.length - 1; i >= 0; i--) if (series[i] !== null && series[i] !== undefined) return series[i]!;
  return null;
}

/**
 * Swing highs/lows: a candle whose high (low) is the extreme of `window` candles on each side.
 * Returns levels below (support) and above (resistance) the current price, nearest first,
 * merging levels within `mergePct` percent of each other.
 */
export function swingLevels(
  candles: OHLC[],
  price: number,
  window = 3,
  mergePct = 1,
  maxLevels = 3,
): { support: number[]; resistance: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = window; i < candles.length - window; i++) {
    const c = candles[i]!;
    let isHigh = true;
    let isLow = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (candles[j]!.high >= c.high) isHigh = false;
      if (candles[j]!.low <= c.low) isLow = false;
    }
    if (isHigh) highs.push(c.high);
    if (isLow) lows.push(c.low);
  }
  const merge = (levels: number[], ascending: boolean) => {
    const sorted = [...levels].sort((a, b) => (ascending ? a - b : b - a));
    const out: number[] = [];
    for (const l of sorted) {
      if (!out.some((o) => Math.abs(o - l) / o <= mergePct / 100)) out.push(l);
      if (out.length >= maxLevels) break;
    }
    return out;
  };
  return {
    support: merge(
      [...lows, ...highs].filter((l) => l < price),
      false,
    ),
    resistance: merge(
      [...highs, ...lows].filter((l) => l > price),
      true,
    ),
  };
}
