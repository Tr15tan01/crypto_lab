import "server-only";
import { ObjectId } from "mongodb";
import { getCollections } from "@/lib/mongodb/collections";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { marketData, type MarketTicker } from "@/services/binance";
import { recordMarketSnapshot } from "@/services/market/snapshots";
import type { DecisionJournalDoc, DecisionType, JournalReview, JournalRevision } from "@/models";
import type { JournalFields } from "@/lib/validation/schemas";

async function currentPrice(
  symbol: string,
): Promise<{ price: number | null; fetchedAt: number; stale: boolean; ticker: MarketTicker | null }> {
  try {
    const res = await marketData().ticker(symbol);
    return { price: res.data && !res.stale ? res.data.price : null, fetchedAt: res.fetchedAt, stale: res.stale, ticker: res.data };
  } catch {
    return { price: null, fetchedAt: Date.now(), stale: true, ticker: null };
  }
}

/** Standalone decisions (HOLD / WATCH / SKIP, or a BUY/SELL decided but not simulated). */
export async function createJournalEntry(
  userId: string,
  input: JournalFields & { symbol: string; decisionType: DecisionType },
) {
  const info = (await marketData().symbolInfo(input.symbol).catch(() => null))?.data;
  if (info === null) throw new ValidationError(`${input.symbol} is not listed on Binance Spot.`);
  const p = await currentPrice(input.symbol);
  const { decisionJournal } = await getCollections();
  const doc: DecisionJournalDoc = {
    _id: new ObjectId(),
    userId,
    symbol: input.symbol,
    decisionType: input.decisionType,
    thesis: input.thesis,
    reason: input.reason,
    confidence: input.confidence ?? null,
    targetPrice: input.targetPrice ?? null,
    expectedTimeHorizon: input.expectedTimeHorizon ?? null,
    riskLevel: input.riskLevel ?? null,
    riskAssessment: input.riskAssessment,
    notes: input.notes,
    aiResearchId: input.aiResearchId ? new ObjectId(input.aiResearchId) : null,
    transactionId: null,
    priceAtDecision: p.price,
    outcome: null,
    reviews: [],
    revisions: [],
    timestamp: new Date(),
  };
  await decisionJournal.insertOne(doc);
  if (p.ticker && !p.stale) {
    await recordMarketSnapshot(p.ticker, { fetchedAt: p.fetchedAt, stale: false, reason: "journal" }).catch(() => {});
  }
  return doc;
}

const EDITABLE = [
  "thesis",
  "reason",
  "targetPrice",
  "expectedTimeHorizon",
  "riskLevel",
  "riskAssessment",
  "confidence",
  "notes",
] as const;

/**
 * Edits never silently rewrite history: each change is appended to `revisions` with the
 * previous and new value.
 */
export async function updateJournalEntry(userId: string, id: string, input: Partial<Record<(typeof EDITABLE)[number], unknown>>) {
  const { decisionJournal } = await getCollections();
  const existing = await decisionJournal.findOne({ _id: new ObjectId(id), userId });
  if (!existing) throw new NotFoundError("Journal entry not found.");

  const changes: JournalRevision["changes"] = {};
  const $set: Record<string, unknown> = {};
  for (const key of EDITABLE) {
    if (!(key in input) || input[key] === undefined) continue;
    let next = input[key];
    if (next === "") next = null;
    const prev = existing[key] ?? null;
    if (JSON.stringify(prev) === JSON.stringify(next ?? null)) continue;
    changes[key] = { from: prev, to: next ?? null };
    $set[key] = next ?? null;
  }
  if (Object.keys(changes).length === 0) return existing;
  const revision: JournalRevision = { revisedAt: new Date(), changes };
  const res = await decisionJournal.findOneAndUpdate(
    { _id: existing._id, userId },
    { $set, $push: { revisions: revision } },
    { returnDocument: "after" },
  );
  return res!;
}

