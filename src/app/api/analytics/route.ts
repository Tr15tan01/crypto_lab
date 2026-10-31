import { after } from "next/server";
import { withApi } from "@/lib/api/handler";
import { getAnalytics } from "@/services/analytics/analytics-service";
import { evaluateDueResearch } from "@/services/research/research-service";
import { serialize } from "@/types/serialized";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withApi(async ({ user }) => {
  // Fill in any AI prediction evaluations that came due (bounded, idempotent).
  after(() => evaluateDueResearch(user.id, 5).catch(() => 0));
  return serialize(await getAnalytics(user.id));
});
