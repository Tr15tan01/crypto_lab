import { z } from "zod";
import { withApi, parseJson } from "@/lib/api/handler";
import { getUserSettings, updateUserSettings } from "@/services/settings/settings-service";

export const dynamic = "force-dynamic";

export const GET = withApi(async ({ user }) => getUserSettings(user.id));

export const PATCH = withApi(async ({ req, user }) => {
  const input = await parseJson(req, z.object({ alertPollIntervalSeconds: z.number().int().min(15).max(3600) }));
  return updateUserSettings(user.id, input);
});
