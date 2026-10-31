import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, type SessionUser } from "@/lib/auth/session";
import { AppError, ValidationError, isAppError } from "@/lib/errors";
import { enforceRateLimit, type RateLimitRule, RATE_LIMITS } from "@/lib/security/rate-limit";
import { logger } from "@/lib/logger";

/**
 * Wrapper for every protected Route Handler:
 * - verifies the session (independently of the proxy),
 * - checks the Origin header on state-changing requests (CSRF defence in depth),
 * - applies rate limits,
 * - converts errors into a consistent JSON shape without leaking internals.
 */
export interface ApiContext<P> {
  req: NextRequest;
  user: SessionUser;
  params: P;
}

interface Options {
  rateLimit?: RateLimitRule;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) throw new AppError("FORBIDDEN", "Request origin could not be verified.");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError("FORBIDDEN", "Request origin could not be verified.");
  }
  if (originHost !== host) throw new AppError("FORBIDDEN", "Cross-site requests are not allowed.");
}

export function errorResponse(err: unknown): NextResponse {
  if (isAppError(err)) {
    if (err.status >= 500) logger.error("api.error", { code: err.code, error: err, cause: err.cause });
    const headers: Record<string, string> = {};
    const retryAfter = (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
    if (err.code === "RATE_LIMITED" && retryAfter) headers["Retry-After"] = String(retryAfter);
    return NextResponse.json(
      {
        error: {
          code: err.code,
          message: err.publicMessage,
          retryable: err.retryable,
          ...(err.code === "VALIDATION" || err.code === "PRICE_CHANGED" || err.code === "STALE_DATA"
            ? { details: err.details }
            : {}),
        },
      },
      { status: err.status, headers },
    );
  }
  logger.error("api.unhandled_error", { error: err });
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Something went wrong. Please try again.", retryable: true } },
    { status: 500 },
  );
}

export function withApi<P = Record<string, never>>(
  handler: (ctx: ApiContext<P>) => Promise<unknown>,
  options: Options = {},
) {
  return async (req: NextRequest, routeCtx: { params: Promise<P> }) => {
    try {
      const user = await requireApiUser();
      if (MUTATING.has(req.method)) {
        assertSameOrigin(req);
        await enforceRateLimit(options.rateLimit ?? RATE_LIMITS.mutation, user.id);
      } else if (options.rateLimit) {
        await enforceRateLimit(options.rateLimit, user.id);
      }
      const params = (routeCtx?.params ? await routeCtx.params : {}) as P;
      const result = await handler({ req, user, params });
      if (result instanceof Response) return result;
      return NextResponse.json({ data: result ?? null }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function parseJson<T extends z.ZodType>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
  return parseWith(schema, body);
}

export function parseWith<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(
      result.error.issues[0]?.message ?? "Invalid input.",
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}

export function parseSearchParams<T extends z.ZodType>(req: NextRequest, schema: T): z.infer<T> {
  return parseWith(schema, Object.fromEntries(req.nextUrl.searchParams.entries()));
}
