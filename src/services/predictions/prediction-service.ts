import "server-only";
import { ObjectId } from "mongodb";
import { getCollections } from "@/lib/mongodb/collections";
import { logger } from "@/lib/logger";
import { marketData } from "@/services/binance";
import { HORIZONS, evaluateOutcome } from "@/services/research/evaluation";
import type { ChatOutlook } from "@/services/ai/orchestration/follow-ups";
import type { PredictionDoc, ResearchEvaluation } from "@/models";
import { levelOutcome, sanitizeLevels, summarizeTrackRecord } from "./scoring";

export interface PricedSymbol {
  price: number;
  compositeScore: number | null;
}

/**
 * Stores the calls from one assistant reply. Only pairs whose live price was in the context are
 * recorded (a call on stale or missing data could not be scored fairly).
 */
export async function recordPredictions(
  userId: string,
  meta: { conversationId: ObjectId; messageId: ObjectId; provider: string; model: string; dataTimestamp: Date },
  outlooks: ChatOutlook[],
  priced: Record<string, PricedSymbol>,
): Promise<PredictionDoc[]> {
  const now = new Date();
  const docs: PredictionDoc[] = [];
  for (const raw of outlooks) {
    const symbol = priced[raw.symbol] ? raw.symbol : priced[`${raw.symbol}USDT`] ? `${raw.symbol}USDT` : null;
    if (!symbol) continue;
    const { price, compositeScore } = priced[symbol]!;
    const o = sanitizeLevels(raw, price);
    docs.push({
      _id: new ObjectId(),
      userId,
      source: "chat",
      conversationId: meta.conversationId,
      messageId: meta.messageId,
      symbol,
      provider: meta.provider,
      model: meta.model,
      bias: o.bias,
      confidence: o.confidence,
      horizon: o.horizon,
      priceAtPrediction: price,
      dataTimestamp: meta.dataTimestamp,
      entry: o.entry ? { low: o.entry[0], high: o.entry[1] } : null,
      target: o.target,
      stop: o.stop,
      compositeScore,
      timestamp: now,
      dueAt: new Date(now.getTime() + HORIZONS[o.horizon].ms),
      evaluation: null,
    });
  }
  if (docs.length) {
    const { predictions } = await getCollections();
    await predictions.insertMany(docs);
    logger.info("predictions.recorded", { count: docs.length, symbols: docs.map((d) => d.symbol) });
  }
  return docs;
}

export async function listConversationPredictions(userId: string, conversationId: ObjectId) {
  const { predictions } = await getCollections();
  return predictions.find({ userId, conversationId }).sort({ timestamp: 1 }).toArray();
}

/** Scores calls whose horizon has ended. Idempotent and bounded to protect Binance rate limits. */
export async function evaluateDuePredictions(userId: string, max = 10): Promise<number> {
  const { predictions } = await getCollections();
  const due = await predictions
    .find({ userId, evaluation: null, dueAt: { $lte: new Date() } })
    .sort({ dueAt: 1 })
    .limit(max)
    .toArray();
  let scored = 0;
  for (const p of due) {
    try {
      const start = p.timestamp.getTime();
      const { interval, ms } = HORIZONS[p.horizon];
      const kl = await marketData().klinesBetween(p.symbol, interval, start, start + ms);
      if (kl.stale) continue;
      const ev = evaluateOutcome(p.bias, p.priceAtPrediction, start, p.horizon, kl.data);
      if (!ev) continue;
      const levelHit = levelOutcome(p.bias, p.target, p.stop, kl.data.filter((k) => k.openTime >= start - 1));
      const res = await predictions.updateOne({ _id: p._id, evaluation: null }, { $set: { evaluation: { ...ev, levelHit } } });
      scored += res.modifiedCount;
    } catch (err) {
      logger.warn("predictions.evaluation_failed", { symbol: p.symbol, horizon: p.horizon, error: err });
    }
  }
  return scored;
}

export const CHECKPOINT_HORIZONS = ["24h", "7d", "30d"] as const;
export type CheckpointHorizon = (typeof CHECKPOINT_HORIZONS)[number];

/**
 * Checks calls at every standard horizon (24h / 7d / 30d) as each one comes due, so accuracy
 * can be shown per time frame. Idempotent and bounded (at most `max` Binance requests).
 */
