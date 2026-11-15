import { withApi } from "@/lib/api/handler";
import { getCollections } from "@/lib/mongodb/collections";
import { getMarketDirection, timeframeTrends } from "@/services/market/direction-service";
import { ZONES } from "@/services/market/direction";

export const dynamic = "force-dynamic";
// A cold reading loads ~100 daily histories; afterwards it is cached for 30 minutes.
export const maxDuration = 60;

const MAJORS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];

async function userSymbols(userId: string): Promise<string[]> {
  try {
    const { holdings, watchlist } = await getCollections();
    const [held, watched] = await Promise.all([
      holdings.find({ userId, quantity: { $gt: 0 } }, { projection: { symbol: 1 } }).limit(8).toArray(),
      watchlist.find({ userId, active: true }, { projection: { symbol: 1 } }).sort({ addedAt: -1 }).limit(8).toArray(),
    ]);
    return [...held, ...watched].map((d) => d.symbol);
  } catch {
    return [];
  }
}

export const GET = withApi(async ({ user }) => {
  const [direction, mine] = await Promise.all([getMarketDirection(), userSymbols(user.id)]);
  const timeframes = await timeframeTrends([...new Set([...MAJORS, ...mine])].slice(0, 12));
  return {
    direction: direction.data,
    zones: ZONES.map((z) => ({ key: z.key, label: z.label })),
    timeframes,
    fetchedAt: new Date(direction.fetchedAt).toISOString(),
    stale: direction.stale,
  };
});
