import { z } from "zod";
import { withApi, parseJson, parseWith } from "@/lib/api/handler";
import { idSchema } from "@/lib/validation/schemas";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { ValidationError } from "@/lib/errors";
import { addTrades } from "@/services/traders/trader-service";
import { parseTradesCsv } from "@/services/traders/metrics";

export const dynamic = "force-dynamic";

const tradeSchema = z.object({
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,20}$/, "Invalid symbol"),
  side: z.enum(["long", "short"]),
  entryPrice: z.number().positive(),
  exitPrice: z.number().positive().nullable(),
  quantity: z.number().positive().nullable(),
  leverage: z.number().positive().max(200).nullable(),
  openedAt: z.number().int().positive(),
  closedAt: z.number().int().positive().nullable(),
  pnl: z.number().finite().nullable(),
});

const bodySchema = z.union([z.object({ trade: tradeSchema }), z.object({ csv: z.string().min(1).max(500_000) })]);

/** Adds one trade, or a pasted CSV of trades, to a manually tracked trader. */
export const POST = withApi<{ id: string }>(
  async ({ req, user, params }) => {
    const id = parseWith(idSchema, params.id);
    const body = await parseJson(req, bodySchema);
    if ("trade" in body) return { added: await addTrades(user.id, id, [body.trade], "manual"), errors: [] };
    const { trades, errors } = parseTradesCsv(body.csv);
    if (!trades.length) throw new ValidationError(errors[0] ?? "No valid trades found.", { lines: errors });
    return { added: await addTrades(user.id, id, trades, "csv"), errors };
  },
  { rateLimit: RATE_LIMITS.mutation },
);
