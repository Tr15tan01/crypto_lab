import "server-only";
import { ObjectId } from "mongodb";
import { getCollections } from "@/lib/mongodb/collections";
import { appEnv } from "@/lib/env";

export interface UserSettings {
  alertPollIntervalSeconds: number;
}

export async function getUserSettings(userId: string): Promise<UserSettings> {
  const { userSettings } = await getCollections();
  const doc = await userSettings.findOne({ userId });
  return { alertPollIntervalSeconds: doc?.alertPollIntervalSeconds ?? appEnv().ALERT_POLL_INTERVAL_SECONDS };
}

export async function updateUserSettings(userId: string, input: Partial<UserSettings>) {
  const { userSettings } = await getCollections();
  await userSettings.updateOne(
    { userId },
    {
      $set: { ...input, updatedAt: new Date() },
      $setOnInsert: { _id: new ObjectId(), userId, defaultChartInterval: "1h" },
    },
    { upsert: true },
  );
  return getUserSettings(userId);
}
