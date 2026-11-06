import { withApi } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { trainNow } from "@/services/learning/learning-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Retrains now (shared if a run is already in progress; returns the last run if it is under 10 minutes old). */
export const POST = withApi(
  async ({ user }) => {
    const run = await trainNow("manual", user.id);
    return { id: run._id.toString(), createdAt: run.createdAt.toISOString(), auc: run.test.metrics.auc };
  },
  { rateLimit: RATE_LIMITS.aiResearch },
);
