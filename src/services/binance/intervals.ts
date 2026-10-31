/**
 * Chart intervals and periods, shared by the server (validation, pagination) and the UI
 * (which combinations to offer). Combinations are limited so a chart never needs more than
 * MAX_CANDLES candles (a few Binance requests).
 */
export const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"] as const;
export type KlineInterval = (typeof INTERVALS)[number];

export const PERIODS = ["24h", "7d", "30d", "90d", "1y", "all"] as const;
export type ChartPeriod = (typeof PERIODS)[number];

export const INTERVAL_MS: Record<KlineInterval, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};

export const PERIOD_MS: Record<Exclude<ChartPeriod, "all">, number> = {
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
  "30d": 30 * 24 * 60 * 60_000,
  "90d": 90 * 24 * 60 * 60_000,
  "1y": 365 * 24 * 60 * 60_000,
};

export const PERIOD_LABEL: Record<ChartPeriod, string> = {
  "24h": "24H",
  "7d": "7D",
  "30d": "30D",
  "90d": "90D",
  "1y": "1Y",
  all: "All",
};

export const MAX_CANDLES = 4000;

export const ALLOWED_INTERVALS: Record<ChartPeriod, KlineInterval[]> = {
  "24h": ["1m", "5m", "15m", "1h"],
  "7d": ["5m", "15m", "1h", "4h"],
  "30d": ["15m", "1h", "4h", "1d"],
  "90d": ["1h", "4h", "1d"],
  "1y": ["4h", "1d", "1w"],
  all: ["1d", "1w"],
};

export const DEFAULT_INTERVAL: Record<ChartPeriod, KlineInterval> = {
  "24h": "15m",
  "7d": "1h",
  "30d": "4h",
  "90d": "1d",
  "1y": "1d",
  all: "1w",
};

export function isAllowedCombination(period: ChartPeriod, interval: KlineInterval): boolean {
  return ALLOWED_INTERVALS[period].includes(interval);
}

/** How long kline data for an interval stays fresh in the server cache. */
export function klineTtlSeconds(interval: KlineInterval): number {
  switch (interval) {
    case "1m":
      return 20;
    case "5m":
      return 45;
    case "15m":
      return 90;
    case "1h":
      return 180;
    case "4h":
      return 300;
    default:
      return 900;
  }
}
