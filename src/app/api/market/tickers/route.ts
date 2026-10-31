import { z } from "zod";
import { withApi, parseSearchParams } from "@/lib/api/handler";
import { marketData } from "@/services/binance";
import { getCollections } from "@/lib/mongodb/collections";
import { getActivePortfolio } from "@/services/portfolio/portfolio-service";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const query = z.object({
  quote: z
    .string()
    .regex(/^[A-Z0-9]{2,10}$/)
    .default("USDT"),
});

async function userFlags(userId: string) {
  // Market data stays usable when the database is down; only the watch/held flags are missing.
  try {
    const { watchlist, holdings } = await getCollections();
    const portfolio = await getActivePortfolio(userId);
    const [watched, held] = await Promise.all([
      watchlist.find({ userId, active: true }, { projection: { symbol: 1, personalRanking: 1 } }).toArray(),
      holdings.find({ portfolioId: portfolio._id, quantity: { $gt: 0 } }, { projection: { symbol: 1 } }).toArray(),
    ]);
    return {
      watch: new Map(watched.map((w) => [w.symbol, w.personalRanking ?? null])),
      held: new Set(held.map((h) => h.symbol)),
      available: true,
    };
  } catch (err) {
    logger.warn("market.tickers.user_flags_unavailable", { error: err });
    return { watch: new Map<string, number | null>(), held: new Set<string>(), available: false };
  }
}

export const GET = withApi(async ({ req, user }) => {
  const { quote } = parseSearchParams(req, query);
  const [res, flags] = await Promise.all([marketData().allTickers(), userFlags(user.id)]);

  const quoteAssets = [...new Set(res.data.map((t) => t.quoteAsset))].sort();
  const rows = res.data
    .filter((t) => quote === "ALL" || t.quoteAsset === quote)
    .map((t) => ({
      ...t,
      watched: flags.watch.has(t.symbol),
      ranking: flags.watch.get(t.symbol) ?? null,
      held: flags.held.has(t.symbol),
    }));

  return {
    rows,
    quoteAssets,
    personalDataAvailable: flags.available,
    fetchedAt: new Date(res.fetchedAt).toISOString(),
    stale: res.stale,
  };
});
