import { after } from "next/server";
import { withApi } from "@/lib/api/handler";
import { evaluateDuePredictions, getTrackRecord } from "@/services/predictions/prediction-service";
import { serialize } from "@/types/serialized";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The chat assistant's prediction track record. Scores any calls that came due (bounded, idempotent). */
export const GET = withApi(async ({ user }) => {
  const scored = await evaluateDuePredictions(user.id, 3).catch(() => 0);
  if (scored === 3) after(() => evaluateDuePredictions(user.id, 10).catch(() => 0));
  return serialize(await getTrackRecord(user.id));
});
