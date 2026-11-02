import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { appEnv, authEnv } from "@/lib/env";
import { getCollections } from "@/lib/mongodb/collections";
import { logger } from "@/lib/logger";
import { evaluateAlerts } from "@/services/alerts/alerts-service";
import { maybeCreateScheduledSnapshot } from "@/services/portfolio/snapshots";
import { evaluateDueResearch } from "@/services/research/research-service";
import { evaluateDuePredictions } from "@/services/predictions/prediction-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = appEnv().CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Scheduled maintenance (Vercel Cron or any external scheduler):
 * portfolio snapshot (if due), alert evaluation, AI prediction evaluation.
 * Protected by CRON_SECRET; disabled when the secret is not set.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
  }
  const { users, jobState } = await getCollections();
  const admin = await users.findOne({ email: authEnv().ADMIN_EMAIL });
  if (!admin) return NextResponse.json({ data: { skipped: "administrator has not signed in yet" } });
  const userId = admin._id.toString();

  const result: Record<string, unknown> = {};
  const run = async (name: string, fn: () => Promise<unknown>) => {
    try {
      result[name] = await fn();
      await jobState.updateOne({ _id: `cron:${name}` }, { $set: { lastRunAt: new Date(), lastStatus: "ok" } }, { upsert: true });
    } catch (err) {
      result[name] = { error: true };
      logger.error("cron.job_failed", { job: name, error: err });
      await jobState.updateOne(
        { _id: `cron:${name}` },
        { $set: { lastRunAt: new Date(), lastStatus: "error", lastError: err instanceof Error ? err.message.slice(0, 200) : "error" } },
        { upsert: true },
      );
    }
  };

  await run("snapshot", () => maybeCreateScheduledSnapshot(userId));
  await run("alerts", () => evaluateAlerts(userId, { force: true }));
  await run("research_evaluation", () => evaluateDueResearch(userId, 20));
  await run("prediction_evaluation", () => evaluateDuePredictions(userId, 20));
  return NextResponse.json({ data: result });
}
