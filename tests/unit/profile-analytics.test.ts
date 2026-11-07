import { describe, expect, it } from "vitest";
import { activityTimeline, capitalByCoin, exposure, holdingsView, type TradeLike } from "@/services/traders/metrics";
import { bucketRounds, insightsFrom, tradeQuality, type ScoredRound } from "@/services/analytics/metrics";

const H = 3_600_000;
const NOW = Date.UTC(2026, 10, 7, 12);

function t(over: Partial<TradeLike & { status: "open" | "partial" | "closed" }>): TradeLike & { status: "open" | "partial" | "closed" } {
  return { symbol: "SOLUSDT", side: "long", leverage: 10, openedAt: NOW - 10 * H, closedAt: null, entryPrice: 100, exitPrice: null, quantity: 5, pnl: null, status: "open", ...over };
}

describe("trader profile", () => {
  it("prices open positions with leverage-aware returns", () => {
    const [long, short] = holdingsView(
      [t({}), t({ symbol: "ETHUSDT", side: "short", leverage: 5, entryPrice: 2000, quantity: 1 }), t({ status: "closed", closedAt: NOW })],
      (s) => (s === "SOLUSDT" ? 110 : 1900),
    ).sort((a, b) => a.symbol.localeCompare(b.symbol)).reverse();
    expect(long).toMatchObject({ symbol: "SOLUSDT", notional: 500, margin: 50, movePercent: 10, roePercent: 100, unrealizedPnl: 50 });
    expect(short).toMatchObject({ symbol: "ETHUSDT", notional: 2000, margin: 400, movePercent: 5, roePercent: 25, unrealizedPnl: 100 });
  });

  it("summarises exposure and recent activity", () => {
    const holdings = holdingsView([t({}), t({ symbol: "ETHUSDT", side: "short", entryPrice: 2000, quantity: 1 })], () => null);
    const e = exposure(holdings, [t({}), t({ openedAt: NOW - 10 * 24 * H })], NOW);
    expect(e.longNotional).toBe(500);
    expect(e.shortNotional).toBe(2000);
    expect(e.netBias).toBeCloseTo(-0.6);
    expect(e.opened7d).toBe(1);
  });

  it("lists opens and closes newest first, with P&L on closes", () => {
    const ev = activityTimeline([t({ closedAt: NOW - H, exitPrice: 120, status: "closed" })]);
    expect(ev.map((e) => e.kind)).toEqual(["close", "open"]);
    expect(ev[0]).toMatchObject({ pnl: 100, holdingHours: 9 });
  });

  it("sums position value per coin", () => {
    const c = capitalByCoin([t({}), t({ quantity: 15 }), t({ symbol: "ETHUSDT", entryPrice: 1000, quantity: 1 })]);
    expect(c[0]).toMatchObject({ symbol: "SOLUSDT", notional: 2000, positions: 2 });
    expect(c[0]!.sharePercent).toBeCloseTo((2000 / 3000) * 100);
  });
});

describe("analytics", () => {
  const r = (pnl: number, ret: number, closedAt: number | null = NOW, openedAt = NOW - 48 * H): ScoredRound => ({ symbol: "X", openedAt, closedAt, holdMs: 48 * H, pnl, returnPercent: ret });

  it("computes payoff ratio, profit factor, expectancy and streaks", () => {
    const q = tradeQuality([r(20, 20, NOW - 4), r(-10, -10, NOW - 3), r(-10, -10, NOW - 2), r(30, 30, NOW - 1), r(5, 5, null)]);
    expect(q).toMatchObject({ closed: 4, wins: 2, losses: 2, avgWinPercent: 25, avgLossPercent: -10, payoffRatio: 2.5, profitFactor: 2.5, expectancy: 7.5 });
    expect(q.breakEvenWinRate).toBeCloseTo(28.57, 1);
    expect(q.longestLossStreak).toBe(2);
  });

  it("buckets rounds and turns clear differences into insights", () => {
    const rounds = [...Array.from({ length: 4 }, () => r(10, 10)), ...Array.from({ length: 3 }, () => ({ ...r(-5, -5), symbol: "Y" }))];
    const buckets = bucketRounds(rounds, (x) => (x.symbol === "X" ? "a" : "b"), [
      { key: "a", label: "Bought in fear" },
      { key: "b", label: "Bought in greed" },
    ]);
    expect(buckets.map((b) => [b.rounds, b.winRatePercent, b.avgReturnPercent])).toEqual([[4, 100, 10], [3, 0, -5]]);
    const ins = insightsFrom([{ name: "Market mood", buckets }]);
    expect(ins[0]!.text).toContain("bought in fear averaged +10.0%");
    expect(insightsFrom([{ name: "x", buckets: buckets.slice(0, 1) }])).toEqual([]);
  });
});
