import "server-only";
import { MongoServerError, ObjectId, type ClientSession, type WithId } from "mongodb";
import { getMongoClient } from "@/lib/mongodb/client";
import { getCollections } from "@/lib/mongodb/collections";
import { AppError, NotFoundError, ValidationError, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { marketData } from "@/services/binance";
import { recordMarketSnapshot } from "@/services/market/snapshots";
import type {
  DecisionJournalDoc,
  ExecutionRecord,
  HoldingDoc,
  PortfolioDoc,
  TransactionDoc,
} from "@/models";
import type { JournalFields } from "@/lib/validation/schemas";
import { EMPTY_POSITION, computeBuy, computeSell, type PositionState } from "./accounting";
import { valuePortfolio, type PortfolioValuation, type PriceQuote } from "./valuation";

export const DEFAULT_PORTFOLIO = {
  initialBalance: 1000,
  quoteAsset: "USDT",
  feeConfiguration: { enabled: true, ratePercent: 0.1 },
};

/** Price may move this much between the dialog quote and execution before re-confirmation. */
export const MAX_PRICE_DRIFT_PERCENT = 1.5;

/* ───────────────────────── Portfolio ───────────────────────── */

export async function getActivePortfolio(userId: string): Promise<WithId<PortfolioDoc>> {
  const { portfolios } = await getCollections();
  const existing = await portfolios.findOne({ userId, status: "active" });
  if (existing) return existing;

  const now = new Date();
  const doc: PortfolioDoc = {
    _id: new ObjectId(),
    userId,
    name: "Paper portfolio",
    status: "active",
    initialBalance: DEFAULT_PORTFOLIO.initialBalance,
    availableBalance: DEFAULT_PORTFOLIO.initialBalance,
    quoteAsset: DEFAULT_PORTFOLIO.quoteAsset,
    feeConfiguration: { ...DEFAULT_PORTFOLIO.feeConfiguration },
    realizedPnL: 0,
    totalFeesPaid: 0,
    tradeCount: 0,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    version: 0,
  };
  try {
    await portfolios.insertOne(doc);
    await recordInitialSnapshot(doc);
    return doc;
  } catch (err) {
    // A concurrent request created it first (unique partial index on the active portfolio).
    if (err instanceof MongoServerError && err.code === 11000) {
      const again = await portfolios.findOne({ userId, status: "active" });
      if (again) return again;
    }
    throw err;
  }
}

async function recordInitialSnapshot(p: PortfolioDoc) {
  const { portfolioSnapshots } = await getCollections();
  await portfolioSnapshots.insertOne({
    _id: new ObjectId(),
    userId: p.userId,
    portfolioId: p._id,
    timestamp: p.createdAt,
    totalValue: p.initialBalance,
    availableBalance: p.initialBalance,
    investedValue: 0,
    marketValue: 0,
    realizedPnL: 0,
    unrealizedPnL: 0,
    holdingsSnapshot: [],
    reason: "portfolio_created",
    pricesAsOf: p.createdAt,
  });
}

/** Archives the active portfolio (history is kept) and starts a new one. */
export async function resetPortfolio(
  userId: string,
  config: { initialBalance: number; quoteAsset: string; feeEnabled: boolean; feeRatePercent: number },
): Promise<WithId<PortfolioDoc>> {
  const { portfolios } = await getCollections();
  const client = await getMongoClient();
  const now = new Date();
  const doc: PortfolioDoc = {
    _id: new ObjectId(),
    userId,
    name: "Paper portfolio",
    status: "active",
    initialBalance: config.initialBalance,
    availableBalance: config.initialBalance,
    quoteAsset: config.quoteAsset,
    feeConfiguration: { enabled: config.feeEnabled, ratePercent: config.feeRatePercent },
    realizedPnL: 0,
    totalFeesPaid: 0,
    tradeCount: 0,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    version: 0,
  };
  await runTransaction(client, async (session) => {
    await portfolios.updateMany(
      { userId, status: "active" },
      { $set: { status: "archived", archivedAt: now, updatedAt: now } },
      { session },
    );
    await portfolios.insertOne(doc, { session });
  });
  await recordInitialSnapshot(doc);
  logger.info("portfolio.reset", { initialBalance: config.initialBalance });
  return doc;
}

export async function updateFeeConfiguration(userId: string, feeEnabled: boolean, feeRatePercent: number) {
  const portfolio = await getActivePortfolio(userId);
  const { portfolios } = await getCollections();
  await portfolios.updateOne(
    { _id: portfolio._id },
    { $set: { feeConfiguration: { enabled: feeEnabled, ratePercent: feeRatePercent }, updatedAt: new Date() } },
  );
}

export function effectiveFeeRate(p: PortfolioDoc): number {
  return p.feeConfiguration.enabled ? p.feeConfiguration.ratePercent : 0;
}

/* ───────────────────────── Transactions helpers ───────────────────────── */

async function runTransaction<T>(
  client: Awaited<ReturnType<typeof getMongoClient>>,
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = client.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(
      async () => {
        result = await fn(session);
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
    );
    return result as T;
  } catch (err) {
    if (err instanceof MongoServerError && (err.code === 20 || /replica set/i.test(err.message))) {
      throw new AppError(
        "CONFIG",
        "The database does not support transactions. Use MongoDB Atlas (or a replica set) so trades are saved atomically.",
        { cause: err },
      );
    }
    throw err;
  } finally {
    await session.endSession();
  }
}

function positionFrom(h: HoldingDoc | null): PositionState {
  if (!h) return { ...EMPTY_POSITION };
  return {
    quantity: h.quantity,
    investedValue: h.investedValue,
    averageCost: h.averageCost,
    realizedPnL: h.realizedPnL,
  };
}

async function findByIdempotencyKey(userId: string, key: string) {
  const { transactions } = await getCollections();
  return transactions.findOne({ userId, idempotencyKey: key });
}

interface QuoteCheck {
  symbol: string;
  expectedPrice?: number;
  acknowledgeStale?: boolean;
  portfolio: PortfolioDoc;
}

/** Fetches a fresh price on the server and enforces the stale-data and price-drift rules. */
async function executionQuote({ symbol, expectedPrice, acknowledgeStale, portfolio }: QuoteCheck) {
  const res = await marketData().ticker(symbol, 5);
  const ticker = res.data;
  if (!ticker) throw new ValidationError(`${symbol} is not listed on Binance Spot.`);

  const info = (await marketData().symbolInfo(symbol)).data;
  if (!info?.tradable) {
    throw new AppError("CONFLICT", `${symbol} is not currently tradable on Binance, so it cannot be simulated.`);
  }
  if (ticker.quoteAsset !== portfolio.quoteAsset) {
    throw new ValidationError(
      `This portfolio holds ${portfolio.quoteAsset}. Choose a ${ticker.baseAsset}${portfolio.quoteAsset} pair instead.`,
    );
  }
  if (res.stale && !acknowledgeStale) {
    throw new AppError(
      "STALE_DATA",
      "Live prices are unavailable. The last known price is shown — confirm explicitly to simulate the trade with it.",
      { details: { price: ticker.price, fetchedAt: new Date(res.fetchedAt).toISOString() } },
    );
  }
  if (expectedPrice !== undefined) {
    const drift = (Math.abs(ticker.price - expectedPrice) / expectedPrice) * 100;
    if (drift > MAX_PRICE_DRIFT_PERCENT) {
      throw new AppError("PRICE_CHANGED", "The price moved since you opened this order. Review the new price.", {
        details: { price: ticker.price, fetchedAt: new Date(res.fetchedAt).toISOString(), driftPercent: drift },
      });
    }
  }
  return { ticker, fetchedAt: res.fetchedAt, stale: res.stale };
}

function journalDoc(
  userId: string,
  symbol: string,
  decisionType: "BUY" | "SELL",
  price: number,
  timestamp: Date,
  transactionId: ObjectId,
  fields: JournalFields | undefined,
): DecisionJournalDoc {
  return {
    _id: new ObjectId(),
    userId,
    symbol,
    decisionType,
    thesis: fields?.thesis,
    reason: fields?.reason,
    confidence: fields?.confidence ?? null,
    targetPrice: fields?.targetPrice ?? null,
    expectedTimeHorizon: fields?.expectedTimeHorizon ?? null,
    riskLevel: fields?.riskLevel ?? null,
    riskAssessment: fields?.riskAssessment,
    notes: fields?.notes,
    aiResearchId: fields?.aiResearchId ? new ObjectId(fields.aiResearchId) : null,
    transactionId,
    priceAtDecision: price,
    outcome: null,
    reviews: [],
    revisions: [],
    timestamp,
  };
}

/* ───────────────────────── Buy / Sell ───────────────────────── */

export interface TradeResult {
  transaction: WithId<TransactionDoc>;
  replayed: boolean;
}

export async function executeBuy(
  userId: string,
  input: {
    symbol: string;
    quoteAmount: number;
    idempotencyKey: string;
    expectedPrice?: number;
    acknowledgeStale?: boolean;
    journal?: JournalFields;
  },
): Promise<TradeResult> {
  const replay = await findByIdempotencyKey(userId, input.idempotencyKey);
  if (replay) return { transaction: replay, replayed: true };

  const portfolio = await getActivePortfolio(userId);
  const { ticker, fetchedAt, stale } = await executionQuote({ ...input, portfolio });
  const feeRate = effectiveFeeRate(portfolio);
  const { portfolios, holdings, transactions, decisionJournal } = await getCollections();
  const client = await getMongoClient();

  try {
    const tx = await runTransaction(client, async (session) => {
      const p = await portfolios.findOne({ _id: portfolio._id, status: "active" }, { session });
      if (!p) throw new AppError("CONFLICT", "The portfolio changed. Reload and try again.");
      const holding = await holdings.findOne({ portfolioId: p._id, symbol: ticker.symbol }, { session });
      const calc = computeBuy(positionFrom(holding), {
        quoteAmount: input.quoteAmount,
        price: ticker.price,
        feeRatePercent: feeRate,
      });
      if (calc.total > p.availableBalance + 1e-9) {
        throw new AppError(
          "INSUFFICIENT_FUNDS",
          `Not enough virtual cash: this order costs ${calc.total.toFixed(2)} ${p.quoteAsset} including fees.`,
        );
      }

      const now = new Date();
      const balanceAfter = Math.max(0, Number((p.availableBalance - calc.total).toFixed(8)));
      const updated = await portfolios.updateOne(
        { _id: p._id, version: p.version },
        {
          $set: { availableBalance: balanceAfter, updatedAt: now },
          $inc: { version: 1, tradeCount: 1, totalFeesPaid: calc.fee },
        },
        { session },
      );
      if (updated.matchedCount !== 1) throw new AppError("CONFLICT", "The portfolio changed. Reload and try again.");

      await holdings.updateOne(
        { portfolioId: p._id, symbol: ticker.symbol },
        {
          $set: {
            quantity: calc.position.quantity,
            averageCost: calc.position.averageCost,
            investedValue: calc.position.investedValue,
            realizedPnL: calc.position.realizedPnL,
            updatedAt: now,
            ...(holding && holding.quantity > 0 ? {} : { openedAt: now }),
          },
          $setOnInsert: {
            userId,
            baseAsset: ticker.baseAsset,
            quoteAsset: ticker.quoteAsset,
          },
        },
        { upsert: true, session },
      );

      const snapshotId = await recordMarketSnapshot(ticker, { fetchedAt, stale, reason: "trade" }, session);
      const txId = new ObjectId();
      const journal = journalDoc(userId, ticker.symbol, "BUY", ticker.price, now, txId, input.journal);
      await decisionJournal.insertOne(journal, { session });

      const doc: TransactionDoc = {
        _id: txId,
        userId,
        portfolioId: p._id,
        type: "BUY",
        symbol: ticker.symbol,
        baseAsset: ticker.baseAsset,
        quoteAsset: ticker.quoteAsset,
        quantity: calc.quantity,
        price: ticker.price,
        grossAmount: calc.grossAmount,
        fee: calc.fee,
        feeRatePercent: feeRate,
        total: calc.total,
        averageCostBefore: calc.averageCostBefore,
        averageCostAfter: calc.position.averageCost,
        balanceAfter,
        timestamp: now,
        priceFetchedAt: new Date(fetchedAt),
        priceWasStale: stale,
        idempotencyKey: input.idempotencyKey,
        journalEntryId: journal._id,
        marketSnapshotId: snapshotId,
        notes: input.journal?.notes,
        thesis: input.journal?.thesis,
        executionStatus: "NOT_EXECUTED",
        actualExecutionDetails: null,
        executionHistory: [{ status: "NOT_EXECUTED", details: null, recordedAt: now }],
      };
      await transactions.insertOne(doc, { session });
      return doc;
    });
    logger.info("portfolio.buy", { symbol: tx.symbol, total: tx.total });
    return { transaction: tx, replayed: false };
  } catch (err) {
    return handleTradeError(err, userId, input.idempotencyKey);
  }
}

export async function executeSell(
  userId: string,
  input: {
    symbol: string;
    quantity?: number;
    sellAll?: boolean;
    idempotencyKey: string;
    expectedPrice?: number;
    acknowledgeStale?: boolean;
    journal?: JournalFields;
  },
): Promise<TradeResult> {
  const replay = await findByIdempotencyKey(userId, input.idempotencyKey);
  if (replay) return { transaction: replay, replayed: true };

  const portfolio = await getActivePortfolio(userId);
  const { ticker, fetchedAt, stale } = await executionQuote({ ...input, portfolio });
  const feeRate = effectiveFeeRate(portfolio);
  const { portfolios, holdings, transactions, decisionJournal } = await getCollections();
  const client = await getMongoClient();

  try {
    const tx = await runTransaction(client, async (session) => {
      const p = await portfolios.findOne({ _id: portfolio._id, status: "active" }, { session });
      if (!p) throw new AppError("CONFLICT", "The portfolio changed. Reload and try again.");
      const holding = await holdings.findOne({ portfolioId: p._id, symbol: ticker.symbol }, { session });
      const calc = computeSell(positionFrom(holding), {
        quantity: input.quantity,
        sellAll: input.sellAll,
        price: ticker.price,
        feeRatePercent: feeRate,
      });

      const now = new Date();
      const balanceAfter = Number((p.availableBalance + calc.total).toFixed(8));
      const updated = await portfolios.updateOne(
        { _id: p._id, version: p.version },
        {
          $set: { availableBalance: balanceAfter, updatedAt: now },
          $inc: { version: 1, tradeCount: 1, totalFeesPaid: calc.fee, realizedPnL: calc.realizedPnL },
        },
        { session },
      );
      if (updated.matchedCount !== 1) throw new AppError("CONFLICT", "The portfolio changed. Reload and try again.");

      await holdings.updateOne(
        { portfolioId: p._id, symbol: ticker.symbol },
        {
          $set: {
            quantity: calc.position.quantity,
            averageCost: calc.position.averageCost,
            investedValue: calc.position.investedValue,
            realizedPnL: calc.position.realizedPnL,
            updatedAt: now,
          },
        },
        { session },
      );

      const snapshotId = await recordMarketSnapshot(ticker, { fetchedAt, stale, reason: "trade" }, session);
      const txId = new ObjectId();
      const journal = journalDoc(userId, ticker.symbol, "SELL", ticker.price, now, txId, input.journal);
      await decisionJournal.insertOne(journal, { session });

      const doc: TransactionDoc = {
        _id: txId,
        userId,
        portfolioId: p._id,
        type: "SELL",
        symbol: ticker.symbol,
        baseAsset: ticker.baseAsset,
        quoteAsset: ticker.quoteAsset,
        quantity: calc.quantity,
        price: ticker.price,
        grossAmount: calc.grossAmount,
        fee: calc.fee,
        feeRatePercent: feeRate,
        total: calc.total,
        averageCostBefore: calc.averageCostBefore,
        averageCostAfter: calc.position.averageCost,
        realizedPnL: calc.realizedPnL,
        costBasisSold: calc.costBasisSold,
        balanceAfter,
        timestamp: now,
        priceFetchedAt: new Date(fetchedAt),
        priceWasStale: stale,
        idempotencyKey: input.idempotencyKey,
        journalEntryId: journal._id,
        marketSnapshotId: snapshotId,
        notes: input.journal?.notes,
        thesis: input.journal?.thesis,
        executionStatus: "NOT_EXECUTED",
        actualExecutionDetails: null,
        executionHistory: [{ status: "NOT_EXECUTED", details: null, recordedAt: now }],
      };
      await transactions.insertOne(doc, { session });
      return doc;
    });
    logger.info("portfolio.sell", { symbol: tx.symbol, realizedPnL: tx.realizedPnL });
    return { transaction: tx, replayed: false };
  } catch (err) {
    return handleTradeError(err, userId, input.idempotencyKey);
  }
}

async function handleTradeError(err: unknown, userId: string, key: string): Promise<TradeResult> {
  // The same idempotency key committed in a concurrent request: return that result.
  if (err instanceof MongoServerError && err.code === 11000) {
    const existing = await findByIdempotencyKey(userId, key);
    if (existing) return { transaction: existing, replayed: true };
  }
  if (isAppError(err)) throw err;
  logger.error("portfolio.trade_failed", { error: err });
  throw new AppError("DATABASE", "The trade could not be saved. Nothing was recorded — please try again.", {
    cause: err,
    retryable: true,
  });
}

/* ───────────────────────── Real-world execution status ───────────────────────── */

export async function updateExecutionStatus(
  userId: string,
  transactionId: string,
  update: {
    status: ExecutionRecord["status"];
    details?: {
      price?: number | null;
      quantity?: number | null;
      fee?: number | null;
      feeAsset?: string | null;
      executedAt?: string | null;
      orderReference?: string | null;
    };
    note?: string;
  },
) {
  const { transactions } = await getCollections();
  const now = new Date();
  const details =
    update.status === "EXECUTED" || update.status === "PARTIALLY_EXECUTED"
      ? {
          price: update.details?.price ?? null,
          quantity: update.details?.quantity ?? null,
          fee: update.details?.fee ?? null,
          feeAsset: update.details?.feeAsset ?? null,
          executedAt: update.details?.executedAt ? new Date(update.details.executedAt) : null,
          orderReference: update.details?.orderReference ?? null,
        }
      : null;
  const record: ExecutionRecord = { status: update.status, details, recordedAt: now, note: update.note };
  const res = await transactions.findOneAndUpdate(
    { _id: new ObjectId(transactionId), userId },
    {
      $set: { executionStatus: update.status, actualExecutionDetails: details },
      $push: { executionHistory: record },
    },
    { returnDocument: "after" },
  );
  if (!res) throw new NotFoundError("Transaction not found.");
  return res;
}

/* ───────────────────────── Reads ───────────────────────── */

export async function listTransactions(
  userId: string,
  opts: { symbol?: string; limit?: number; portfolioId?: ObjectId } = {},
) {
  const { transactions } = await getCollections();
  const portfolioId = opts.portfolioId ?? (await getActivePortfolio(userId))._id;
  return transactions
    .find({ userId, portfolioId, ...(opts.symbol ? { symbol: opts.symbol } : {}) })
    .sort({ timestamp: -1 })
    .limit(Math.min(opts.limit ?? 200, 1000))
    .toArray();
}

/** Live prices for held symbols, falling back to the last stored market snapshot. */
export async function priceQuotesFor(symbols: string[]): Promise<{ quotes: Map<string, PriceQuote>; stale: boolean; fetchedAt: number | null }> {
  const quotes = new Map<string, PriceQuote>();
  if (symbols.length === 0) return { quotes, stale: false, fetchedAt: null };
  let stale = false;
  let fetchedAt: number | null = null;
  try {
    const res = await marketData().prices(symbols);
    stale = res.stale;
    fetchedAt = res.fetchedAt;
    for (const [s, price] of res.data) quotes.set(s, { price, asOf: res.fetchedAt, live: !res.stale });
  } catch {
    stale = true;
  }
  const missing = symbols.filter((s) => !quotes.has(s));
  if (missing.length) {
    const { marketSnapshots } = await getCollections();
    const last = await marketSnapshots
      .aggregate<{ _id: string; price: number; dataTimestamp: Date }>([
        { $match: { symbol: { $in: missing } } },
        { $sort: { timestamp: -1 } },
        { $group: { _id: "$symbol", price: { $first: "$price" }, dataTimestamp: { $first: "$dataTimestamp" } } },
      ])
      .toArray();
    for (const l of last) quotes.set(l._id, { price: l.price, asOf: l.dataTimestamp.getTime(), live: false });
  }
  return { quotes, stale, fetchedAt };
}

export interface PortfolioState {
  portfolio: WithId<PortfolioDoc>;
  valuation: PortfolioValuation;
  pricesStale: boolean;
  pricesFetchedAt: string | null;
}

export async function getPortfolioState(userId: string): Promise<PortfolioState> {
  const portfolio = await getActivePortfolio(userId);
  const { holdings } = await getCollections();
  const open = await holdings.find({ portfolioId: portfolio._id, quantity: { $gt: 0 } }).toArray();
  const { quotes, stale, fetchedAt } = await priceQuotesFor(open.map((h) => h.symbol));
  const valuation = valuePortfolio({
    cash: portfolio.availableBalance,
    initialBalance: portfolio.initialBalance,
    realizedPnL: portfolio.realizedPnL,
    holdings: open.map((h) => ({
      symbol: h.symbol,
      baseAsset: h.baseAsset,
      quantity: h.quantity,
      averageCost: h.averageCost,
      investedValue: h.investedValue,
      realizedPnL: h.realizedPnL,
      openedAt: h.openedAt,
    })),
    prices: quotes,
  });
  return {
    portfolio,
    valuation,
    pricesStale: stale,
    pricesFetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null,
  };
}

export async function getHolding(userId: string, symbol: string) {
  const portfolio = await getActivePortfolio(userId);
  const { holdings } = await getCollections();
  return holdings.findOne({ portfolioId: portfolio._id, symbol });
}
