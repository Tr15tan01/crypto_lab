import { withApi, parseJson, parseWith } from "@/lib/api/handler";
import { idSchema, watchlistUpdateSchema } from "@/lib/validation/schemas";
import { removeFromWatchlist, updateWatchlistItem } from "@/services/watchlist/watchlist-service";
import { serialize } from "@/types/serialized";

export const dynamic = "force-dynamic";

export const PATCH = withApi<{ id: string }>(async ({ req, user, params }) => {
  const id = parseWith(idSchema, params.id);
  const input = await parseJson(req, watchlistUpdateSchema);
  return serialize(await updateWatchlistItem(user.id, id, input));
});

export const DELETE = withApi<{ id: string }>(async ({ user, params }) => {
  const id = parseWith(idSchema, params.id);
  await removeFromWatchlist(user.id, id);
  return { ok: true };
});
