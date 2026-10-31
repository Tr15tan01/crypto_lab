import type { Kline } from "@/services/binance/schemas";
import type { KlineInterval } from "@/services/binance/intervals";
import type { ResearchBias, ResearchEvaluation } from "@/models";

/**
 * Evaluating AI research "biases" against what actually happened.
 *
 * Rules (documented in the UI):
 * - Each report is evaluated at fixed horizons: 1h, 24h, 7d, 30d after it was generated.
 * - The verdict uses the CLOSE-TO-CLOSE return at the horizon, not a brief intrawindow spike.
 *   Maximum upside and downside within the window are recorded alongside, for context.
 * - A move smaller than the horizon's threshold is "inconclusive" for a directional bias.
 *   A neutral bias is correct only when the move stays within the threshold.
 * - Unsuccessful evaluations are kept forever, like successful ones.
 */
export type Horizon = ResearchEvaluation["horizon"];

export const HORIZONS: Record<Horizon, { ms: number; interval: KlineInterval; thresholdPercent: number }> = {
  "1h": { ms: 3_600_000, interval: "5m", thresholdPercent: 0.5 },
  "24h": { ms: 86_400_000, interval: "1h", thresholdPercent: 1.5 },
  "7d": { ms: 7 * 86_400_000, interval: "1h", thresholdPercent: 3 },
  "30d": { ms: 30 * 86_400_000, interval: "4h", thresholdPercent: 5 },
};

export const HORIZON_ORDER: Horizon[] = ["1h", "24h", "7d", "30d"];

export function evaluateOutcome(
  bias: ResearchBias | null,
  startPrice: number,
  startTime: number,
  horizon: Horizon,
  klines: Kline[],
): ResearchEvaluation | null {
  const { ms, thresholdPercent } = HORIZONS[horizon];
  const end = startTime + ms;
  const window = klines.filter((k) => k.openTime >= startTime - 1 && k.closeTime <= end + 1);
  if (window.length === 0 || startPrice <= 0) return null;
  const last = window[window.length - 1]!;
  // Require the window to be (almost) complete before judging it.
  if (last.closeTime < end - HORIZONS[horizon].ms * 0.02) return null;

  const endPrice = last.close;
  const ret = ((endPrice - startPrice) / startPrice) * 100;
  const maxUp = ((Math.max(...window.map((k) => k.high)) - startPrice) / startPrice) * 100;
  const maxDown = ((Math.min(...window.map((k) => k.low)) - startPrice) / startPrice) * 100;

  let outcome: ResearchEvaluation["outcome"];
  if (!bias) outcome = "not_evaluated";
  else if (bias === "neutral") outcome = Math.abs(ret) < thresholdPercent ? "correct" : "incorrect";
  else {
    const signed = bias === "bullish" ? ret : -ret;
    outcome = signed >= thresholdPercent ? "correct" : signed <= -thresholdPercent ? "incorrect" : "inconclusive";
  }

  return {
    horizon,
    evaluatedAt: new Date(),
    startPrice,
    endPrice,
    returnPercent: ret,
    maxUpsidePercent: maxUp,
    maxDownsidePercent: maxDown,
    outcome,
  };
}
