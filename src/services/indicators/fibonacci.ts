/**
 * Fibonacci retracement and extension levels of the dominant swing in a lookback window.
 * Pure, no I/O. The levels are widely watched reference prices; whether trading them has an
 * edge is measured by the Signal Lab backtest ("Fibonacci pullback"), not assumed.
 */
export const FIB_RETRACEMENTS = [0.236, 0.382, 0.5, 0.618, 0.786] as const;
export const FIB_EXTENSIONS = [1.272, 1.618] as const;
/** The "golden pocket": the 50–65% retracement band where pullbacks in a trend most often turn. */
export const GOLDEN_POCKET: [number, number] = [0.5, 0.65];

export interface FibCandle {
  openTime: number;
  high: number;
  low: number;
  close: number;
}

export interface FibSwing {
  /** "up": low came first, then the high (price is retracing downwards). */
  direction: "up" | "down";
  high: number;
  low: number;
  highIndex: number;
  lowIndex: number;
  /** Size of the swing, percent of the low. */
  swingPercent: number;
  /** How much of the swing has been given back: 0 = at the swing's end, 1 = fully retraced. */
  retraced: number;
}

/** The swing between the highest high and lowest low of candles [from, to], seen from `price`. */
export function fibSwing(candles: FibCandle[], from: number, to: number, price: number): FibSwing | null {
  let hi = -Infinity;
  let lo = Infinity;
  let hiIdx = -1;
  let loIdx = -1;
  for (let i = Math.max(0, from); i <= to && i < candles.length; i++) {
    const c = candles[i]!;
    if (c.high >= hi) {
      hi = c.high;
      hiIdx = i;
    }
    if (c.low < lo) {
      lo = c.low;
      loIdx = i;
    }
  }
  if (hiIdx < 0 || loIdx < 0 || hiIdx === loIdx || !(hi > lo) || lo <= 0) return null;
  const up = loIdx < hiIdx;
  const range = hi - lo;
  return {
    direction: up ? "up" : "down",
    high: hi,
    low: lo,
    highIndex: hiIdx,
    lowIndex: loIdx,
    swingPercent: (hi / lo - 1) * 100,
    retraced: up ? (hi - price) / range : (price - lo) / range,
  };
}

export interface FibLevels extends FibSwing {
  highAt: number;
  lowAt: number;
  retracements: Array<{ ratio: number; price: number }>;
  /** Targets beyond the swing's end, in the swing's direction. */
  extensions: Array<{ ratio: number; price: number }>;
  inGoldenPocket: boolean;
  /** The retracement level closest to the current price. */
  nearest: { ratio: number; price: number; distancePercent: number } | null;
}

export function fibonacciLevels(candles: FibCandle[], price: number, lookback = 90): FibLevels | null {
  if (candles.length < 20 || !(price > 0)) return null;
  const swing = fibSwing(candles, candles.length - lookback, candles.length - 1, price);
  if (!swing) return null;
  const range = swing.high - swing.low;
  const up = swing.direction === "up";
  const at = (ratio: number) => (up ? swing.high - ratio * range : swing.low + ratio * range);
  const retracements = FIB_RETRACEMENTS.map((ratio) => ({ ratio, price: at(ratio) }));
  const extensions = FIB_EXTENSIONS.map((ratio) => ({ ratio, price: up ? swing.low + ratio * range : swing.high - ratio * range })).filter((e) => e.price > 0);
  const nearest = retracements
    .map((r) => ({ ...r, distancePercent: ((r.price - price) / price) * 100 }))
    .sort((a, b) => Math.abs(a.distancePercent) - Math.abs(b.distancePercent))[0];
  return {
    ...swing,
    highAt: candles[swing.highIndex]!.openTime,
    lowAt: candles[swing.lowIndex]!.openTime,
    retracements,
    extensions,
    inGoldenPocket: swing.retraced >= GOLDEN_POCKET[0] && swing.retraced <= GOLDEN_POCKET[1],
    nearest: nearest ?? null,
  };
}

/**
 * "Fibonacci pullback": an up-swing of at least `minSwingPercent` whose high is recent, with
 * the price now sitting in the golden pocket. `i` is the index of the day being tested.
 */
export function isFibPullback(
  candles: FibCandle[],
  i: number,
  price: number,
  opts: { lookback: number; minSwingPercent: number; maxDaysSinceHigh: number },
): boolean {
  const s = fibSwing(candles, i - opts.lookback + 1, i, price);
  return Boolean(
    s &&
      s.direction === "up" &&
      s.swingPercent >= opts.minSwingPercent &&
      i - s.highIndex <= opts.maxDaysSinceHigh &&
      s.retraced >= GOLDEN_POCKET[0] &&
      s.retraced <= GOLDEN_POCKET[1],
  );
}
