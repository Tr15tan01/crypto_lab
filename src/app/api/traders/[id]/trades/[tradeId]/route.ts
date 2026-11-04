import { withApi, parseWith } from "@/lib/api/handler";
import { idSchema } from "@/lib/validation/schemas";
import { deleteTrade } from "@/services/traders/trader-service";

export const dynamic = "force-dynamic";

export const DELETE = withApi<{ id: string; tradeId: string }>(async ({ user, params }) => {
  await deleteTrade(user.id, parseWith(idSchema, params.id), parseWith(idSchema, params.tradeId));
  return { ok: true };
});
