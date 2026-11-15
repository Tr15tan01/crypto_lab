import { withApi } from "@/lib/api/handler";
import { getStrategyBacktest } from "@/services/backtest/backtest-service";
import { STRATEGIES, bestFor, verdictOf } from "@/services/backtest/strategy-backtest";
import { getMarketDirection } from "@/services/market/direction-service";

export const dynamic = "force-dynamic";
// A cold run replays ~100 daily histories; afterwards it is served from a 12-hour cache.
export const maxDuration = 60;

export const GET = withApi(async () => {
  const [bt, direction] = await Promise.all([getStrategyBacktest(), getMarketDirection().catch(() => null)]);
  const regime = direction?.data.regime ?? null;
  return {
    pairs: bt.data.pairs,
    from: bt.data.from,
    to: bt.data.to,
    strategies: bt.data.results.map((r) => ({ ...STRATEGIES.find((s) => s.key === r.key)!, ...r, verdict: verdictOf(r.overall) })),
    market: direction ? { score: direction.data.score, zoneLabel: direction.data.zoneLabel, regime } : null,
    bestNow: regime ? bestFor(bt.data.results, regime).slice(0, 3).map((r) => r.key) : [],
    fetchedAt: new Date(bt.fetchedAt).toISOString(),
    stale: bt.stale,
  };
});
