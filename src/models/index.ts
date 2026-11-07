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

/** Market conditions captured at a decision or watchlist addition (see services/market/context-snapshot). */
export interface MarketContext {
  capturedAt: Date;
  fearGreed: { value: number; label: string } | null;
  btc: {
    price: number;
    change24hPercent: number | null;
    change7dPercent: number | null;
    aboveSma50: boolean | null;
    aboveSma200: boolean | null;
  } | null;
  coin: {
    price: number;
    change24hPercent: number | null;
    change7dPercent: number | null;
    change30dPercent: number | null;
    rsi14: number | null;
    volumeVsAverage: number | null;
    vsEma50Percent: number | null;
    vsEma200Percent: number | null;
    atrPercent: number | null;
    rangePosition90dPercent: number | null;
    quoteVolume24h: number;
  } | null;
  scorecard: { composite: number; label: string } | null;
  model: { probability: number; trust: number } | null;
  futures: { fundingRatePercent: number | null; longAccountsPercent: number | null } | null;
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
  /** Market conditions when the pair was added. */
  contextAtAdd?: MarketContext | null;
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

export type PredictionHorizon = Exclude<ResearchEvaluation["horizon"], "1h">;

/**
 * A directional call about one pair, made by the chat assistant or by Autopilot. Stored on its
 * own so the track record survives conversation deletion and cannot be cherry-picked.
 */
export interface PredictionDoc {
  _id: ObjectId;
  userId: string;
  /** Missing on documents created before Autopilot existed: those are chat calls. */
  source?: "chat" | "autopilot";
  /** Chat calls only. */
  conversationId: ObjectId | null;
  messageId: ObjectId | null;
  symbol: string;
  provider: string;
  model: string;
  bias: ResearchBias;
  /** The AI's stated probability (50–95) that the call is right at the horizon. */
  confidence: number;
  horizon: PredictionHorizon;
  priceAtPrediction: number;
  dataTimestamp: Date;
  entry: { low: number; high: number } | null;
  target: number | null;
  stop: number | null;
  /** The application's rule-based scorecard value at the time (-100 … +100). */
  compositeScore: number | null;
  timestamp: Date;
  /** When the horizon ends and the call can be scored. */
  dueAt: Date;
  evaluation: (ResearchEvaluation & { levelHit: "target" | "stop" | "none" | null }) | null;
  /**
   * The same call checked at every standard horizon (24h, 7d, 30d), whatever its own horizon,
   * so accuracy can be compared across time frames. Filled in as each horizon comes due.
   */
  checkpoints?: ResearchEvaluation[];
}

/** A trader the user follows: imported from Binance copy trading or tracked by hand. */
export interface TraderDoc {
  _id: ObjectId;
  userId: string;
  source: "binance_copy" | "manual";
  /** Binance lead-portfolio id; null for manual traders. */
  externalId: string | null;
  name: string;
  profileUrl: string | null;
  avatarUrl: string | null;
  /** Manual: entered by the user. Binance: implied from 90-day P&L ÷ ROI unless overridden. */
  startingValue: number | null;
  startingValueSource: "user" | "implied" | null;
  quoteAsset: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
  /** Latest data pulled from Binance (binance_copy only). */
  remote: {
    status: string | null;
    description: string | null;
    tags: string[];
    startedAt: Date | null;
    marginBalance: number | null;
    copiers: number | null;
    roiSeries: Array<{ t: number; roi: number }>;
    performance: Array<{
      range: "7D" | "30D" | "90D";
      roiPercent: number | null;
      pnl: number | null;
      maxDrawdownPercent: number | null;
      winRatePercent: number | null;
      totalOrders: number | null;
    }>;
    coinMix: Array<{ asset: string; sharePercent: number }>;
  } | null;
}

export interface TraderTradeDoc {
  _id: ObjectId;
  userId: string;
  traderId: ObjectId;
  /** Binance position id (dedupes re-syncs); null for manual entries. */
  externalId: string | null;
  symbol: string;
  side: "long" | "short";
  leverage: number | null;
  quantity: number | null;
  entryPrice: number;
  exitPrice: number | null;
  openedAt: Date;
  closedAt: Date | null;
  pnl: number | null;
  status: "open" | "partial" | "closed";
  source: "binance_copy" | "manual" | "csv";
  createdAt: Date;
}

/**
 * One training run of the learning model. Runs are kept forever, so the history of what the
 * model learned, how well it validated, and how its views changed is always visible.
 */
export interface LearningRunDoc {
  _id: ObjectId;
  createdAt: Date;
  trigger: "scheduled" | "manual" | "auto";
  durationMs: number;
  data: { pairs: number; samples: number; from: Date | null; to: Date | null; horizonDays: number; strideDays: number };
  split: { cutoff: Date; trainSamples: number; testSamples: number };
  /** Out-of-sample results: the honest measure of skill. */
  test: {
    metrics: import("@/services/learning/model").Metrics;
    calibration: import("@/services/learning/model").CalibrationBucket[];
    deciles: import("@/services/learning/model").Decile[];
    spreadPercent: number;
  };
  train: { metrics: import("@/services/learning/model").Metrics };
  /** 0 … 1: how much Autopilot relies on the model, derived from the out-of-sample AUC. */
  trust: number;
  model: import("@/services/learning/model").TrainedModel;
  lessons: import("@/services/learning/model").Lesson[];
  changes: import("@/services/learning/model").Change[];
  picks: {
    top: Array<{ symbol: string; probability: number; drivers: Array<{ label: string; contribution: number }> }>;
    bottom: Array<{ symbol: string; probability: number; drivers: Array<{ label: string; contribution: number }> }>;
  };
  /**
   * How the run's live picks actually did, per horizon: top picks are right when they beat
   * BTC, bottom picks when they lag it. Added as each horizon comes due; never rewritten.
   */
  pickEvaluations?: Array<{
    horizon: "24h" | "7d" | "30d";
    evaluatedAt: Date;
    results: Array<{ symbol: string; side: "top" | "bottom"; excessPercent: number; correct: boolean }>;
  }>;
}

/** An AI review of discovery-screen candidates. Stores the exact data the AI was given. */
export interface DiscoveryShortlistDoc {
  _id: ObjectId;
  userId: string;
  provider: string;
  model: string;
  /** Which discovery screen the candidates came from (e.g. "top", "volume"). */
  screen: string;
  symbols: string[];
  candidates: Record<string, unknown>[];
  content: string;
  scanTimestamp: Date;
  scanStale: boolean;
  timestamp: Date;
}

export type DecisionType ="BUY" | "SELL" | "HOLD" | "WATCH" | "SKIP";
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
  /** Market conditions at the moment of the decision. */
  marketContext?: MarketContext | null;
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
