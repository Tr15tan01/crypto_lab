import { withApi, parseWith } from "@/lib/api/handler";
import { idSchema } from "@/lib/validation/schemas";
import { deleteAlert } from "@/services/alerts/alerts-service";

export const dynamic = "force-dynamic";

export const DELETE = withApi<{ id: string }>(async ({ user, params }) => {
  await deleteAlert(user.id, parseWith(idSchema, params.id));
  return { ok: true };
});
