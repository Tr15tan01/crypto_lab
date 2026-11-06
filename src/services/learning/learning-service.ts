import "server-only";
import { ObjectId } from "mongodb";
import { getCollections } from "@/lib/mongodb/collections";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { marketData } from "@/services/binance";
import type { Kline } from "@/services/binance/schemas";
import { loadUniverseHistories } from "@/services/backtest/backtest-service";
import type { LearningRunDoc, PredictionDoc } from "@/models";
import type { AccuracyItem } from "@/services/predictions/accuracy";
import { FEATURES, btcContext, latestFeatures, samplesFor, type Sample } from "./features";
import { compareModels, contributions, evaluate, lessons, modelTrust, predict, train, walkForwardSplit, type TrainedModel } from "./model";

/**
 * The app's self-learning loop:
 *   1. replay ~2.5 years of daily data for the most liquid pairs and build labelled samples,
 *   2. train on the older 75%, test on the newer 25% (walk-forward, with an embargo),
 *   3. retrain on everything for live use, explain the weights, diff them against the last run,
 *   4. store the run, and score assets with it (Autopilot, coin pages, chat).
 * Retrains at most once a day (scheduled job, or on demand from the Learning page).
 */
const HORIZON = 7;
const STRIDE = 3;
const RETRAIN_EVERY_MS = 24 * 60 * 60_000;
const MIN_TRAIN_GAP_MS = 10 * 60_000;

const g = globalThis as unknown as {
  __cryptoLabLearning?: { run: LearningRunDoc | null; loadedAt: number };
  __cryptoLabTraining?: Promise<LearningRunDoc> | null;
};

const labelOf = (key: string) => FEATURES.find((f) => f.key === key)?.label ?? key;

export async function latestRun(): Promise<LearningRunDoc | null> {
  const cached = g.__cryptoLabLearning;
  if (cached && Date.now() - cached.loadedAt < 10 * 60_000) return cached.run;
  const { learningRuns } = await getCollections();
  const run = await learningRuns.find({}).sort({ createdAt: -1 }).limit(1).next();
  g.__cryptoLabLearning = { run, loadedAt: Date.now() };
  return run;
}

export async function listRuns(limit = 30) {
  const { learningRuns } = await getCollections();
  return learningRuns
    .find({}, { projection: { model: 0, "test.calibration": 0, "test.deciles": 0, "picks.bottom": 0 } })
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 100))
    .toArray();
}

export async function isDue(): Promise<boolean> {
  const run = await latestRun();
  return !run || Date.now() - run.createdAt.getTime() >= RETRAIN_EVERY_MS;
}

function pick(model: TrainedModel, symbol: string, x: number[]) {
  return {
    symbol,
    probability: Math.round(predict(model, x) * 1000) / 1000,
    drivers: contributions(model, x)
      .slice(0, 3)
      .map((c) => ({ label: labelOf(c.key), contribution: Math.round(c.contribution * 1000) / 1000 })),
  };
}

