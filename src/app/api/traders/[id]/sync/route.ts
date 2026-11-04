import { withApi, parseWith } from "@/lib/api/handler";
import { idSchema } from "@/lib/validation/schemas";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { syncTrader } from "@/services/traders/trader-service";
import { serialize } from "@/types/serialized";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withApi<{ id: string }>(
  async ({ user, params }) => serialize(await syncTrader(user.id, parseWith(idSchema, params.id))),
  { rateLimit: RATE_LIMITS.mutation },
);
