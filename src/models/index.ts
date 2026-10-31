import type { ObjectId } from "mongodb";

/**
 * MongoDB document shapes. Every user-owned document carries `userId` so the data model
 * is ready for more than one account later, even though only the administrator exists today.
 *
 * Money and quantities are stored as JavaScript numbers (IEEE-754 doubles) rounded at
 * well-defined points (see src/services/portfolio/accounting.ts). That is precise enough for
 * a paper-trading journal; it is not a ledger for real funds.
 */

export interface UserDoc {
  _id: ObjectId;
  email: string;
  role: "admin";
  createdAt: Date;
  lastLoginAt?: Date;
  lastLoginMethod?: "credentials" | "google";
}

export interface UserSettingsDoc {
  _id: ObjectId;
  userId: string;
  alertPollIntervalSeconds: number;
  defaultChartInterval: string;
  updatedAt: Date;
}

export interface WatchlistDoc {
  _id: ObjectId;
  userId: string;
  symbol: string; // trading pair, e.g. BTCUSDT
  baseAsset: string;
  quoteAsset: string;
  addedAt: Date;
  priceAtAdd: number | null;
  reason?: string;
  notes?: string;
  targetPrice?: number | null;
  personalRanking?: number | null;
  active: boolean;
  removedAt?: Date | null;
  updatedAt: Date;
}

export interface FeeConfiguration {
  enabled: boolean;
  /** Fee as a percentage of trade value, e.g. 0.1 means 0.1 %. */
  ratePercent: number;
}

export interface PortfolioDoc {
  _id: ObjectId;
  userId: string;
  name: string;
  status: "active" | "archived";
  initialBalance: number;
  availableBalance: number;
  quoteAsset: string;
  feeConfiguration: FeeConfiguration;
  realizedPnL: number;
  totalFeesPaid: number;
  tradeCount: number;
  createdAt: Date;
  archivedAt?: Date | null;
  updatedAt: Date;
  /** Incremented on every balance mutation; used for optimistic concurrency. */
  version: number;
}

export interface HoldingDoc {
  _id: ObjectId;
  userId: string;
  portfolioId: ObjectId;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  quantity: number;
  averageCost: number; // quote per unit, fees included
  investedValue: number; // cost basis of the open quantity
  realizedPnL: number;
  openedAt: Date;
  updatedAt: Date;
}

export type ExecutionStatus = "NOT_EXECUTED" | "EXECUTED" | "PARTIALLY_EXECUTED" | "CANCELLED";

export interface ActualExecutionDetails {
  price?: number | null;
  quantity?: number | null;
  fee?: number | null;
  feeAsset?: string | null;
  executedAt?: Date | null;
  orderReference?: string | null;
}

export interface ExecutionRecord {
  status: ExecutionStatus;
  details: ActualExecutionDetails | null;
  recordedAt: Date;
  note?: string;
}

export interface TransactionDoc {
  _id: ObjectId;
  userId: string;
  portfolioId: ObjectId;
  type: "BUY" | "SELL";
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  quantity: number;
  price: number;
  /** quantity × price, before fees. */
  grossAmount: number;
  fee: number;
  feeRatePercent: number;
  /** BUY: total cash spent (gross + fee). SELL: cash received (gross − fee). */
  total: number;
  averageCostBefore: number;
  averageCostAfter: number;
  /** SELL only. */
  realizedPnL?: number;
  costBasisSold?: number;
  balanceAfter: number;
  timestamp: Date;
  priceFetchedAt: Date;
  priceWasStale: boolean;
  idempotencyKey: string;
  journalEntryId?: ObjectId | null;
  marketSnapshotId?: ObjectId | null;
  notes?: string;
  thesis?: string;
  /** Current real-world status (latest entry of executionHistory). */
  executionStatus: ExecutionStatus;
  actualExecutionDetails: ActualExecutionDetails | null;
  /** Append-only record of every change to the real-world status. */
  executionHistory: ExecutionRecord[];
}

export interface PortfolioSnapshotDoc {
  _id: ObjectId;
  userId: string;
  portfolioId: ObjectId;
  timestamp: Date;
  totalValue: number;
  availableBalance: number;
  investedValue: number; // cost basis of open positions
  marketValue: number; // market value of open positions
  realizedPnL: number;
  unrealizedPnL: number;
  holdingsSnapshot: Array<{ symbol: string; quantity: number; price: number; value: number; averageCost: number }>;
  reason: "scheduled" | "trade" | "manual" | "portfolio_created";
  pricesAsOf: Date;
}

