import { withApi } from "@/lib/api/handler";
import { getSignalBacktest } from "@/services/backtest/backtest-service";
import { BACKTEST_SIGNALS } from "@/services/backtest/signal-backtest";
import { getDiscoveryScan } from "@/services/discovery/discovery-service";

export const dynamic = "force-dynamic";
// A cold run loads ~100 daily histories; afterwards it is served from a 12-hour cache.
export const maxDuration = 60;

export const GET = withApi(async () => {
  const [bt, scan] = await Promise.all([getSignalBacktest(), getDiscoveryScan()]);
  // Which pairs fire each signal right now, most liquid first.
  const firing = Object.fromEntries(
    BACKTEST_SIGNALS.map((s) => [
      s,
      scan.data.rows
        .filter((r) => r.signals.includes(s))
        .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h)
        .slice(0, 8)
        .map((r) => ({ symbol: r.symbol, baseAsset: r.baseAsset, change24h: r.change24h })),
    ]),
  );
  return {
    ...bt.data,
    universe: bt.data.universe.length,
    firing,
    fetchedAt: new Date(bt.fetchedAt).toISOString(),
    stale: bt.stale,
  };
});
