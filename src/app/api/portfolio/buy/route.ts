import { after } from "next/server";
import { withApi, parseJson } from "@/lib/api/handler";
import { buySchema } from "@/lib/validation/schemas";
import { executeBuy } from "@/services/portfolio/portfolio-service";
import { createPortfolioSnapshot } from "@/services/portfolio/snapshots";
import { serialize } from "@/types/serialized";

export const dynamic = "force-dynamic";

export const POST = withApi(async ({ req, user }) => {
  const input = await parseJson(req, buySchema);
  const result = await executeBuy(user.id, input);
  if (!result.replayed) {
    after(() => createPortfolioSnapshot(user.id, "trade").catch(() => undefined));
  }
  return serialize(result);
});
