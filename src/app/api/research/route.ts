import { z } from "zod";
import { withApi, parseJson, parseSearchParams } from "@/lib/api/handler";
import { symbolSchema } from "@/lib/validation/schemas";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { generateResearch, listResearch } from "@/services/research/research-service";
import { serialize } from "@/types/serialized";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export const GET = withApi(async ({ req, user }) => {
  const { symbol, limit } = parseSearchParams(
    req,
    z.object({ symbol: symbolSchema.optional(), limit: z.coerce.number().int().min(1).max(200).optional() }),
  );
  return serialize(await listResearch(user.id, { symbol, limit }));
});

export const POST = withApi(
  async ({ req, user }) => {
    const { symbol } = await parseJson(req, z.object({ symbol: symbolSchema }));
    return serialize(await generateResearch(user.id, symbol, req.signal));
  },
  { rateLimit: RATE_LIMITS.aiResearch },
);
