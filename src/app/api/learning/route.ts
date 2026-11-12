import { after } from "next/server";
import { withApi } from "@/lib/api/handler";
import { isDue, isTraining, latestRun, listRuns, selfCalibration, trainNow } from "@/services/learning/learning-service";
import { FEATURES } from "@/services/learning/features";
import { serialize } from "@/types/serialized";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Everything the Learning page shows. Starts a first training run in the background if none exists. */
export const GET = withApi(async ({ user }) => {
  const [run, runs, calibration, due] = await Promise.all([latestRun(), listRuns(30), selfCalibration(user.id), isDue()]);
  if (!run && !isTraining()) after(() => trainNow("auto", user.id).catch(() => null));
  const latest = run ? (({ model, ...rest }) => ({ ...rest, model: { version: model.version }, featureCount: model.features.length }))(run) : null;
  return serialize({
    latest,
    runs,
    calibration,
    due,
    training: isTraining() || !run,
    nextRunAt: run ? new Date(run.createdAt.getTime() + 24 * 60 * 60_000).toISOString() : null,
    features: FEATURES,
  });
});
