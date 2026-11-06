/**
 * Accuracy over time for one horizon. Pure: takes scored items (calls or model picks) and
 * returns the overall hit rate plus a week-by-week cumulative line for the gauge.
 * Inconclusive results (moves too small to call) are counted but excluded from the hit rate.
 */
export type Outcome = "correct" | "incorrect" | "inconclusive" | null;

export interface AccuracyItem {
  t: number;
  outcome: Outcome;
  /** Optional result in percent (return for calls, excess vs BTC for model picks). */
  resultPercent?: number | null;
}

export interface AccuracyPoint {
  /** Start of the week (ms). */
  t: number;
  /** Cumulative hit rate up to and including this week, percent. */
  cumulative: number;
  /** Hit rate of this week alone, percent. */
  week: number;
  decided: number;
}

export interface Accuracy {
  total: number;
  correct: number;
  incorrect: number;
  inconclusive: number;
  pending: number;
  hitRatePercent: number | null;
  /** Hit rate over the most recent 4 weeks with data, to show the direction of travel. */
  recentHitRatePercent: number | null;
  avgResultPercent: number | null;
  series: AccuracyPoint[];
}

const WEEK = 7 * 86_400_000;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export function accuracyOf(items: AccuracyItem[]): Accuracy {
  const correct = items.filter((i) => i.outcome === "correct").length;
  const incorrect = items.filter((i) => i.outcome === "incorrect").length;
  const results = items.map((i) => i.resultPercent).filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  const weeks = new Map<number, { c: number; d: number }>();
  for (const i of items) {
    if (i.outcome !== "correct" && i.outcome !== "incorrect") continue;
    const w = Math.floor(i.t / WEEK) * WEEK;
    const e = weeks.get(w) ?? { c: 0, d: 0 };
    e.d++;
    if (i.outcome === "correct") e.c++;
    weeks.set(w, e);
  }
  let cc = 0;
  let cd = 0;
  const series: AccuracyPoint[] = [...weeks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, e]) => {
      cc += e.c;
      cd += e.d;
      return { t, cumulative: pct(cc, cd)!, week: pct(e.c, e.d)!, decided: e.d };
    });
  const recent = series.slice(-4);
  const rc = recent.reduce((s, p) => s + (p.week / 100) * p.decided, 0);
  const rd = recent.reduce((s, p) => s + p.decided, 0);

  return {
    total: items.length,
    correct,
    incorrect,
    inconclusive: items.filter((i) => i.outcome === "inconclusive").length,
    pending: items.filter((i) => i.outcome === null).length,
    hitRatePercent: pct(correct, correct + incorrect),
    recentHitRatePercent: rd > 0 ? Math.round((rc / rd) * 1000) / 10 : null,
    avgResultPercent: results.length ? Math.round((results.reduce((a, b) => a + b, 0) / results.length) * 100) / 100 : null,
    series,
  };
}
