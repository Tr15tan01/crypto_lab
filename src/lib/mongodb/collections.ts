import "server-only";
import type { Collection, Db, Document } from "mongodb";
import { getDb } from "./client";
import { logger } from "@/lib/logger";
import type {
  AIResearchDoc,
  AlertDoc,
  ConversationDoc,
  DecisionJournalDoc,
  HoldingDoc,
  JobStateDoc,
  MarketCacheDoc,
  MarketSnapshotDoc,
  MessageDoc,
  NotificationDoc,
  PortfolioDoc,
  PortfolioSnapshotDoc,
  RateLimitDoc,
  TransactionDoc,
  UserDoc,
  UserSettingsDoc,
  WatchlistDoc,
} from "@/models";

export const COLLECTIONS = {
  users: "users",
  userSettings: "user_settings",
  watchlist: "watchlist",
  portfolios: "portfolios",
  holdings: "holdings",
  transactions: "transactions",
  portfolioSnapshots: "portfolio_snapshots",
  marketSnapshots: "market_snapshots",
  conversations: "conversations",
  messages: "messages",
  aiResearch: "ai_research",
  decisionJournal: "decision_journal",
  alerts: "alerts",
  notifications: "notifications",
  rateLimits: "rate_limits",
  marketCache: "market_cache",
  jobState: "job_state",
} as const;

export interface Collections {
  users: Collection<UserDoc>;
  userSettings: Collection<UserSettingsDoc>;
  watchlist: Collection<WatchlistDoc>;
  portfolios: Collection<PortfolioDoc>;
  holdings: Collection<HoldingDoc>;
  transactions: Collection<TransactionDoc>;
  portfolioSnapshots: Collection<PortfolioSnapshotDoc>;
  marketSnapshots: Collection<MarketSnapshotDoc>;
  conversations: Collection<ConversationDoc>;
  messages: Collection<MessageDoc>;
  aiResearch: Collection<AIResearchDoc>;
  decisionJournal: Collection<DecisionJournalDoc>;
  alerts: Collection<AlertDoc>;
  notifications: Collection<NotificationDoc>;
  rateLimits: Collection<RateLimitDoc>;
  marketCache: Collection<MarketCacheDoc>;
  jobState: Collection<JobStateDoc>;
}

const globalForIndexes = globalThis as unknown as { __cryptoLabIndexes?: Promise<void> };

/** Index definitions. Applied idempotently once per process (and via `npm run db:indexes`). */
export async function ensureIndexes(db: Db): Promise<void> {
  const c = <T extends Document>(name: string) => db.collection<T>(name);
  await Promise.all([
    c(COLLECTIONS.users).createIndex({ email: 1 }, { unique: true }),
    c(COLLECTIONS.userSettings).createIndex({ userId: 1 }, { unique: true }),

    // One active watchlist row per symbol; removed rows are kept for history.
    c(COLLECTIONS.watchlist).createIndex(
      { userId: 1, symbol: 1 },
      { unique: true, partialFilterExpression: { active: true }, name: "uniq_active_symbol" },
    ),
    c(COLLECTIONS.watchlist).createIndex({ userId: 1, active: 1, addedAt: -1 }),

    c(COLLECTIONS.portfolios).createIndex(
      { userId: 1, status: 1 },
      { unique: true, partialFilterExpression: { status: "active" }, name: "uniq_active_portfolio" },
    ),
    c(COLLECTIONS.holdings).createIndex({ portfolioId: 1, symbol: 1 }, { unique: true }),
    c(COLLECTIONS.holdings).createIndex({ userId: 1, quantity: 1 }),

    c(COLLECTIONS.transactions).createIndex({ userId: 1, idempotencyKey: 1 }, { unique: true }),
    c(COLLECTIONS.transactions).createIndex({ portfolioId: 1, timestamp: -1 }),
    c(COLLECTIONS.transactions).createIndex({ userId: 1, symbol: 1, timestamp: -1 }),

    c(COLLECTIONS.portfolioSnapshots).createIndex({ portfolioId: 1, timestamp: -1 }),
    c(COLLECTIONS.marketSnapshots).createIndex({ symbol: 1, timestamp: -1 }),

    c(COLLECTIONS.conversations).createIndex({ userId: 1, updatedAt: -1 }),
    c(COLLECTIONS.messages).createIndex({ conversationId: 1, timestamp: 1 }),

    c(COLLECTIONS.aiResearch).createIndex({ userId: 1, symbol: 1, timestamp: -1 }),
    c(COLLECTIONS.aiResearch).createIndex({ userId: 1, timestamp: -1 }),

    c(COLLECTIONS.decisionJournal).createIndex({ userId: 1, timestamp: -1 }),
    c(COLLECTIONS.decisionJournal).createIndex({ userId: 1, symbol: 1, timestamp: -1 }),

    c(COLLECTIONS.alerts).createIndex({ userId: 1, status: 1 }),
    c(COLLECTIONS.notifications).createIndex({ userId: 1, readAt: 1, createdAt: -1 }),

    c(COLLECTIONS.rateLimits).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
}

export async function getCollections(): Promise<Collections> {
  const db = await getDb();
  if (!globalForIndexes.__cryptoLabIndexes) {
    globalForIndexes.__cryptoLabIndexes = ensureIndexes(db).catch((err) => {
      globalForIndexes.__cryptoLabIndexes = undefined;
      logger.error("mongodb.ensure_indexes_failed", { error: err });
    });
  }
  await globalForIndexes.__cryptoLabIndexes;

  return {
    users: db.collection<UserDoc>(COLLECTIONS.users),
    userSettings: db.collection<UserSettingsDoc>(COLLECTIONS.userSettings),
    watchlist: db.collection<WatchlistDoc>(COLLECTIONS.watchlist),
    portfolios: db.collection<PortfolioDoc>(COLLECTIONS.portfolios),
    holdings: db.collection<HoldingDoc>(COLLECTIONS.holdings),
    transactions: db.collection<TransactionDoc>(COLLECTIONS.transactions),
    portfolioSnapshots: db.collection<PortfolioSnapshotDoc>(COLLECTIONS.portfolioSnapshots),
    marketSnapshots: db.collection<MarketSnapshotDoc>(COLLECTIONS.marketSnapshots),
    conversations: db.collection<ConversationDoc>(COLLECTIONS.conversations),
    messages: db.collection<MessageDoc>(COLLECTIONS.messages),
    aiResearch: db.collection<AIResearchDoc>(COLLECTIONS.aiResearch),
    decisionJournal: db.collection<DecisionJournalDoc>(COLLECTIONS.decisionJournal),
    alerts: db.collection<AlertDoc>(COLLECTIONS.alerts),
    notifications: db.collection<NotificationDoc>(COLLECTIONS.notifications),
    rateLimits: db.collection<RateLimitDoc>(COLLECTIONS.rateLimits),
    marketCache: db.collection<MarketCacheDoc>(COLLECTIONS.marketCache),
    jobState: db.collection<JobStateDoc>(COLLECTIONS.jobState),
  };
}
