import { withApi } from "@/lib/api/handler";
import { getAutopilotPlan } from "@/services/autopilot/autopilot-service";
import { serialize } from "@/types/serialized";

export const dynamic = "force-dynamic";
// A cold plan may run a fresh discovery scan plus ~20 deep analyses.
export const maxDuration = 120;

const RISK_OPTIONS = [0.5, 1, 2];
const MAX_POSITION_OPTIONS = [10, 15, 25];

export const GET = withApi(async ({ req, user }) => {
  const q = req.nextUrl.searchParams;
  const risk = Number(q.get("risk"));
  const maxPos = Number(q.get("maxPosition"));
  const plan = await getAutopilotPlan(
    user.id,
    {
      riskPerTradePercent: RISK_OPTIONS.includes(risk) ? risk : 1,
      maxPositionPercent: MAX_POSITION_OPTIONS.includes(maxPos) ? maxPos : 15,
    },
    q.get("refresh") === "1",
  );
  return serialize(plan);
});
