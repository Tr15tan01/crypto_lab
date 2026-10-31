import { withApi } from "@/lib/api/handler";
import { marketData } from "@/services/binance";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => {
  const md = marketData();
  // Touch the shared ticker cache (cheap when fresh) so status reflects a real attempt.
  let fetchedAt: number | null = null;
  let stale = true;
  try {
    const res = await md.allTickers();
    fetchedAt = res.fetchedAt;
    stale = res.stale;
  } catch {
    // reported via status below
  }
  const status = md.status();
  const state = fetchedAt === null ? "unavailable" : stale ? "stale" : "live";
  return {
    state,
    lastUpdatedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null,
    pausedUntil: status.pausedUntil ? new Date(status.pausedUntil).toISOString() : null,
    source: "Binance Spot public market data",
  };
});
