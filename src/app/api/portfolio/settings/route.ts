import { withApi, parseJson } from "@/lib/api/handler";
import { feeConfigSchema, portfolioConfigSchema } from "@/lib/validation/schemas";
import { resetPortfolio, updateFeeConfiguration } from "@/services/portfolio/portfolio-service";
import { serialize } from "@/types/serialized";

export const dynamic = "force-dynamic";

/** Change fee settings for future simulated trades (past trades keep their recorded fee). */
export const PATCH = withApi(async ({ req, user }) => {
  const input = await parseJson(req, feeConfigSchema);
  await updateFeeConfiguration(user.id, input.feeEnabled, input.feeRatePercent);
  return { ok: true };
});

/** Start a new portfolio; the current one is archived with its full history. */
export const POST = withApi(async ({ req, user }) => {
  const input = await parseJson(req, portfolioConfigSchema);
  return serialize(await resetPortfolio(user.id, input));
});
