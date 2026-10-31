/**
 * Consistent application error types.
 *
 * `publicMessage` is safe to show to the user. Internal details (stack traces, upstream
 * response bodies, configuration values) never leave the server.
 */
export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "STALE_DATA"
  | "PRICE_CHANGED"
  | "INSUFFICIENT_FUNDS"
  | "MARKET_UNAVAILABLE"
  | "AI_UNAVAILABLE"
  | "CONFIG"
  | "DATABASE"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  STALE_DATA: 409,
  PRICE_CHANGED: 409,
  INSUFFICIENT_FUNDS: 422,
  MARKET_UNAVAILABLE: 503,
  AI_UNAVAILABLE: 503,
  CONFIG: 500,
  DATABASE: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly publicMessage: string;
  readonly details?: unknown;
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    publicMessage: string,
    options: { cause?: unknown; details?: unknown; retryable?: boolean; internalMessage?: string } = {},
  ) {
    super(options.internalMessage ?? publicMessage, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.publicMessage = publicMessage;
    this.details = options.details;
    this.retryable = options.retryable ?? false;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super("VALIDATION", message, { details });
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super("NOT_FOUND", message);
  }
}

export class ConfigError extends AppError {
  readonly problems: string[];
  constructor(message: string, problems: string[] = []) {
    super("CONFIG", `${message}. Check the server environment variables.`, {
      internalMessage: `${message}: ${problems.join("; ")}`,
    });
    this.name = "ConfigError";
    this.problems = problems;
  }
}

export class MarketUnavailableError extends AppError {
  constructor(message = "Binance market data is temporarily unavailable.", cause?: unknown) {
    super("MARKET_UNAVAILABLE", message, { cause, retryable: true });
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
