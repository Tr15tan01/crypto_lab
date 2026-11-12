import { FEATURES, FEATURE_KEYS, type FeatureKey, type Sample } from "./features";

/**
 * The learning model: an L2-regularised logistic regression that estimates the probability a
 * pair does better than the typical (median) coin over the next 7 days. Deliberately simple and
 * transparent: every weight can be shown and explained. It is validated walk-forward over
 * several separate periods (always trained on the past, tested on a later period it never saw),
 * because a single test window proved too noisy to trust.
 */
export const MODEL_VERSION = 2;

export interface TrainedModel {
  /** 1 = predicted "beats BTC" (retired: unstable out of sample). 2 = "beats the median coin". */
  version: number;
  features: FeatureKey[];
  /** Winsorising bounds (1st / 99th percentile) learned from the training data. */
  lo: number[];
  hi: number[];
  mean: number[];
  std: number[];
  /** Coefficients on standardised features (comparable across features). */
  coef: number[];
  intercept: number;
}

export interface Metrics {
  samples: number;
  /** Share of positives (did better than the median coin; 50% by construction). */
  baseRate: number;
  accuracy: number;
  /** Area under the ROC curve: 0.5 = no skill, 1 = perfect ranking. */
  auc: number;
  brier: number;
  logLoss: number;
}

export interface CalibrationBucket {
  from: number;
  to: number;
  count: number;
  predicted: number;
  actual: number;
}

export interface Decile {
  decile: number;
  count: number;
  avgProbability: number;
  avgExcessPercent: number;
  hitRate: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-clamp(z, -30, 30)));

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function transform(model: Pick<TrainedModel, "lo" | "hi" | "mean" | "std">, x: number[]): number[] {
  return x.map((v, j) => (clamp(v, model.lo[j]!, model.hi[j]!) - model.mean[j]!) / model.std[j]!);
}

export function predict(model: TrainedModel, x: number[]): number {
  const z = transform(model, x);
  return sigmoid(z.reduce((s, v, j) => s + v * model.coef[j]!, model.intercept));
}

