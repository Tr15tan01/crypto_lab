import { z } from "zod";
import { withApi, parseSearchParams } from "@/lib/api/handler";
import { symbolSchema } from "@/lib/validation/schemas";
import { listTransactions } from "@/services/portfolio/portfolio-service";
import { serialize } from "@/types/serialized";

export const dynamic = "force-dynamic";

const query = z.object({
  symbol: symbolSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export const GET = withApi(async ({ req, user }) => {
  const { symbol, limit } = parseSearchParams(req, query);
  return serialize(await listTransactions(user.id, { symbol, limit }));
});
