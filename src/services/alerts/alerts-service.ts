import "server-only";
import { ObjectId } from "mongodb";
import { getCollections } from "@/lib/mongodb/collections";
import { AppError, NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { marketData } from "@/services/binance";
import { getActivePortfolio } from "@/services/portfolio/portfolio-service";
import { getUserSettings } from "@/services/settings/settings-service";
import { formatPrice } from "@/lib/utils/format";
import type { AlertDoc, AlertType, NotificationDoc } from "@/models";
import { describeAlert, isTriggered } from "./rules";

/**
 * Delivery channels. In-app notifications are stored in MongoDB. Additional channels
 * (e.g. Telegram) can implement this interface and be added to NOTIFIERS without touching
 * the evaluation logic.
 */
export interface Notifier {
  channel: string;
  send(n: NotificationDoc): Promise<void>;
}

const inAppNotifier: Notifier = {
  channel: "in_app",
  async send(n) {
    const { notifications } = await getCollections();
    await notifications.insertOne(n);
  },
};

const NOTIFIERS: Notifier[] = [inAppNotifier];

export async function createAlert(
  userId: string,
  input: { symbol: string; type: AlertType; threshold: number; note?: string },
) {
  const md = marketData();
  const info = (await md.symbolInfo(input.symbol)).data;
  if (!info) throw new ValidationError(`${input.symbol} is not listed on Binance Spot.`);

  let referencePrice: number | null = null;
  if (input.type === "CHANGE_UP_PERCENT" || input.type === "CHANGE_DOWN_PERCENT") {
    const t = await md.ticker(input.symbol);
    if (!t.data || t.stale) {
      throw new AppError("STALE_DATA", "A live price is needed as the reference for a percentage alert. Try again shortly.");
    }
    referencePrice = t.data.price;
    if (input.threshold > 100 && input.type === "CHANGE_DOWN_PERCENT") throw new ValidationError("A drop cannot exceed 100%.");
  }
  if (input.type === "POSITION_PROFIT_PERCENT" || input.type === "POSITION_LOSS_PERCENT") {
    const portfolio = await getActivePortfolio(userId);
    const { holdings } = await getCollections();
    const h = await holdings.findOne({ portfolioId: portfolio._id, symbol: input.symbol, quantity: { $gt: 0 } });
    if (!h) throw new ValidationError(`You have no open simulated ${input.symbol} position.`);
  }

  const { alerts } = await getCollections();
  const doc: AlertDoc = {
    _id: new ObjectId(),
    userId,
    symbol: input.symbol,
    type: input.type,
    threshold: input.threshold,
    referencePrice,
    status: "active",
    note: input.note,
    createdAt: new Date(),
    triggeredAt: null,
    triggerPrice: null,
  };
  await alerts.insertOne(doc);
  return doc;
}

export async function listAlerts(userId: string, opts: { symbol?: string } = {}) {
  const { alerts } = await getCollections();
  return alerts
    .find({ userId, ...(opts.symbol ? { symbol: opts.symbol } : {}) })
    .sort({ status: 1, createdAt: -1 })
    .limit(300)
    .toArray();
}

export async function deleteAlert(userId: string, id: string) {
  const { alerts } = await getCollections();
  const res = await alerts.deleteOne({ _id: new ObjectId(id), userId });
  if (!res.deletedCount) throw new NotFoundError("Alert not found.");
}

/**
 * Evaluates active alerts against cached Binance prices. Throttled per user to the configured
 * polling interval, so many open tabs don't multiply Binance requests. Alerts are never
 * triggered from stale data.
 */
export async function evaluateAlerts(userId: string, opts: { force?: boolean } = {}): Promise<{ triggered: number; skipped?: string }> {
  const { alerts, jobState, holdings } = await getCollections();
  const settings = await getUserSettings(userId);
  const jobId = `alerts:${userId}`;
  const now = new Date();

  if (!opts.force) {
    const cutoff = new Date(now.getTime() - (settings.alertPollIntervalSeconds - 2) * 1000);
    const claimed = await jobState.findOneAndUpdate(
      { _id: jobId, lastRunAt: { $lt: cutoff } },
      { $set: { lastRunAt: now, lastStatus: "ok" } },
    );
    if (!claimed) {
      const exists = await jobState.findOne({ _id: jobId });
      if (exists) return { triggered: 0, skipped: "throttled" };
      await jobState.updateOne({ _id: jobId }, { $setOnInsert: { lastRunAt: now, lastStatus: "ok" } }, { upsert: true });
    }
  }

  const active = await alerts.find({ userId, status: "active" }).toArray();
  if (!active.length) return { triggered: 0 };

  const res = await marketData().prices([...new Set(active.map((a) => a.symbol))]);
  if (res.stale) return { triggered: 0, skipped: "stale_data" };

  const needsPosition = active.some((a) => a.type.startsWith("POSITION_"));
  const positions = new Map<string, { averageCost: number; quantity: number }>();
  if (needsPosition) {
    const portfolio = await getActivePortfolio(userId);
    for (const h of await holdings.find({ portfolioId: portfolio._id, quantity: { $gt: 0 } }).toArray()) {
      positions.set(h.symbol, { averageCost: h.averageCost, quantity: h.quantity });
    }
  }

  let triggered = 0;
  for (const a of active) {
    const price = res.data.get(a.symbol);
    if (price === undefined) continue;
    if (!isTriggered(a, price, positions.get(a.symbol))) continue;
    // Atomic transition so concurrent evaluations notify only once.
    const updated = await alerts.findOneAndUpdate(
      { _id: a._id, status: "active" },
      { $set: { status: "triggered", triggeredAt: now, triggerPrice: price } },
    );
    if (!updated) continue;
    triggered++;
    const n: NotificationDoc = {
      _id: new ObjectId(),
      userId,
      alertId: a._id,
      symbol: a.symbol,
      title: `Alert: ${describeAlert(a.type, a.threshold, a.symbol)}`,
      body: `Price ${formatPrice(price)} at ${now.toISOString().slice(11, 16)} UTC (Binance)${a.note ? ` · ${a.note}` : ""}`,
      createdAt: now,
      readAt: null,
      channels: NOTIFIERS.map((x) => x.channel),
    };
    for (const notifier of NOTIFIERS) {
      await notifier.send(n).catch((err) => logger.warn("alerts.notify_failed", { channel: notifier.channel, error: err }));
    }
  }
  if (triggered) logger.info("alerts.triggered", { count: triggered });
  return { triggered };
}

export async function listNotifications(userId: string) {
  const { notifications } = await getCollections();
  const [items, unread] = await Promise.all([
    notifications.find({ userId }).sort({ createdAt: -1 }).limit(20).toArray(),
    notifications.countDocuments({ userId, readAt: null }),
  ]);
  return { items, unread };
}

export async function markNotificationsRead(userId: string) {
  const { notifications } = await getCollections();
  await notifications.updateMany({ userId, readAt: null }, { $set: { readAt: new Date() } });
}
