import { describe, expect, it } from "vitest";
import { extractFollowUps, extractOutlooks } from "@/services/ai/orchestration/follow-ups";
import { buildScorecard, forwardStats, labelFor } from "@/services/indicators/scorecard";
import { summarizeIndicators } from "@/services/indicators/summary";
import { levelOutcome, sanitizeLevels, summarizeTrackRecord } from "@/services/predictions/scoring";
import type { Kline } from "@/services/binance/schemas";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 1);

function candles(closes: number[], end = NOW): Kline[] {
  return closes.map((c, i) => {
    const openTime = end - (closes.length - i) * DAY;
    return { openTime, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 100, closeTime: openTime + DAY - 1, quoteVolume: 100 * c, trades: 10 };
  });
}

const bar = (high: number, low: number): Kline => ({ openTime: 0, open: 0, high, low, close: 0, volume: 0, closeTime: 0, quoteVolume: 0, trades: 0 });

describe("extractOutlooks", () => {
  it("parses outlook lines, strips them, and leaves follow-ups intact", () => {
    const text = [
      "## Verdict: Bullish on SOLUSDT",
      "Body.",
      'OUTLOOK_JSON: {"symbol":"SOLUSDT","bias":"bullish","confidence":68,"horizon":"7d","entry":[140,135],"target":160,"stop":128}',
      "FOLLOW_UPS: What about ETH? || Risks?",
    ].join("\n");
    const { content, outlooks } = extractOutlooks(text);
    expect(outlooks).toEqual([
      { symbol: "SOLUSDT", bias: "bullish", confidence: 68, horizon: "7d", entry: [135, 140], target: 160, stop: 128 },
    ]);
    expect(content).not.toContain("OUTLOOK_JSON");
    expect(extractFollowUps(content)).toEqual({
      content: "## Verdict: Bullish on SOLUSDT\nBody.",
      followUps: ["What about ETH?", "Risks?"],
    });
  });

  it("clamps confidence, defaults the horizon and drops malformed lines", () => {
    const { outlooks } = extractOutlooks(
      'OUTLOOK_JSON: {"symbol":"eth","bias":"bearish","confidence":99,"horizon":"1y","target":"x","stop":null}\n' +
        "OUTLOOK_JSON: {broken\n" +
        'OUTLOOK_JSON: {"symbol":"BTC","bias":"moon","confidence":60}',
    );
    expect(outlooks).toEqual([{ symbol: "ETH", bias: "bearish", confidence: 95, horizon: "7d", entry: null, target: null, stop: null }]);
  });
});

describe("sanitizeLevels", () => {
  it("drops levels on the wrong side of the price", () => {
    expect(sanitizeLevels({ bias: "bullish", entry: null, target: 90, stop: 95 }, 100)).toMatchObject({ target: null, stop: 95 });
    expect(sanitizeLevels({ bias: "bearish", entry: null, target: 90, stop: 95 }, 100)).toMatchObject({ target: 90, stop: null });
    expect(sanitizeLevels({ bias: "neutral", entry: null, target: 110, stop: 90 }, 100)).toMatchObject({ target: null, stop: null });
  });
});

describe("levelOutcome", () => {
  it("returns the level reached first, stop first when one candle touches both", () => {
    expect(levelOutcome("bullish", 110, 90, [bar(105, 95), bar(111, 100)])).toBe("target");
    expect(levelOutcome("bullish", 110, 90, [bar(105, 89), bar(111, 100)])).toBe("stop");
    expect(levelOutcome("bullish", 110, 90, [bar(112, 88)])).toBe("stop");
    expect(levelOutcome("bearish", 90, 110, [bar(105, 89)])).toBe("target");
    expect(levelOutcome("bullish", 110, 90, [bar(105, 95)])).toBe("none");
    expect(levelOutcome("neutral", null, null, [bar(105, 95)])).toBeNull();
  });
});

describe("summarizeTrackRecord", () => {
  const ev = (outcome: "correct" | "incorrect" | "inconclusive", levelHit: "target" | "stop" | "none" | null = null) => ({
    horizon: "7d" as const,
    evaluatedAt: new Date(),
    startPrice: 1,
    endPrice: 1,
    returnPercent: 0,
    maxUpsidePercent: 0,
    maxDownsidePercent: 0,
    outcome,
    levelHit,
  });

  it("counts outcomes and computes hit rate over decided calls only", () => {
    const r = summarizeTrackRecord([
      { confidence: 70, horizon: "7d", evaluation: ev("correct", "target") },
      { confidence: 60, horizon: "7d", evaluation: ev("incorrect", "stop") },
      { confidence: 80, horizon: "7d", evaluation: ev("correct") },
      { confidence: 65, horizon: "24h", evaluation: ev("inconclusive") },
      { confidence: 55, horizon: "30d", evaluation: null },
    ]);
    expect(r).toMatchObject({ total: 5, pending: 1, correct: 2, incorrect: 1, inconclusive: 1, targetHits: 1, stopHits: 1, avgConfidence: 70 });
    expect(r.hitRatePercent).toBeCloseTo(66.7, 1);
    expect(r.byHorizon.find((h) => h.horizon === "7d")).toEqual({ horizon: "7d", correct: 2, incorrect: 1 });
  });

  it("has no hit rate before anything is decided", () => {
    expect(summarizeTrackRecord([{ confidence: 60, horizon: "7d", evaluation: null }]).hitRatePercent).toBeNull();
  });
});

describe("scorecard", () => {
  it("labels composite scores", () => {
    expect(labelFor(60)).toBe("strong bullish");
    expect(labelFor(20)).toBe("bullish");
    expect(labelFor(0)).toBe("neutral");
    expect(labelFor(-20)).toBe("bearish");
    expect(labelFor(-60)).toBe("strong bearish");
  });

  it("computes forward-return base rates", () => {
    const rising = Array.from({ length: 60 }, (_, i) => 100 + i);
    const s = forwardStats(rising, 7)!;
    expect(s.upPercent).toBe(100);
    expect(s.samples).toBe(53);
    expect(s.p10ReturnPercent).toBeGreaterThan(0);
    expect(forwardStats(rising.slice(0, 20), 7)).toBeNull();
  });

  it("scores a steady uptrend as bullish and a downtrend as bearish", () => {
    const upCloses = Array.from({ length: 300 }, (_, i) => 100 * 1.004 ** i + Math.sin(i) * 0.5);
    const up = candles(upCloses);
    const upCard = buildScorecard(up, summarizeIndicators(up, "1d"), null, NOW);
    expect(upCard.composite).toBeGreaterThan(15);
    expect(upCard.baseRates.sameRegime?.regime).toBe("above 50d SMA");

    const downCloses = upCloses.slice().reverse();
    const down = candles(downCloses);
    const downCard = buildScorecard(down, summarizeIndicators(down, "1d"), up, NOW);
    expect(downCard.composite).toBeLessThan(-15);
    expect(downCard.relativeToBtc?.outperformance30dPercent).toBeLessThan(0);
  });
});
