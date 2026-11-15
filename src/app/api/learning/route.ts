import { after } from "next/server";
import { withApi } from "@/lib/api/handler";
import { RETRAIN_EVERY_MS, isDue, isTraining, latestRun, listRuns, selfCalibration, trainNow } from "@/services/learning/learning-service";
import { FEATURES } from "@/services/learning/features";
import { serialize } from "@/types/serialized";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Everything the Learning page shows. Starts a training run in the background when none exists or the last one is due. */
export const GET = withApi(async ({ user }) => {
  const [run, runs, calibration, due] = await Promise.all([latestRun(), listRuns(30), selfCalibration(user.id), isDue()]);
  if ((!run || due) && !isTraining()) after(() => trainNow(run ? "scheduled" : "auto", user.id).catch(() => null));
  const latest = run ? (({ model, ...rest }) => ({ ...rest, model: { version: model.version }, featureCount: model.features.length }))(run) : null;
  return serialize({
    latest,
    runs,
    calibration,
    due,
    training: isTraining() || !run,
    nextRunAt: run ? new Date(run.createdAt.getTime() + RETRAIN_EVERY_MS).toISOString() : null,
    features: FEATURES,
  });
});
