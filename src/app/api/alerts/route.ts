import { z } from "zod";
import { withApi, parseJson, parseSearchParams } from "@/lib/api/handler";
import { alertCreateSchema, symbolSchema } from "@/lib/validation/schemas";
import { createAlert, listAlerts } from "@/services/alerts/alerts-service";
import { serialize } from "@/types/serialized";

export const dynamic = "force-dynamic";

export const GET = withApi(async ({ req, user }) => {
  const q = parseSearchParams(req, z.object({ symbol: symbolSchema.optional() }));
  return serialize(await listAlerts(user.id, q));
});

export const POST = withApi(async ({ req, user }) => {
  const input = await parseJson(req, alertCreateSchema);
  return serialize(await createAlert(user.id, input));
});
