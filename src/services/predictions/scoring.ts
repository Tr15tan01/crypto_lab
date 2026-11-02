import type { Kline } from "@/services/binance/schemas";
import type { PredictionDoc, PredictionHorizon, ResearchBias } from "@/models";

/**
 * Pure helpers for chat predictions: checking the AI's levels against the price, deciding whether
 * the target or the stop was reached first, and summarising the track record.
 */

export interface OutlookLevels {
  bias: ResearchBias;
  entry: [number, number] | null;
  target: number | null;
  stop: number | null;
}

/** Drops levels that sit on the wrong side of the price for the stated bias (they could never be scored). */
export function sanitizeLevels<T extends OutlookLevels>(o: T, price: number): T {
  if (o.bias === "neutral") return { ...o, target: null, stop: null };
  const up = o.bias === "bullish";
  const target = o.target !== null && (up ? o.target > price : o.target < price) ? o.target : null;
  const stop = o.stop !== null && (up ? o.stop < price : o.stop > price) ? o.stop : null;
  return { ...o, target, stop };
}

/**
 * Which level the price reached first inside the window. When one candle touches both, the stop
 * is assumed to have come first (the conservative reading, since intra-candle order is unknown).
 */
export function levelOutcome(
  bias: ResearchBias,
  target: number | null,
  stop: number | null,
  klines: Kline[],
): "target" | "stop" | "none" | null {
  if (bias === "neutral" || (target === null && stop === null)) return null;
  const up = bias === "bullish";
  for (const k of klines) {
    const stopHit = stop !== null && (up ? k.low <= stop : k.high >= stop);
    const targetHit = target !== null && (up ? k.high >= target : k.low <= target);
    if (stopHit) return "stop";
    if (targetHit) return "target";
  }
  return "none";
}

export interface TrackRecord {
  total: number;
  pending: number;
  correct: number;
  incorrect: number;
  inconclusive: number;
  /** correct / (correct + incorrect); null until something has been scored. */
  hitRatePercent: number | null;
  /** Average stated confidence of the scored calls, to compare with the hit rate. */
  avgConfidence: number | null;
  targetHits: number;
  stopHits: number;
  byHorizon: Array<{ horizon: PredictionHorizon; correct: number; incorrect: number }>;
}

export function summarizeTrackRecord(preds: Pick<PredictionDoc, "confidence" | "horizon" | "evaluation">[]): TrackRecord {
  const scored = preds.filter((p) => p.evaluation && p.evaluation.outcome !== "not_evaluated");
  const count = (o: string) => scored.filter((p) => p.evaluation!.outcome === o).length;
  const correct = count("correct");
  const incorrect = count("incorrect");
  const decided = scored.filter((p) => p.evaluation!.outcome === "correct" || p.evaluation!.outcome === "incorrect");
  const horizons: PredictionHorizon[] = ["24h", "7d", "30d"];
  return {
    total: preds.length,
    pending: preds.filter((p) => !p.evaluation).length,
    correct,
    incorrect,
    inconclusive: count("inconclusive"),
    hitRatePercent: correct + incorrect > 0 ? Math.round((correct / (correct + incorrect)) * 1000) / 10 : null,
    avgConfidence: decided.length ? Math.round(decided.reduce((a, p) => a + p.confidence, 0) / decided.length) : null,
    targetHits: scored.filter((p) => p.evaluation!.levelHit === "target").length,
    stopHits: scored.filter((p) => p.evaluation!.levelHit === "stop").length,
    byHorizon: horizons.map((horizon) => ({
      horizon,
      correct: scored.filter((p) => p.horizon === horizon && p.evaluation!.outcome === "correct").length,
      incorrect: scored.filter((p) => p.horizon === horizon && p.evaluation!.outcome === "incorrect").length,
    })),
  };
}
