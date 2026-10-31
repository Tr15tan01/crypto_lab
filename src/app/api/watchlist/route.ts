import { z } from "zod";
import { withApi, parseJson, parseSearchParams } from "@/lib/api/handler";
import { watchlistAddSchema } from "@/lib/validation/schemas";
import { addToWatchlist, listWatchlist } from "@/services/watchlist/watchlist-service";
import { serialize } from "@/types/serialized";

export const dynamic = "force-dynamic";

export const GET = withApi(async ({ req, user }) => {
  const { history } = parseSearchParams(req, z.object({ history: z.enum(["1", "0"]).optional() }));
  return listWatchlist(user.id, { includeRemoved: history === "1" });
});

export const POST = withApi(async ({ req, user }) => {
  const input = await parseJson(req, watchlistAddSchema);
  return serialize(await addToWatchlist(user.id, input));
});
