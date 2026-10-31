import { withApi } from "@/lib/api/handler";
import { evaluateAlerts } from "@/services/alerts/alerts-service";

export const dynamic = "force-dynamic";

/** Called by the open app on its polling interval; the server throttles it per user. */
export const POST = withApi(async ({ user }) => {
  try {
    return await evaluateAlerts(user.id);
  } catch {
    // Market data outages are reported by the status pill; alert checks are best effort.
    return { triggered: 0, skipped: "unavailable" };
  }
});
