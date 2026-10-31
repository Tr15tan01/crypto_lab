# Security checklist

Status of each control in this codebase. ✅ = implemented, 🔧 = your action at deployment.

## Access

- ✅ No public registration, onboarding, password reset or user profiles exist.
- ✅ Single administrator from environment variables (`ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`); bcrypt cost 12; plaintext never stored.
- ✅ Constant-time email comparison; bcrypt always runs so wrong emails and wrong passwords take the same time.
- ✅ Optional Google sign-in only when `GOOGLE_AUTH_ENABLED=true`, only for the verified `GOOGLE_ALLOWED_EMAIL`; it maps to the same admin account and cannot create users.
- ✅ Login rate limits: 8 attempts / 15 min per IP and 20 / hour for the account, stored in MongoDB (works across serverless instances). If the limiter store is down, sign-in fails closed.
- ✅ Changing `ADMIN_EMAIL` invalidates existing sessions.
- 🔧 Use a long, unique password and a random `AUTH_SECRET` (≥ 32 chars).

## Sessions & requests

- ✅ Auth.js JWT sessions in HTTP-only cookies, `SameSite=Lax`, `Secure` (and `__Secure-` prefix) in production; 7-day lifetime.
- ✅ The proxy only does an optimistic redirect. **Every page, server action and API route verifies the session itself** (`requireUser` / `requireApiUser` in `src/lib/auth/session.ts`, `withApi` in `src/lib/api/handler.ts`).
- ✅ CSRF: Auth.js's own CSRF token for auth endpoints; Server Actions' built-in origin check; all state-changing API routes reject requests whose `Origin` does not match the host.
- ✅ Rate limits on AI chat (30 / 10 min), AI reports (10 / 10 min) and all mutations (120 / min).
- ✅ Open-redirect protection on the login `callbackUrl` (same-site relative paths only).
- ✅ The cron endpoint requires `Authorization: Bearer <CRON_SECRET>` (constant-time check) and is disabled when the secret is unset.

## Input & output

- ✅ All API input validated with Zod (bodies, query strings, route params, ObjectIds, symbols).
- ✅ MongoDB queries use typed filters built from validated values; no user-supplied operators or `$where`.
- ✅ AI Markdown is rendered with `react-markdown` (raw HTML disabled, images dropped, external links `noopener noreferrer`).
- ✅ Errors return a safe public message; stack traces, upstream bodies and config values stay on the server.

## Headers

- ✅ Per-request Content-Security-Policy with a script nonce and `strict-dynamic`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `upgrade-insecure-requests` on HTTPS.
- ✅ `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, restrictive `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`, HSTS. `X-Powered-By` removed.
- ℹ️ `style-src` allows `'unsafe-inline'` because the chart library sets inline style attributes; scripts remain nonce-only.

## Secrets & data

- ✅ Environment variables validated at first use with clear errors; secrets are only read in server-only modules (`import "server-only"`), never in client bundles.
- ✅ The browser never calls AI providers or Binance directly; it only talks to this app's API.
- ✅ Structured logs redact keys that look sensitive (password, secret, token, key, cookie, prompt, content, hash); prompts and API keys are never logged.
- ✅ `.env*` files are git-ignored (only `.env.example` with placeholders is committed).
- ✅ AI context minimisation: portfolio, transactions and journal are only sent when the question is about them; each answer records which sources were shared. OpenAI requests use `store: false`.
- 🔧 Restrict Atlas network access where possible and use a dedicated database user.
- 🔧 Rotate `AUTH_SECRET`, `CRON_SECRET` and API keys if they are ever exposed.

## Financial safety

- ✅ No trading, no custody, no Binance API keys, no account/withdrawal permissions, no seed phrases or private keys — none of these code paths exist.
- ✅ Simulated and real activity are separated; a trade is only marked "executed" when you record it yourself.
- ✅ No leverage, futures, margin, lending, staking or derivatives.
- ✅ AI prompts forbid presenting predictions as facts and inventing data; numeric ranges are labelled hypothetical.

## Integrity

- ✅ Trades use MongoDB transactions with optimistic concurrency on the portfolio document, idempotency keys with a unique index, and server-side re-pricing. The UI only shows success after the database confirms.
- ✅ History is append-only where it matters: execution status history, journal revisions and reviews, AI evaluations, archived portfolios, removed watchlist entries.
