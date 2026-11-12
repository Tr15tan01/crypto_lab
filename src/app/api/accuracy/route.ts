import { after } from "next/server";
import { z } from "zod";
import { withApi, parseSearchParams } from "@/lib/api/handler";
import { getCollections } from "@/lib/mongodb/collections";
import { HORIZONS } from "@/services/research/evaluation";
import { accuracyOf, type AccuracyItem } from "@/services/predictions/accuracy";
import { evaluateCheckpoints } from "@/services/predictions/prediction-service";
import { evaluateRunPicks, modelPickItems } from "@/services/learning/learning-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const query = z.object({
  source: z.enum(["autopilot", "chat", "model"]).default("autopilot"),
  horizon: z.enum(["24h", "7d", "30d"]).default("7d"),
});

/**
 * Hit rate over time at one horizon, for Autopilot calls, AI chat calls or the learned model's
 * picks. Answers from what is already scored and fills in newly due checks in the background.
 */
export const GET = withApi(async ({ req, user }) => {
  const { source, horizon } = parseSearchParams(req, query);
  after(async () => {
    if (source === "model") await evaluateRunPicks(2).catch(() => 0);
    else await evaluateCheckpoints(user.id, 12).catch(() => 0);
  });

  let items: AccuracyItem[];
  if (source === "model") {
    items = await modelPickItems(horizon);
  } else {
    const { predictions } = await getCollections();
    const list = await predictions
      .find(
        { userId: user.id, ...(source === "autopilot" ? { source: "autopilot" } : { source: { $ne: "autopilot" } }) },
        { projection: { timestamp: 1, bias: 1, checkpoints: 1 } },
      )
      .sort({ timestamp: -1 })
      .limit(2000)
      .toArray();
    items = list.map((p) => {
      const c = p.checkpoints?.find((x) => x.horizon === horizon);
      const outcome = !c ? null : c.outcome === "not_evaluated" ? "inconclusive" : c.outcome;
      const signed = !c ? null : p.bias === "bullish" ? c.returnPercent : p.bias === "bearish" ? -c.returnPercent : null;
      return { t: p.timestamp.getTime(), outcome, resultPercent: signed };
    });
  }
  return {
    source,
    horizon,
    accuracy: accuracyOf(items),
    rule:
      source === "model"
        ? `A top pick is right if it did better over ${horizon} than the average of that run's bottom picks; a bottom pick is right if it did worse than the average of the top picks. (Runs of the earlier model design were scored against BTC.)`
        : `A directional call is right if price moved at least ${HORIZONS[horizon].thresholdPercent}% its way after ${horizon} (close to close); smaller moves are inconclusive. Neutral calls are right if the move stayed within that band.`,
  };
});
