import "server-only";
import { getCollections } from "@/lib/mongodb/collections";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Fixed-window rate limiter backed by MongoDB, so limits hold across serverless instances.
 * Expired buckets are removed by a TTL index.
 */
export interface RateLimitRule {
  name: string;
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMITS = {
  login: { name: "login", limit: 8, windowSeconds: 15 * 60 },
  loginAccount: { name: "login-account", limit: 20, windowSeconds: 60 * 60 },
  aiChat: { name: "ai-chat", limit: 30, windowSeconds: 10 * 60 },
  aiResearch: { name: "ai-research", limit: 10, windowSeconds: 10 * 60 },
  mutation: { name: "mutation", limit: 120, windowSeconds: 60 },
} satisfies Record<string, RateLimitRule>;

export interface RateLimitResult {
  allowed: boolean;
  /** True when the limiter's store could not be reached. */
  unavailable?: boolean;
  remaining: number;
  resetAt: Date;
}

export async function consumeRateLimit(rule: RateLimitRule, identifier: string): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = new Date(windowStart + windowMs);
  const key = `${rule.name}:${identifier}:${windowStart}`;

  try {
    const { rateLimits } = await getCollections();
    const doc = await rateLimits.findOneAndUpdate(
      { _id: key },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: resetAt } },
      { upsert: true, returnDocument: "after" },
    );
    const count = doc?.count ?? 1;
    return { allowed: count <= rule.limit, remaining: Math.max(0, rule.limit - count), resetAt };
  } catch (err) {
    // Fail closed for login (security), open for everything else (availability).
    logger.warn("rate_limit.store_unavailable", { rule: rule.name, error: err });
    if (rule.name.startsWith("login")) return { allowed: false, remaining: 0, resetAt, unavailable: true };
    return { allowed: true, remaining: rule.limit, resetAt };
  }
}

export async function enforceRateLimit(rule: RateLimitRule, identifier: string): Promise<void> {
  const result = await consumeRateLimit(rule, identifier);
  if (!result.allowed) {
    const seconds = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
    throw new AppError("RATE_LIMITED", `Too many requests. Try again in ${formatWait(seconds)}.`, {
      details: { retryAfterSeconds: seconds },
    });
  }
}

function formatWait(seconds: number) {
  if (seconds < 90) return `${seconds} seconds`;
  return `${Math.ceil(seconds / 60)} minutes`;
}

export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}
