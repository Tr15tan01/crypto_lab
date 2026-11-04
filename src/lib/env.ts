import "server-only";
import { z } from "zod";
import { ConfigError } from "@/lib/errors";

/**
 * Server-side environment validation.
 *
 * Each concern is validated lazily on first use so that, for example, a missing AI key
 * does not stop the market scanner from working. Values are never logged.
 */

const boolFromString = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

const coreSchema = z.object({
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_DB: z.string().min(1).default("crypto_lab"),
});

const authSchema = z
  .object({
    AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters (use `npx auth secret`)"),
    ADMIN_EMAIL: z.email("ADMIN_EMAIL must be a valid email").transform((v) => v.toLowerCase()),
    ADMIN_PASSWORD_HASH: z.string().min(1, "ADMIN_PASSWORD_HASH is required (run `npm run hash-password`)"),
    GOOGLE_AUTH_ENABLED: boolFromString,
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    GOOGLE_ALLOWED_EMAIL: optionalString,
  })
  .superRefine((env, ctx) => {
    if (!BCRYPT_HASH.test(env.ADMIN_PASSWORD_HASH)) {
      ctx.addIssue({
        code: "custom",
        path: ["ADMIN_PASSWORD_HASH"],
        message:
          "ADMIN_PASSWORD_HASH is not a valid bcrypt hash. If it is in .env.local, every `$` must be escaped as `\\$` " +
          "(the hash-password script prints the escaped form).",
      });
    }
    if (env.GOOGLE_AUTH_ENABLED) {
      for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_ALLOWED_EMAIL"] as const) {
        if (!env[key]) {
          ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when GOOGLE_AUTH_ENABLED=true` });
        }
      }
    }
  });

const appSchema = z.object({
  BINANCE_API_BASE: z.url().default("https://data-api.binance.vision"),
  BINANCE_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(8000),
  /** USD-M futures public data (funding, open interest, long/short ratios). Optional signal layer. */
  BINANCE_FUTURES_API_BASE: z.url().default("https://fapi.binance.com"),
  /** binance.com web endpoints behind the copy-trading pages (unofficial, best effort). */
  BINANCE_WEB_BASE: z.url().default("https://www.binance.com"),
  /** Fear & Greed index (alternative.me). Set to "off" to disable. */
  FEAR_GREED_URL: z.string().default("https://api.alternative.me/fng/?limit=8"),
  MARKET_TICKER_TTL_SECONDS: z.coerce.number().int().min(5).max(600).default(20),
  ALERT_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(3600).default(60),
  SNAPSHOT_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  CRON_SECRET: optionalString,
});

const aiSchema = z.object({
  AI_PROVIDER: z.enum(["openai", "gemini"], {
    error: "AI_PROVIDER must be either 'openai' or 'gemini'",
  }),
  OPENAI_API_KEY: optionalString,
  OPENAI_MODEL: optionalString,
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: optionalString,
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).optional(),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(65536).default(3000),
  AI_TIMEOUT_MS: z.coerce.number().int().min(5000).max(300000).default(90000),
});

export type CoreEnv = z.infer<typeof coreSchema>;
export type AuthEnv = z.infer<typeof authSchema>;
export type AppEnv = z.infer<typeof appSchema>;
export type AIEnv = z.infer<typeof aiSchema>;

function parse<T extends z.ZodType>(schema: T, scope: string): z.infer<T> {
  const raw = Object.fromEntries(
    Object.entries(process.env).map(([k, v]) => [k, v === "" ? undefined : v]),
  );
  const result = schema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join(".") || scope}: ${i.message}`);
    throw new ConfigError(`Invalid ${scope} configuration`, details);
  }
  return result.data;
}

let core: CoreEnv | undefined;
let auth: AuthEnv | undefined;
let app: AppEnv | undefined;

export function coreEnv(): CoreEnv {
  return (core ??= parse(coreSchema, "database"));
}

export function authEnv(): AuthEnv {
  return (auth ??= parse(authSchema, "authentication"));
}

export function appEnv(): AppEnv {
  return (app ??= parse(appSchema, "application"));
}

/** AI config is re-read on each call so a changed provider is reported, never silently cached. */
export function aiEnv(): AIEnv {
  const env = parse(aiSchema, "AI provider");
  // AI_TEMPERATURE is optional: empty means "use the provider/model default".
  return env;
}
