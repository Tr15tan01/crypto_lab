import { describe, expect, it } from "vitest";
import { FEATURE_KEYS, WARMUP, btcContext, featureRows, latestFeatures, samplesFor, type Sample } from "@/services/learning/features";
import { auc, compareModels, evaluate, lessons, modelTrust, predict, train, walkForwardSplit } from "@/services/learning/model";
import { calibrateConfidence, calibrationTable } from "@/services/learning/learning-service";
import type { Kline } from "@/services/binance/schemas";

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);

function candles(closes: number[]): Kline[] {
  return closes.map((c, i) => {
    const prev = closes[i - 1] ?? c;
    return { openTime: START + i * DAY, open: prev, high: Math.max(c, prev) * 1.01, low: Math.min(c, prev) * 0.99, close: c, volume: 1000 + (i % 7) * 50, closeTime: START + (i + 1) * DAY - 1, quoteVolume: (1000 + (i % 7) * 50) * c, trades: 1 };
  });
}

/** Deterministic pseudo-random numbers so the tests are stable. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

function syntheticSamples(n: number, seed = 1): Sample[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const x = FEATURE_KEYS.map(() => r() * 2 - 1);
    // Only feature 0 matters: positive values make beating BTC more likely.
    const p = 1 / (1 + Math.exp(-3 * x[0]!));
    const y = r() < p ? 1 : 0;
    return { symbol: "X", t: START + i * DAY, x, y: y as 0 | 1, excess: (y ? 1 : -1) * (1 + r()) };
  });
}

describe("features", () => {
  const btc = candles(Array.from({ length: 400 }, (_, i) => 100 + i * 0.1));
  const ctx = btcContext(btc)!;
  const alt = candles(Array.from({ length: 400 }, (_, i) => 50 + Math.sin(i / 9) * 5 + i * 0.05));

  it("produces one vector per day after warm-up, with every feature", () => {
    const rows = featureRows(alt, ctx);
    expect(rows[WARMUP - 1]).toBeNull();
    expect(rows[WARMUP]).toHaveLength(FEATURE_KEYS.length);
    expect(latestFeatures(alt, ctx)).toEqual(rows[rows.length - 1]);
  });

  it("never looks ahead: features on day i ignore later candles", () => {
    const full = featureRows(alt, ctx);
    const cut = featureRows(alt.slice(0, 300), ctx);
    expect(cut[299]).toEqual(full[299]);
  });

  it("labels samples by whether the pair beat BTC over the horizon", () => {
    const s = samplesFor("ALT", alt, ctx, 7, 3);
    expect(s.length).toBeGreaterThan(50);
    for (const x of s.slice(0, 20)) expect(x.y).toBe(x.excess > 0 ? 1 : 0);
  });
});

describe("model", () => {
  it("computes AUC correctly", () => {
    expect(auc([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1])).toBe(1);
    expect(auc([0.9, 0.8, 0.2, 0.1], [0, 0, 1, 1])).toBe(0);
    expect(auc([0.5, 0.5], [0, 1])).toBe(0.5);
  });

  it("learns a real pattern and validates it out of sample", () => {
    const samples = syntheticSamples(3000);
    const split = walkForwardSplit(samples, 7);
    const model = train(split.train);
    const res = evaluate(model, split.test);
    expect(res.metrics.auc).toBeGreaterThan(0.75);
    expect(model.coef[0]).toBeGreaterThan(0.5);
    // Irrelevant features stay small.
    expect(Math.max(...model.coef.slice(1).map(Math.abs))).toBeLessThan(0.2);
    expect(res.deciles[res.deciles.length - 1]!.hitRate).toBeGreaterThan(res.deciles[0]!.hitRate);
    expect(res.spreadPercent).toBeGreaterThan(0);
    expect(lessons(model)[0]!.key).toBe(FEATURE_KEYS[0]);
    expect(predict(model, FEATURE_KEYS.map((_, j) => (j === 0 ? 1 : 0)))).toBeGreaterThan(0.8);
  });

  it("keeps an embargo between training and test periods", () => {
    const samples = syntheticSamples(1000);
    const { train: tr, test, cutoff } = walkForwardSplit(samples, 7);
    expect(Math.max(...tr.map((s) => s.t))).toBeLessThan(cutoff - 7 * DAY);
    expect(Math.min(...test.map((s) => s.t))).toBeGreaterThanOrEqual(cutoff + 7 * DAY);
  });

  it("reports sign flips between runs", () => {
    const a = train(syntheticSamples(1500, 2));
    const b = { ...a, coef: a.coef.map((c, j) => (j === 0 ? -c : c)) };
    expect(compareModels(a, b).some((c) => c.kind === "flipped" && c.key === FEATURE_KEYS[0])).toBe(true);
    expect(compareModels(null, a)).toEqual([]);
  });

  it("trusts the model only when it beats chance", () => {
    expect(modelTrust(0.5)).toBe(0);
    expect(modelTrust(0.555)).toBeCloseTo(0.5);
    expect(modelTrust(0.7)).toBe(1);
  });
});

describe("self-calibration", () => {
  const ev = (outcome: "correct" | "incorrect") => ({ outcome, horizon: "7d" as const, evaluatedAt: new Date(), startPrice: 1, endPrice: 1, returnPercent: 0, maxUpsidePercent: 0, maxDownsidePercent: 0, levelHit: null });

  it("pulls confidence toward the observed hit rate once there is evidence", () => {
    const preds = Array.from({ length: 40 }, (_, i) => ({ source: "autopilot" as const, confidence: 72, evaluation: ev(i < 20 ? "correct" : "incorrect") }));
    const table = calibrationTable(preds);
    const row = table.find((r) => r.source === "autopilot" && r.bucket === "70–79%")!;
    expect(row.hitRate).toBe(50);
    expect(calibrateConfidence(72, table, "autopilot")).toBe(50);
    // Too little evidence in other buckets leaves the value alone.
    expect(calibrateConfidence(62, table, "autopilot")).toBe(62);
  });
});
