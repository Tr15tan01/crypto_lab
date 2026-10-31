import { withApi, parseJson, parseWith } from "@/lib/api/handler";
import { executionUpdateSchema, idSchema } from "@/lib/validation/schemas";
import { updateExecutionStatus } from "@/services/portfolio/portfolio-service";
import { serialize } from "@/types/serialized";

export const dynamic = "force-dynamic";

export const PATCH = withApi<{ id: string }>(async ({ req, user, params }) => {
  const id = parseWith(idSchema, params.id);
  const input = await parseJson(req, executionUpdateSchema);
  return serialize(await updateExecutionStatus(user.id, id, input));
});