/** A manual review of how a decision turned out. Reviews are append-only. */
export async function addJournalReview(userId: string, id: string, input: { verdict: JournalReview["verdict"]; notes?: string }) {
  const { decisionJournal } = await getCollections();
  const existing = await decisionJournal.findOne({ _id: new ObjectId(id), userId });
  if (!existing) throw new NotFoundError("Journal entry not found.");
  const p = await currentPrice(existing.symbol);
  const review: JournalReview = { reviewedAt: new Date(), priceAtReview: p.price, verdict: input.verdict, notes: input.notes };
  const res = await decisionJournal.findOneAndUpdate(
    { _id: existing._id, userId },
    { $push: { reviews: review }, $set: { outcome: input.verdict } },
    { returnDocument: "after" },
  );
  return res!;
}

export interface JournalRow {
  entry: DecisionJournalDoc;
  currentPrice: number | null;
  changeSinceDecision: number | null;
  targetReached: boolean | null;
  transaction: { type: string; quantity: number; price: number; executionStatus: string } | null;
  research: { id: string; bias: string | null; provider: string; model: string; timestamp: Date } | null;
}

export async function listJournal(
  userId: string,
  opts: { symbol?: string; decisionType?: DecisionType; limit?: number } = {},
): Promise<{ rows: JournalRow[]; pricesFetchedAt: string | null; stale: boolean }> {
  const { decisionJournal, transactions, aiResearch } = await getCollections();
  const entries = await decisionJournal
    .find({ userId, ...(opts.symbol ? { symbol: opts.symbol } : {}), ...(opts.decisionType ? { decisionType: opts.decisionType } : {}) })
    .sort({ timestamp: -1 })
    .limit(Math.min(opts.limit ?? 200, 500))
    .toArray();

  const txIds = entries.map((e) => e.transactionId).filter((x): x is ObjectId => Boolean(x));
  const researchIds = entries.map((e) => e.aiResearchId).filter((x): x is ObjectId => Boolean(x));
  const [txs, research] = await Promise.all([
    txIds.length ? transactions.find({ _id: { $in: txIds }, userId }).toArray() : [],
    researchIds.length
      ? aiResearch.find({ _id: { $in: researchIds }, userId }, { projection: { analysis: 0, indicators: 0 } }).toArray()
      : [],
  ]);
  const txMap = new Map(txs.map((t) => [t._id.toString(), t]));
  const resMap = new Map(research.map((r) => [r._id.toString(), r]));

  let prices = new Map<string, number>();
  let fetchedAt: number | null = null;
  let stale = false;
  try {
    const res = await marketData().prices([...new Set(entries.map((e) => e.symbol))]);
    prices = res.data;
    fetchedAt = res.fetchedAt;
    stale = res.stale;
  } catch {
    stale = true;
  }

  const rows: JournalRow[] = entries.map((e) => {
    const price = prices.get(e.symbol) ?? null;
    const tx = e.transactionId ? txMap.get(e.transactionId.toString()) : undefined;
    const r = e.aiResearchId ? resMap.get(e.aiResearchId.toString()) : undefined;
    const change = price !== null && e.priceAtDecision ? ((price - e.priceAtDecision) / e.priceAtDecision) * 100 : null;
    let targetReached: boolean | null = null;
    if (price !== null && e.targetPrice && e.priceAtDecision) {
      targetReached = e.targetPrice >= e.priceAtDecision ? price >= e.targetPrice : price <= e.targetPrice;
    }
    return {
      entry: e,
      currentPrice: price,
      changeSinceDecision: change,
      targetReached,
      transaction: tx ? { type: tx.type, quantity: tx.quantity, price: tx.price, executionStatus: tx.executionStatus } : null,
      research: r ? { id: r._id.toString(), bias: r.bias, provider: r.provider, model: r.model, timestamp: r.timestamp } : null,
    };
  });
  return { rows, pricesFetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null, stale };
}
