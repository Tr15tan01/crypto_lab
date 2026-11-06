import { describe, expect, it } from "vitest";
import { accuracyOf } from "@/services/predictions/accuracy";

const WEEK = 7 * 86_400_000;
const T0 = Math.floor(Date.UTC(2026, 8, 1) / WEEK) * WEEK;

describe("accuracyOf", () => {
  it("counts outcomes and excludes inconclusive and pending from the hit rate", () => {
    const a = accuracyOf([
      { t: T0, outcome: "correct", resultPercent: 4 },
      { t: T0, outcome: "incorrect", resultPercent: -2 },
      { t: T0, outcome: "inconclusive", resultPercent: 0.1 },
      { t: T0, outcome: null },
    ]);
    expect(a).toMatchObject({ total: 4, correct: 1, incorrect: 1, inconclusive: 1, pending: 1, hitRatePercent: 50 });
    expect(a.avgResultPercent).toBeCloseTo(0.7, 5);
  });

  it("builds a cumulative weekly line and a recent hit rate", () => {
    const items = [
      ...Array.from({ length: 4 }, () => ({ t: T0, outcome: "incorrect" as const })),
      ...Array.from({ length: 4 }, () => ({ t: T0 + WEEK, outcome: "correct" as const })),
      ...Array.from({ length: 2 }, () => ({ t: T0 + 2 * WEEK + 1000, outcome: "correct" as const })),
    ];
    const a = accuracyOf(items);
    expect(a.series.map((p) => p.cumulative)).toEqual([0, 50, 60]);
    expect(a.series.map((p) => p.week)).toEqual([0, 100, 100]);
    expect(a.hitRatePercent).toBe(60);
    expect(a.recentHitRatePercent).toBe(60);
  });

  it("returns no hit rate without scored items", () => {
    expect(accuracyOf([{ t: T0, outcome: null }]).hitRatePercent).toBeNull();
    expect(accuracyOf([]).series).toEqual([]);
  });
});
