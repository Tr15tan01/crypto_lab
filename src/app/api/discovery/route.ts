import { withApi } from "@/lib/api/handler";
import { getCollections } from "@/lib/mongodb/collections";
import { logger } from "@/lib/logger";
import { getDiscoveryScan } from "@/services/discovery/discovery-service";

export const dynamic = "force-dynamic";
// A fresh scan loads daily candles for a few hundred pairs.
export const maxDuration = 60;

async function watchedSymbols(userId: string): Promise<string[] | null> {
  // The scan stays usable when the database is down; only the watchlist markers are missing.
  try {
    const { watchlist } = await getCollections();
    const rows = await watchlist.find({ userId, active: true }, { projection: { symbol: 1 } }).toArray();
    return rows.map((r) => r.symbol);
  } catch (err) {
    logger.warn("discovery.watchlist_unavailable", { error: err });
    return null;
  }
}

export const GET = withApi(async ({ user }) => {
  const [scan, watched] = await Promise.all([getDiscoveryScan(), watchedSymbols(user.id)]);
  return {
    ...scan.data,
    watched: watched ?? [],
    personalDataAvailable: watched !== null,
    fetchedAt: new Date(scan.fetchedAt).toISOString(),
    stale: scan.stale,
  };
});
