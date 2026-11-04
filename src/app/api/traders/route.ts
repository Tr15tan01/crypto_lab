import { z } from "zod";
import { withApi, parseJson } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { createManualTrader, listTraders, trackBinanceTrader } from "@/services/traders/trader-service";
import { serialize } from "@/types/serialized";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const createSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("binance_copy"), portfolioId: z.string().trim().regex(/^\d{6,30}$/, "Invalid Binance lead-portfolio id") }),
  z.object({
    source: z.literal("manual"),
    name: z.string().trim().min(1).max(80),
    profileUrl: z.url().max(300).nullable().optional(),
    startingValue: z.number().positive().max(1e12),
    notes: z.string().trim().max(2000).optional(),
  }),
]);

export const GET = withApi(async ({ user }) => serialize(await listTraders(user.id)));

export const POST = withApi(
  async ({ req, user }) => {
    const body = await parseJson(req, createSchema);
    const doc =
      body.source === "binance_copy"
        ? await trackBinanceTrader(user.id, body.portfolioId)
        : await createManualTrader(user.id, body);
    return serialize(doc);
  },
  { rateLimit: RATE_LIMITS.mutation },
);
