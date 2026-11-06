import { z } from "zod";
import { withApi, parseSearchParams } from "@/lib/api/handler";
import { symbolSchema } from "@/lib/validation/schemas";
import { scoreSymbol } from "@/services/learning/learning-service";

export const dynamic = "force-dynamic";

export const GET = withApi(async ({ req }) => {
  const { symbol } = parseSearchParams(req, z.object({ symbol: symbolSchema }));
  return { view: await scoreSymbol(symbol) };
});
