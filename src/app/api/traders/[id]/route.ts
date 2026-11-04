import { z } from "zod";
import { withApi, parseJson, parseWith } from "@/lib/api/handler";
import { idSchema } from "@/lib/validation/schemas";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { deleteTrader, getTrader, updateTrader } from "@/services/traders/trader-service";
import { serialize } from "@/types/serialized";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  profileUrl: z.url().max(300).nullable().optional(),
  startingValue: z.number().positive().max(1e12).nullable().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const GET = withApi<{ id: string }>(async ({ user, params }) =>
  serialize(await getTrader(user.id, parseWith(idSchema, params.id))),
);

export const PATCH = withApi<{ id: string }>(
  async ({ req, user, params }) => serialize(await updateTrader(user.id, parseWith(idSchema, params.id), await parseJson(req, patchSchema))),
  { rateLimit: RATE_LIMITS.mutation },
);

export const DELETE = withApi<{ id: string }>(async ({ user, params }) => {
  await deleteTrader(user.id, parseWith(idSchema, params.id));
  return { ok: true };
});
