import { z } from "zod";
import { withApi, parseJson } from "@/lib/api/handler";
import { symbolSchema } from "@/lib/validation/schemas";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { MAX_SHORTLIST, generateShortlist, listShortlists } from "@/services/discovery/discovery-service";
import { serialize } from "@/types/serialized";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export const GET = withApi(async ({ user }) => serialize(await listShortlists(user.id)));

export const POST = withApi(
  async ({ req, user }) => {
    const { screen, symbols } = await parseJson(
      req,
      z.object({
        screen: z.string().regex(/^[a-z_]{1,20}$/),
        symbols: z.array(symbolSchema).min(1).max(MAX_SHORTLIST),
      }),
    );
    return serialize(await generateShortlist(user.id, screen, symbols, req.signal));
  },
  { rateLimit: RATE_LIMITS.aiResearch },
);
