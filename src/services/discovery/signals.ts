/**
 * Discovery signal definitions and thresholds. No imports, so the UI, the guide page, the
 * screening code and the AI prompt all describe the signals with the same numbers.
 */
export const DISCOVERY_SIGNALS = [
  "new_listing",
  "volume_surge",
  "outperforming_btc",
  "golden_cross",
  "oversold_bounce",
  "breakout",
  "volatility_squeeze",
  "trend_pullback",
  "accumulation",
  "fib_pullback",
] as const;
export type DiscoverySignal = (typeof DISCOVERY_SIGNALS)[number];

export const THRESHOLDS = {
  /** Daily candles requested per pair. A pair with fewer has its full Binance history in view. */
  historyDays: 300,
  /** "New listing": first Binance trading data within this many days. */
  newListingDays: 90,
  /** "Unusual volume": 24h quote volume at least this multiple of the 30-day median. */
  volumeSurgeRatio: 2,
  /** "Outperforming BTC": beating BTC over 7 days and by at least this much over 30 days. */
  outperform30dPercent: 10,
  /** "Golden cross": SMA 50 crossed above SMA 200 within this many days and is still above. */
  crossLookbackDays: 14,
  /** "Oversold bounce": RSI(14) was at or below `oversoldRsi` in the last `bounceLookbackDays`, now at or above `bounceRsi`. */
  oversoldRsi: 30,
  bounceRsi: 40,
  bounceLookbackDays: 10,
  /** "Breakout": price above the highest high of this many closed daily candles. */
  breakoutDays: 90,
  /** "Volatility squeeze": Bollinger bandwidth in the lowest `squeezePercentile`% of the last `squeezeLookbackDays`. */
  squeezeLookbackDays: 120,
  squeezePercentile: 10,
  /** "Trend pullback": 50-day above 200-day, price above the 200-day, RSI(14) dipped into this band. */
  pullbackRsiLow: 35,
  pullbackRsiHigh: 48,
  /** "Accumulation": 20-day on-balance volume flow ≥ this share of 20-day volume while price moved < `accumulationMaxMovePercent`. */
  accumulationDays: 20,
  accumulationFlow: 0.2,
  accumulationMaxMovePercent: 6,
  /** "Fibonacci pullback": an up-swing of at least `fibMinSwingPercent` within `fibLookbackDays`, high no older than `fibMaxDaysSinceHigh`, price back in the 50–65% retracement band. */
  fibLookbackDays: 90,
  fibMinSwingPercent: 25,
  fibMaxDaysSinceHigh: 30,
  /** Below this 24h quote volume (USDT) a pair is flagged as thinly traded. */
  thinLiquidity: 500_000,
} as const;

export const SIGNAL_INFO: Record<DiscoverySignal, { label: string; description: string }> = {
  new_listing: {
    label: "New listing",
    description: `First Binance trading data within the last ${THRESHOLDS.newListingDays} days (not the project's launch date).`,
  },
  volume_surge: {
    label: "Unusual volume",
    description: `24h volume at least ${THRESHOLDS.volumeSurgeRatio}× its 30-day median daily volume.`,
  },
  outperforming_btc: {
    label: "Beating BTC",
    description: `Outperforming BTC over 7 days, and by at least ${THRESHOLDS.outperform30dPercent}% over 30 days.`,
  },
  golden_cross: {
    label: "Golden cross",
    description: `50-day average crossed above the 200-day average within the last ${THRESHOLDS.crossLookbackDays} days.`,
  },
  oversold_bounce: {
    label: "Oversold bounce",
    description: `RSI(14) fell to ${THRESHOLDS.oversoldRsi} or below in the last ${THRESHOLDS.bounceLookbackDays} days and has recovered to ${THRESHOLDS.bounceRsi}+.`,
  },
  breakout: {
    label: `${THRESHOLDS.breakoutDays}-day high`,
    description: `Price is above the highest high of the previous ${THRESHOLDS.breakoutDays} daily candles.`,
  },
  volatility_squeeze: {
    label: "Volatility squeeze",
    description: `Bollinger Band width is in the narrowest ${THRESHOLDS.squeezePercentile}% of the last ${THRESHOLDS.squeezeLookbackDays} days. Quiet periods often end in a large move (direction unknown).`,
  },
  trend_pullback: {
    label: "Trend pullback",
    description: `Long-term uptrend (50-day above 200-day, price above the 200-day) with RSI(14) dipping to ${THRESHOLDS.pullbackRsiLow}–${THRESHOLDS.pullbackRsiHigh}: a dip inside an uptrend.`,
  },
  fib_pullback: {
    label: "Fibonacci pullback",
    description: `After a rise of ${THRESHOLDS.fibMinSwingPercent}%+ that peaked within ${THRESHOLDS.fibMaxDaysSinceHigh} days, the price has given back 50–65% of it (the "golden pocket" between the 0.5 and 0.618 Fibonacci levels), where pullbacks often end.`,
  },
  accumulation: {
    label: "Accumulation",
    description: `On-balance volume rose strongly over ${THRESHOLDS.accumulationDays} days while the price moved less than ${THRESHOLDS.accumulationMaxMovePercent}%: buying volume without a price move yet.`,
  },
};