export async function evaluateCheckpoints(userId: string, max = 12): Promise<number> {
  const { predictions } = await getCollections();
  const now = Date.now();
  const candidates = await predictions
    .find(
      { userId, timestamp: { $lte: new Date(now - HORIZONS["24h"].ms) }, "checkpoints.2": { $exists: false } },
      { projection: { symbol: 1, bias: 1, priceAtPrediction: 1, timestamp: 1, horizon: 1, evaluation: 1, checkpoints: 1 } },
    )
    .sort({ timestamp: 1 })
    .limit(300)
    .toArray();

  let requests = 0;
  let added = 0;
  for (const p of candidates) {
    if (requests >= max) break;
    const have = new Set((p.checkpoints ?? []).map((c) => c.horizon));
    const start = p.timestamp.getTime();
    for (const h of CHECKPOINT_HORIZONS) {
      if (have.has(h) || start + HORIZONS[h].ms > now) continue;
      try {
        let ev: ResearchEvaluation | null = null;
        if (h === p.horizon && p.evaluation) {
          const { levelHit, ...rest } = p.evaluation;
          void levelHit; // checkpoints record the directional outcome only
          ev = rest;
        }
        if (!ev) {
          if (requests >= max) break;
          requests++;
          const kl = await marketData().klinesBetween(p.symbol, HORIZONS[h].interval, start, start + HORIZONS[h].ms);
          if (kl.stale) continue;
          ev = evaluateOutcome(p.bias, p.priceAtPrediction, start, h, kl.data);
        }
        if (!ev) continue;
        const res = await predictions.updateOne({ _id: p._id, "checkpoints.horizon": { $ne: h } }, { $push: { checkpoints: ev } });
        added += res.modifiedCount;
      } catch (err) {
        logger.warn("predictions.checkpoint_failed", { symbol: p.symbol, horizon: h, error: err });
      }
    }
  }
  return added;
}

export interface AutopilotCall {
  symbol: string;
  bias: "bullish" | "bearish";
  confidence: number;
  price: number;
  target: number | null;
  stop: number | null;
  score: number;
}

/**
 * Records Autopilot's actionable calls. At most one pending call per pair, so refreshing the
 * page does not stack duplicate predictions; the next call is recorded once the last is scored.
 */
export async function recordAutopilotCalls(userId: string, calls: AutopilotCall[], dataTimestamp: Date): Promise<number> {
  if (!calls.length) return 0;
  const { predictions } = await getCollections();
  const pending = new Set(
    (
      await predictions
        .find({ userId, source: "autopilot", evaluation: null, symbol: { $in: calls.map((c) => c.symbol) } }, { projection: { symbol: 1 } })
        .toArray()
    ).map((p) => p.symbol),
  );
  const now = new Date();
  const docs: PredictionDoc[] = calls
    .filter((c) => !pending.has(c.symbol))
    .map((c) => {
      const o = sanitizeLevels({ bias: c.bias, entry: null, target: c.target, stop: c.stop }, c.price);
      return {
        _id: new ObjectId(),
        userId,
        source: "autopilot",
        conversationId: null,
        messageId: null,
        symbol: c.symbol,
        provider: "autopilot",
        model: "rules-v1",
        bias: c.bias,
        confidence: Math.round(Math.min(95, Math.max(50, c.confidence))),
        horizon: "7d",
        priceAtPrediction: c.price,
        dataTimestamp,
        entry: null,
        target: o.target,
        stop: o.stop,
        compositeScore: c.score,
        timestamp: now,
        dueAt: new Date(now.getTime() + HORIZONS["7d"].ms),
        evaluation: null,
      };
    });
  if (docs.length) await predictions.insertMany(docs);
  return docs.length;
}

export async function getTrackRecord(userId: string, opts: { symbol?: string; limit?: number; source?: "chat" | "autopilot" } = {}) {
  const { predictions } = await getCollections();
  const sourceFilter = opts.source === "autopilot" ? { source: "autopilot" as const } : opts.source === "chat" ? { source: { $ne: "autopilot" as const } } : {};
  const list = await predictions
    .find({ userId, ...sourceFilter, ...(opts.symbol ? { symbol: opts.symbol } : {}) })
    .sort({ timestamp: -1 })
    .limit(Math.min(opts.limit ?? 200, 500))
    .toArray();
  return { summary: summarizeTrackRecord(list), recent: list.slice(0, 10) };
}
