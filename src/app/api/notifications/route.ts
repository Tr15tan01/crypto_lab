import { z } from "zod";
import { withApi, parseJson } from "@/lib/api/handler";
import { listNotifications, markNotificationsRead } from "@/services/alerts/alerts-service";
import { getUserSettings } from "@/services/settings/settings-service";
import { serialize } from "@/types/serialized";

export const dynamic = "force-dynamic";

export const GET = withApi(async ({ user }) => {
  const [{ items, unread }, settings] = await Promise.all([listNotifications(user.id), getUserSettings(user.id)]);
  return {
    unread,
    pollIntervalSeconds: settings.alertPollIntervalSeconds,
    items: serialize(items).map((n) => ({
      id: n._id,
      title: n.title,
      body: n.body,
      symbol: n.symbol,
      createdAt: n.createdAt,
      readAt: n.readAt,
    })),
  };
});

export const POST = withApi(async ({ req, user }) => {
  await parseJson(req, z.object({ action: z.literal("mark_all_read") }));
  await markNotificationsRead(user.id);
  return { ok: true };
});