async function runTraining(trigger: LearningRunDoc["trigger"], userId: string | null): Promise<LearningRunDoc> {
  const started = Date.now();
  const { pairs, btc } = await loadUniverseHistories();
  const ctx = btcContext(btc);
  if (!ctx) throw new AppError("MARKET_UNAVAILABLE", "BTC history is unavailable, so the model cannot be trained right now.", { retryable: true });

  const alts = pairs.filter((p) => p.symbol !== "BTCUSDT");
  const samples: Sample[] = alts.flatMap((p) => samplesFor(p.symbol, p.candles, ctx, HORIZON, STRIDE));
  if (samples.length < 1000) {
    throw new AppError("MARKET_UNAVAILABLE", `Only ${samples.length} training samples could be built; need at least 1000.`, { retryable: true });
  }

  const split = walkForwardSplit(samples, HORIZON);
  const validationModel = train(split.train);
  const test = evaluate(validationModel, split.test);
  const inSample = evaluate(validationModel, split.train);
  // The live model learns from all history, including the most recent period.
  const model = train(samples);

  const prev = await latestRun();
  const picks = alts
    .map((p) => {
      const x = latestFeatures(p.candles, ctx);
      return x ? pick(model, p.symbol, x) : null;
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => b.probability - a.probability);

  const times = samples.map((s) => s.t);
  const doc: LearningRunDoc = {
    _id: new ObjectId(),
    createdAt: new Date(),
    trigger,
    durationMs: Date.now() - started,
    data: {
      pairs: alts.length,
      samples: samples.length,
      from: new Date(Math.min(...times)),
      to: new Date(Math.max(...times)),
      horizonDays: HORIZON,
      strideDays: STRIDE,
    },
    split: { cutoff: new Date(split.cutoff), trainSamples: split.train.length, testSamples: split.test.length },
    test,
    train: { metrics: inSample.metrics },
    trust: Math.round(modelTrust(test.metrics.auc) * 100) / 100,
    model,
    lessons: lessons(model),
    changes: compareModels(prev?.model ?? null, model),
    picks: { top: picks.slice(0, 15), bottom: picks.slice(-10).reverse() },
  };

  const { learningRuns, notifications } = await getCollections();
  await learningRuns.insertOne(doc);
  g.__cryptoLabLearning = { run: doc, loadedAt: Date.now() };
  logger.info("learning.trained", { samples: doc.data.samples, auc: doc.test.metrics.auc, ms: doc.durationMs, trigger });

  if (userId) {
    const top = doc.picks.top.slice(0, 3).map((p) => p.symbol.replace(/USDT$/, "")).join(", ");
    await notifications
      .insertOne({
        _id: new ObjectId(),
        userId,
        alertId: null,
        symbol: doc.picks.top[0]?.symbol ?? "BTCUSDT",
        title: `Model retrained · out-of-sample AUC ${doc.test.metrics.auc.toFixed(3)}`,
        body: `${doc.changes.length ? `${doc.changes.length} view change${doc.changes.length > 1 ? "s" : ""}. ` : ""}Top picks to beat BTC this week: ${top || "none"}. See Learning.`,
        createdAt: new Date(),
        readAt: null,
        channels: ["in_app"],
      })
      .catch(() => undefined);
  }
  return doc;
}

/** Trains now (deduplicated: concurrent callers share one run; refuses runs < 10 min apart). */
export async function trainNow(trigger: LearningRunDoc["trigger"], userId: string | null): Promise<LearningRunDoc> {
  if (g.__cryptoLabTraining) return g.__cryptoLabTraining;
  const last = await latestRun();
  if (last && Date.now() - last.createdAt.getTime() < MIN_TRAIN_GAP_MS) return last;
  g.__cryptoLabTraining = runTraining(trigger, userId).finally(() => {
    g.__cryptoLabTraining = null;
  });
  return g.__cryptoLabTraining;
}

/** Scheduled job: retrain when the last run is a day old. */
export async function trainIfDue(userId: string | null): Promise<{ trained: boolean; auc?: number }> {
  if (!(await isDue())) return { trained: false };
  const run = await trainNow("scheduled", userId);
  return { trained: true, auc: run.test.metrics.auc };
}

export function isTraining() {
  return Boolean(g.__cryptoLabTraining);
}

/* ───────────── Using what was learned ───────────── */

export interface ModelView {
  probability: number;
  /** Probability minus the base rate, in percentage points. */
  edgePoints: number;
  trust: number;
  testAuc: number;
  trainedAt: string;
  drivers: Array<{ label: string; value: number; contribution: number }>;
}

export function scoreCandles(run: LearningRunDoc, candles: Kline[], btc: Kline[] | null): ModelView | null {
  const x = latestFeatures(candles.filter((k) => k.closeTime < Date.now()), btcContext(btc));
  if (!x) return null;
  const p = predict(run.model, x);
  return {
    probability: Math.round(p * 1000) / 1000,
    edgePoints: Math.round((p - run.test.metrics.baseRate) * 1000) / 10,
    trust: run.trust,
    testAuc: run.test.metrics.auc,
    trainedAt: run.createdAt.toISOString(),
    drivers: contributions(run.model, x)
      .slice(0, 5)
      .map((c) => ({ label: labelOf(c.key), value: Math.round(c.value * 100) / 100, contribution: Math.round(c.contribution * 1000) / 1000 })),
  };
}

/** The model's view of one pair right now, or null without a trained model or enough history. */
export async function scoreSymbol(symbol: string): Promise<ModelView | null> {
  const run = await latestRun();
  if (!run || symbol === "BTCUSDT") return null;
  const md = marketData();
  const [daily, btc] = await Promise.all([
    md.klines(symbol, "1d", "1y").then((r) => r.data).catch(() => null),
    md.klines("BTCUSDT", "1d", "1y").then((r) => r.data).catch(() => null),
  ]);
  return daily ? scoreCandles(run, daily, btc) : null;
}

/* ───────────── Scoring the model's live picks ───────────── */

const PICK_HORIZONS = { "24h": { ms: 86_400_000, interval: "1h" }, "7d": { ms: 7 * 86_400_000, interval: "1h" }, "30d": { ms: 30 * 86_400_000, interval: "4h" } } as const;
export type PickHorizon = keyof typeof PICK_HORIZONS;

async function windowReturn(symbol: string, horizon: PickHorizon, start: number): Promise<number | null> {
  const { ms, interval } = PICK_HORIZONS[horizon];
  const kl = await marketData().klinesBetween(symbol, interval, start, start + ms);
  if (kl.stale || !kl.data.length) return null;
  const first = kl.data[0]!;
  const last = kl.data[kl.data.length - 1]!;
  // Require an (almost) complete window.
  if (last.closeTime < start + ms * 0.98 || first.open <= 0) return null;
  return (last.close / first.open - 1) * 100;
}

/**
 * Scores the picks of past runs at 24h / 7d / 30d once due. Bounded to `maxRunHorizons`
 * run × horizon combinations per call (each costs ~26 cached Binance requests).
 */
export async function evaluateRunPicks(maxRunHorizons = 2): Promise<number> {
  const { learningRuns } = await getCollections();
  const now = Date.now();
  const runs = await learningRuns
    .find({ createdAt: { $lte: new Date(now - PICK_HORIZONS["24h"].ms) } }, { projection: { createdAt: 1, picks: 1, pickEvaluations: 1 } })
    .sort({ createdAt: -1 })
    .limit(120)
    .toArray();
  let done = 0;
  for (const run of runs) {
    for (const h of Object.keys(PICK_HORIZONS) as PickHorizon[]) {
      if (done >= maxRunHorizons) return done;
      const start = run.createdAt.getTime();
      if (start + PICK_HORIZONS[h].ms > now || run.pickEvaluations?.some((e) => e.horizon === h)) continue;
      try {
        const btc = await windowReturn("BTCUSDT", h, start);
        if (btc === null) continue;
        const results: NonNullable<LearningRunDoc["pickEvaluations"]>[number]["results"] = [];
        for (const [side, list] of [["top", run.picks.top], ["bottom", run.picks.bottom]] as const) {
          for (const p of list) {
            const r = await windowReturn(p.symbol, h, start).catch(() => null);
            if (r === null) continue;
            const excess = Math.round((r - btc) * 100) / 100;
            results.push({ symbol: p.symbol, side, excessPercent: excess, correct: side === "top" ? excess > 0 : excess < 0 });
          }
        }
        if (!results.length) continue;
        await learningRuns.updateOne(
          { _id: run._id, "pickEvaluations.horizon": { $ne: h } },
          { $push: { pickEvaluations: { horizon: h, evaluatedAt: new Date(), results } } },
        );
        done++;
      } catch (err) {
        logger.warn("learning.pick_evaluation_failed", { run: run._id.toString(), horizon: h, error: err });
      }
    }
  }
  if (done) g.__cryptoLabLearning = undefined;
  return done;
}

/** Accuracy items for the model's picks at one horizon (pending = run whose horizon is not yet scored). */
export async function modelPickItems(horizon: PickHorizon) {
  const { learningRuns } = await getCollections();
  const runs = await learningRuns
    .find({}, { projection: { createdAt: 1, "picks.top.symbol": 1, "picks.bottom.symbol": 1, pickEvaluations: 1 } })
    .sort({ createdAt: -1 })
    .limit(365)
    .toArray();
  return runs.flatMap((run): AccuracyItem[] => {
    const ev = run.pickEvaluations?.find((e) => e.horizon === horizon);
    const t = run.createdAt.getTime();
    if (!ev) return [...run.picks.top, ...run.picks.bottom].map(() => ({ t, outcome: null, resultPercent: null }));
    return ev.results.map((r) => ({
      t,
      outcome: r.correct ? ("correct" as const) : ("incorrect" as const),
      // Signed so that "right" is positive for both sides.
      resultPercent: r.side === "top" ? r.excessPercent : -r.excessPercent,
    }));
  });
}

/* ───────────── Learning from its own calls ───────────── */

export interface CalibrationRow {
  source: "chat" | "autopilot";
  bucket: string;
  from: number;
  to: number;
  decided: number;
  statedAvg: number | null;
  hitRate: number | null;
}

const BUCKETS = [
  { from: 50, to: 60, label: "50–59%" },
  { from: 60, to: 70, label: "60–69%" },
  { from: 70, to: 80, label: "70–79%" },
  { from: 80, to: 101, label: "80%+" },
];

export function calibrationTable(preds: Array<Pick<PredictionDoc, "source" | "confidence" | "evaluation">>): CalibrationRow[] {
  const rows: CalibrationRow[] = [];
  for (const source of ["chat", "autopilot"] as const) {
    const mine = preds.filter((p) => (p.source ?? "chat") === source && p.evaluation && (p.evaluation.outcome === "correct" || p.evaluation.outcome === "incorrect"));
    for (const b of BUCKETS) {
      const sel = mine.filter((p) => p.confidence >= b.from && p.confidence < b.to);
      rows.push({
        source,
        bucket: b.label,
        from: b.from,
        to: b.to,
        decided: sel.length,
        statedAvg: sel.length ? Math.round(sel.reduce((s, p) => s + p.confidence, 0) / sel.length) : null,
        hitRate: sel.length ? Math.round((sel.filter((p) => p.evaluation!.outcome === "correct").length / sel.length) * 1000) / 10 : null,
      });
    }
  }
  return rows;
}

/**
 * Pulls a stated confidence toward what calls in that bucket actually achieved, once there are
 * at least `minDecided` scored calls; otherwise returns it unchanged.
 */
export function calibrateConfidence(confidence: number, table: CalibrationRow[], source: "chat" | "autopilot", minDecided = 10): number {
  const row = table.find((r) => r.source === source && confidence >= r.from && confidence < r.to);
  if (!row || row.decided < minDecided || row.hitRate === null) return confidence;
  // Shrink toward the observed hit rate in proportion to how much evidence there is.
  const w = Math.min(1, row.decided / 40);
  return Math.round(Math.min(90, Math.max(50, confidence * (1 - w) + row.hitRate * w)));
}

export async function selfCalibration(userId: string): Promise<CalibrationRow[]> {
  const { predictions } = await getCollections();
  const list = await predictions
    .find({ userId, evaluation: { $ne: null } }, { projection: { source: 1, confidence: 1, evaluation: 1 } })
    .sort({ timestamp: -1 })
    .limit(1000)
    .toArray();
  return calibrationTable(list);
}