/** Per-feature contribution to the log-odds for one input, largest first. */
export function contributions(model: TrainedModel, x: number[]) {
  const z = transform(model, x);
  return model.features
    .map((key, j) => ({ key, value: x[j]!, contribution: z[j]! * model.coef[j]! }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

export function train(samples: Sample[], opts: { l2?: number; epochs?: number; lr?: number } = {}): TrainedModel {
  const l2 = opts.l2 ?? 0.01;
  const epochs = opts.epochs ?? 300;
  const lr = opts.lr ?? 0.05;
  const d = FEATURE_KEYS.length;
  const n = samples.length;
  if (n < 50) throw new Error("Not enough samples to train.");

  const lo: number[] = [];
  const hi: number[] = [];
  const mean: number[] = [];
  const std: number[] = [];
  for (let j = 0; j < d; j++) {
    const col = samples.map((s) => s.x[j]!).sort((a, b) => a - b);
    lo.push(quantile(col, 0.01));
    hi.push(quantile(col, 0.99));
    const clipped = col.map((v) => clamp(v, lo[j]!, hi[j]!));
    const m = clipped.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(clipped.reduce((a, b) => a + (b - m) ** 2, 0) / n);
    mean.push(m);
    std.push(sd > 1e-9 ? sd : 1);
  }
  const X = samples.map((s) => transform({ lo, hi, mean, std }, s.x));
  const y = samples.map((s) => s.y);

  // Full-batch gradient descent with Adam: deterministic, so the same data gives the same model.
  const w = new Array<number>(d).fill(0);
  const base = y.reduce<number>((a, b) => a + b, 0) / n;
  let b = Math.log(clamp(base, 0.01, 0.99) / (1 - clamp(base, 0.01, 0.99)));
  const m1 = new Array<number>(d + 1).fill(0);
  const m2 = new Array<number>(d + 1).fill(0);
  const beta1 = 0.9;
  const beta2 = 0.999;
  for (let epoch = 1; epoch <= epochs; epoch++) {
    const g = new Array<number>(d + 1).fill(0);
    for (let i = 0; i < n; i++) {
      const xi = X[i]!;
      let z = b;
      for (let j = 0; j < d; j++) z += xi[j]! * w[j]!;
      const err = sigmoid(z) - y[i]!;
      for (let j = 0; j < d; j++) g[j] += err * xi[j]!;
      g[d] += err;
    }
    for (let j = 0; j <= d; j++) {
      const grad = g[j]! / n + (j < d ? l2 * w[j]! : 0);
      m1[j] = beta1 * m1[j]! + (1 - beta1) * grad;
      m2[j] = beta2 * m2[j]! + (1 - beta2) * grad * grad;
      const step = (lr * (m1[j]! / (1 - beta1 ** epoch))) / (Math.sqrt(m2[j]! / (1 - beta2 ** epoch)) + 1e-8);
      if (j < d) w[j] = w[j]! - step;
      else b -= step;
    }
  }
  return { version: MODEL_VERSION, features: [...FEATURE_KEYS], lo, hi, mean, std, coef: w, intercept: b };
}

/** Rank-based AUC (Mann–Whitney), ties counted as half. */
export function auc(probs: number[], labels: number[]): number {
  const idx = probs.map((p, i) => i).sort((a, b) => probs[a]! - probs[b]!);
  const ranks = new Array<number>(probs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && probs[idx[j + 1]!] === probs[idx[i]!]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k]!] = r;
    i = j + 1;
  }
  const pos = labels.filter((l) => l === 1).length;
  const neg = labels.length - pos;
  if (!pos || !neg) return 0.5;
  const sumPos = labels.reduce<number>((s, l, i) => s + (l === 1 ? ranks[i]! : 0), 0);
  return (sumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

export function evaluate(model: TrainedModel, samples: Sample[]) {
  return evaluatePredictions(samples, samples.map((s) => predict(model, s.x)));
}

/** Metrics, calibration and deciles for predictions that were made out of sample. */
export function evaluatePredictions(samples: Sample[], probs: number[]) {
  const labels = samples.map((s) => s.y);
  const n = samples.length;
  const r4 = (v: number) => Math.round(v * 10_000) / 10_000;
  const metrics: Metrics = {
    samples: n,
    baseRate: r4(labels.reduce<number>((a, b) => a + b, 0) / Math.max(1, n)),
    accuracy: r4(probs.filter((p, i) => (p >= 0.5 ? 1 : 0) === labels[i]).length / Math.max(1, n)),
    auc: r4(auc(probs, labels)),
    brier: r4(probs.reduce((s, p, i) => s + (p - labels[i]!) ** 2, 0) / Math.max(1, n)),
    logLoss: r4(-probs.reduce((s, p, i) => s + (labels[i] ? Math.log(clamp(p, 1e-6, 1)) : Math.log(clamp(1 - p, 1e-6, 1))), 0) / Math.max(1, n)),
  };

  const edges = [0, 0.4, 0.45, 0.5, 0.55, 0.6, 1.0001];
  const calibration: CalibrationBucket[] = [];
  for (let k = 0; k < edges.length - 1; k++) {
    const sel = probs.map((p, i) => ({ p, y: labels[i]! })).filter((v) => v.p >= edges[k]! && v.p < edges[k + 1]!);
    if (!sel.length) continue;
    calibration.push({
      from: edges[k]!,
      to: Math.min(1, edges[k + 1]!),
      count: sel.length,
      predicted: r4(sel.reduce((s, v) => s + v.p, 0) / sel.length),
      actual: r4(sel.reduce((s, v) => s + v.y, 0) / sel.length),
    });
  }

  const order = probs.map((p, i) => i).sort((a, b) => probs[a]! - probs[b]!);
  const deciles: Decile[] = [];
  for (let k = 0; k < 10; k++) {
    const part = order.slice(Math.floor((k * n) / 10), Math.floor(((k + 1) * n) / 10));
    if (!part.length) continue;
    deciles.push({
      decile: k + 1,
      count: part.length,
      avgProbability: r4(part.reduce((s, i) => s + probs[i]!, 0) / part.length),
      avgExcessPercent: Math.round((part.reduce((s, i) => s + samples[i]!.excess, 0) / part.length) * 100) / 100,
      hitRate: r4(part.reduce((s, i) => s + labels[i]!, 0) / part.length),
    });
  }
  const top = deciles[deciles.length - 1];
  const bottom = deciles[0];
  return { metrics, calibration, deciles, spreadPercent: top && bottom ? Math.round((top.avgExcessPercent - bottom.avgExcessPercent) * 100) / 100 : 0 };
}

/**
 * Walk-forward split: train on everything before the cutoff (75% through time), skip an
 * embargo of `horizonDays` so no training label overlaps the test period, test on the rest.
 */
export function walkForwardSplit(samples: Sample[], horizonDays = 7, trainShare = 0.75) {
  const times = samples.map((s) => s.t).sort((a, b) => a - b);
  const cutoff = times[Math.floor(times.length * trainShare)] ?? 0;
  const embargo = cutoff + horizonDays * 86_400_000;
  return {
    train: samples.filter((s) => s.t < cutoff - horizonDays * 86_400_000),
    test: samples.filter((s) => s.t >= embargo),
    cutoff,
  };
}

/** Spearman rank correlation. */
export function rankCorrelation(a: number[], b: number[]): number {
  const rank = (v: number[]) => {
    const idx = v.map((_, i) => i).sort((x, y) => v[x]! - v[y]!);
    const r = new Array<number>(v.length);
    idx.forEach((id, k) => (r[id] = k));
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const m = (a.length - 1) / 2;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (ra[i]! - m) * (rb[i]! - m);
    da += (ra[i]! - m) ** 2;
    db += (rb[i]! - m) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

export interface FoldResult {
  from: number;
  to: number;
  samples: number;
  auc: number;
  /** Mean daily rank correlation between the model's score and what happened (information coefficient). */
  ic: number;
}

export interface Validation {
  folds: FoldResult[];
  positiveFolds: number;
  ic: number;
  /** t-statistic of the daily IC over all test days; above ~2 is unlikely to be luck. */
  icT: number;
  /** Average weekly result of the top fifth minus the bottom fifth, percent. */
  topBottomPercent: number;
}

const DAY_MS = 86_400_000;

/**
 * Expanding walk-forward validation: the last 60% of the history is cut into `folds` periods;
 * for each, a model is trained on everything before it (minus an embargo of `horizonDays`) and
 * tested on that period. Returns every out-of-sample prediction and per-period results.
 */
export function crossValidate(samples: Sample[], opts: { folds?: number; horizonDays?: number; startShare?: number } = {}) {
  const folds = opts.folds ?? 6;
  const horizon = opts.horizonDays ?? 7;
  const days = [...new Set(samples.map((s) => Math.floor(s.t / DAY_MS)))].sort((a, b) => a - b);
  const start = Math.floor(days.length * (opts.startShare ?? 0.4));
  const len = Math.floor((days.length - start) / folds);
  if (len < 3) throw new Error("Not enough history for walk-forward validation.");

  const oos: Sample[] = [];
  const probs: number[] = [];
  const foldResults: FoldResult[] = [];
  const dailyIc: number[] = [];
  const dailySpread: number[] = [];
  for (let f = 0; f < folds; f++) {
    const from = days[start + f * len]!;
    const to = f === folds - 1 ? Infinity : days[start + (f + 1) * len]!;
    const trainSet = samples.filter((s) => Math.floor(s.t / DAY_MS) < from - horizon);
    const testSet = samples.filter((s) => Math.floor(s.t / DAY_MS) >= from && Math.floor(s.t / DAY_MS) < to);
    if (trainSet.length < 200 || !testSet.length) continue;
    const model = train(trainSet);
    const p = testSet.map((s) => predict(model, s.x));
    const byDay = new Map<number, number[]>();
    testSet.forEach((s, i) => {
      const d = Math.floor(s.t / DAY_MS);
      const l = byDay.get(d);
      if (l) l.push(i);
      else byDay.set(d, [i]);
    });
    const ics: number[] = [];
    for (const idx of byDay.values()) {
      if (idx.length < 15) continue;
      const ic = rankCorrelation(idx.map((i) => p[i]!), idx.map((i) => testSet[i]!.excess));
      ics.push(ic);
      const sorted = [...idx].sort((a, b) => p[a]! - p[b]!);
      const q = Math.max(1, Math.floor(sorted.length / 5));
      const mean = (l: number[]) => l.reduce((a, i) => a + testSet[i]!.excess, 0) / l.length;
      dailySpread.push(mean(sorted.slice(-q)) - mean(sorted.slice(0, q)));
    }
    dailyIc.push(...ics);
    foldResults.push({
      from: from * DAY_MS,
      to: (to === Infinity ? days[days.length - 1]! + 1 : to) * DAY_MS,
      samples: testSet.length,
      auc: Math.round(auc(p, testSet.map((s) => s.y)) * 10_000) / 10_000,
      ic: ics.length ? Math.round((ics.reduce((a, b) => a + b, 0) / ics.length) * 10_000) / 10_000 : 0,
    });
    oos.push(...testSet);
    probs.push(...p);
  }
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const sd = (a: number[]) => (a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - mean(a)) ** 2, 0) / (a.length - 1)) : 0);
  const validation: Validation = {
    folds: foldResults,
    positiveFolds: foldResults.filter((f) => f.ic > 0 && f.auc > 0.5).length,
    ic: Math.round(mean(dailyIc) * 10_000) / 10_000,
    icT: sd(dailyIc) > 0 ? Math.round((mean(dailyIc) / (sd(dailyIc) / Math.sqrt(dailyIc.length))) * 100) / 100 : 0,
    topBottomPercent: Math.round(mean(dailySpread) * 100) / 100,
  };
  return { samples: oos, probs, validation };
}

/* ───────────── Explaining what was learned ───────────── */

const LESSONS: Record<FeatureKey, { up: string; down: string }> = {
  ret7: { up: "Coins that rose over the last week tended to keep outperforming (short-term momentum).", down: "Coins that rose over the last week tended to give it back next week (short-term reversal)." },
  ret30: { up: "A strong past month predicted more outperformance (medium-term momentum).", down: "A strong past month predicted underperformance next week (stretched coins cool off)." },
  ret90: { up: "Coins up over 90 days kept outperforming (long trends persist).", down: "Coins up a lot over 90 days tended to lag (late-trend exhaustion)." },
  rel7: { up: "Coins that beat BTC over the last week kept leading the following week.", down: "Coins that beat BTC over the last week tended to fall back." },
  rel30: { up: "Coins that beat BTC over 30 days kept outperforming (relative-strength momentum).", down: "Coins that beat BTC over 30 days tended to fall back (mean reversion)." },
  vsSma50: { up: "Trading above the 50-day average was a good sign.", down: "Being far above the 50-day average was a warning (overextension)." },
  vsSma200: { up: "Trading above the 200-day average helped (long-term uptrend).", down: "Being far above the 200-day average hurt (overextended vs long-term trend)." },
  goldenTrend: { up: "Coins with the 50-day above the 200-day average did better.", down: "A 50-day above 200-day structure did not help, once other factors were known." },
  rsi14: { up: "Higher RSI (stronger momentum) predicted outperformance.", down: "High RSI (overbought) predicted underperformance; low RSI helped." },
  macdHist: { up: "Positive MACD momentum predicted outperformance.", down: "Strong MACD readings tended to fade." },
  atrPct: { up: "More volatile coins tended to outperform (risk paid off).", down: "More volatile coins tended to lag steadier ones (volatility drag)." },
  squeeze: { up: "Wide Bollinger Bands (already volatile) were followed by outperformance.", down: "Narrow Bollinger Bands (squeezes) were followed by outperformance." },
  volumeRatio: { up: "Unusually high volume predicted outperformance (fresh interest).", down: "Volume spikes were followed by underperformance (blow-off moves)." },
  volumeFlow: { up: "Buying volume outweighing selling volume predicted outperformance.", down: "Heavy recent buying volume tended to be followed by weakness." },
  rangePos90: { up: "Coins near the top of their 90-day range did better (strength begets strength).", down: "Coins near the bottom of their 90-day range did better (bounce potential)." },
  drawdown180: { up: "Coins near their 180-day high did better than deeply beaten-down ones.", down: "Deeply beaten-down coins bounced harder than those near their highs." },
};

export interface Lesson {
  key: FeatureKey;
  label: string;
  group: string;
  weight: number;
  /** Share of total absolute weight, percent. */
  importance: number;
  text: string;
}

export function lessons(model: TrainedModel): Lesson[] {
  const total = model.coef.reduce((s, c) => s + Math.abs(c), 0) || 1;
  return model.features
    .map((key, j) => {
      const f = FEATURES.find((x) => x.key === key)!;
      const w = model.coef[j]!;
      return {
        key,
        label: f.label,
        group: f.group,
        weight: Math.round(w * 1000) / 1000,
        importance: Math.round((Math.abs(w) / total) * 1000) / 10,
        text: w >= 0 ? LESSONS[key].up : LESSONS[key].down,
      };
    })
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
}

export interface Change {
  key: FeatureKey;
  label: string;
  from: number;
  to: number;
  kind: "flipped" | "stronger" | "weaker";
  text: string;
}

/** What changed between two trained models: sign flips and large weight moves. */
export function compareModels(prev: TrainedModel | null, next: TrainedModel): Change[] {
  if (!prev) return [];
  const out: Change[] = [];
  next.features.forEach((key, j) => {
    const pj = prev.features.indexOf(key);
    if (pj < 0) return;
    const a = prev.coef[pj]!;
    const b = next.coef[j]!;
    const label = FEATURES.find((f) => f.key === key)!.label;
    if (Math.sign(a) !== Math.sign(b) && Math.abs(a) > 0.02 && Math.abs(b) > 0.02) {
      out.push({ key, label, from: a, to: b, kind: "flipped", text: `${label} flipped from ${a > 0 ? "helping" : "hurting"} to ${b > 0 ? "helping" : "hurting"}.` });
    } else if (Math.abs(b - a) >= 0.05 && Math.abs(b - a) >= Math.abs(a) * 0.4) {
      const kind = Math.abs(b) > Math.abs(a) ? "stronger" : "weaker";
      out.push({ key, label, from: a, to: b, kind, text: `${label} became a ${kind} factor (${a.toFixed(2)} → ${b.toFixed(2)}).` });
    }
  });
  return out.sort((x, y) => Math.abs(y.to - y.from) - Math.abs(x.to - x.from)).slice(0, 8);
}

/**
 * How much Autopilot should trust the model. From its out-of-sample AUC: nothing at or below
 * 0.51 (no real skill), rising to the cap at 0.60; then scaled down by the share of validation
 * periods in which it failed, so a model that only worked some of the time counts for less.
 */
export function modelTrust(testAuc: number | null | undefined, positiveFoldShare = 1): number {
  if (!testAuc || testAuc <= 0.51) return 0;
  return Math.min(1, (testAuc - 0.51) / 0.09) * Math.max(0, Math.min(1, positiveFoldShare));
}