export interface MarketSnapshotDoc {
  _id: ObjectId;
  symbol: string;
  price: number;
  volume: number; // base volume 24h
  quoteVolume: number;
  marketData: {
    priceChange: number;
    priceChangePercent: number;
    highPrice: number;
    lowPrice: number;
    openPrice: number;
    weightedAvgPrice: number;
    tradeCount: number;
  };
  source: "live" | "cache";
  dataTimestamp: Date; // when Binance data was fetched
  timestamp: Date; // when the snapshot was stored
  reason: "trade" | "research" | "scheduled" | "journal" | "watchlist";
}

export interface ConversationDoc {
  _id: ObjectId;
  userId: string;
  title: string;
  /** Symbol the conversation was started from, e.g. "Ask AI about BTC". */
  focusSymbol?: string | null;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
}

export interface MessageDoc {
  _id: ObjectId;
  userId: string;
  conversationId: ObjectId;
  role: "user" | "assistant";
  content: string;
  provider?: string;
  model?: string;
  timestamp: Date;
  followUps?: string[];
  /** Summary of which data was shared with the AI provider (not the data itself). */
  relevantContext?: {
    symbols: string[];
    included: string[];
    dataTimestamp: string | null;
  };
  /** Set when an assistant reply replaced an earlier failed or regenerated attempt. */
  regenerated?: boolean;
}

export type ResearchBias = "bullish" | "neutral" | "bearish";

export interface ResearchEvaluation {
  horizon: "1h" | "24h" | "7d" | "30d";
  evaluatedAt: Date;
  startPrice: number;
  endPrice: number;
  returnPercent: number;
  maxUpsidePercent: number;
  maxDownsidePercent: number;
  outcome: "correct" | "incorrect" | "inconclusive" | "not_evaluated";
}

export interface AIResearchDoc {
  _id: ObjectId;
  userId: string;
  symbol: string;
  provider: string;
  model: string;
  analysis: string;
  indicators: Record<string, unknown>;
  marketSnapshotReference: ObjectId | null;
  priceAtAnalysis: number;
  dataTimestamp: Date;
  bias: ResearchBias | null;
  scenarios?: {
    bullish?: { low: number; high: number } | null;
    bearish?: { low: number; high: number } | null;
  } | null;
  evaluations: ResearchEvaluation[];
  timestamp: Date;
}

export type DecisionType = "BUY" | "SELL" | "HOLD" | "WATCH" | "SKIP";
export type TimeHorizon = "intraday" | "days" | "weeks" | "months" | "years";
export type RiskLevel = "low" | "medium" | "high" | "very_high";

export interface JournalReview {
  reviewedAt: Date;
  priceAtReview: number | null;
  verdict: "correct" | "incorrect" | "mixed" | "too_early";
  notes?: string;
}

export interface JournalRevision {
  revisedAt: Date;
  changes: Record<string, { from: unknown; to: unknown }>;
}

export interface DecisionJournalDoc {
  _id: ObjectId;
  userId: string;
  symbol: string;
  decisionType: DecisionType;
  thesis?: string;
  reason?: string;
  confidence?: number | null; // 1-10
  targetPrice?: number | null;
  expectedTimeHorizon?: TimeHorizon | null;
  riskLevel?: RiskLevel | null;
  riskAssessment?: string;
  notes?: string;
  aiResearchId?: ObjectId | null;
  transactionId?: ObjectId | null;
  priceAtDecision: number | null;
  /** Outcome is never written automatically; it is the latest manual review verdict. */
  outcome?: JournalReview["verdict"] | null;
  reviews: JournalReview[];
  revisions: JournalRevision[];
  timestamp: Date;
}

export type AlertType =
  | "PRICE_ABOVE"
  | "PRICE_BELOW"
  | "CHANGE_UP_PERCENT"
  | "CHANGE_DOWN_PERCENT"
  | "POSITION_PROFIT_PERCENT"
  | "POSITION_LOSS_PERCENT";

export interface AlertDoc {
  _id: ObjectId;
  userId: string;
  symbol: string;
  type: AlertType;
  threshold: number;
  /** For percentage alerts: the price the change is measured from. */
  referencePrice: number | null;
  status: "active" | "triggered" | "disabled";
  note?: string;
  createdAt: Date;
  triggeredAt?: Date | null;
  triggerPrice?: number | null;
}

export interface NotificationDoc {
  _id: ObjectId;
  userId: string;
  alertId: ObjectId | null;
  symbol: string;
  title: string;
  body: string;
  createdAt: Date;
  readAt: Date | null;
  channels: string[];
}

export interface RateLimitDoc {
  _id: string; // bucket key
  count: number;
  expiresAt: Date;
}

export interface MarketCacheDoc {
  _id: string; // cache key
  data: unknown;
  fetchedAt: Date;
}

export interface JobStateDoc {
  _id: string; // job name
  lastRunAt: Date;
  lastStatus: "ok" | "error";
  lastError?: string;
}
