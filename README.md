# Crypto Lab — Personal Crypto Intelligence & Paper Trading

A private, single-user research lab for Binance Spot cryptocurrencies:

- **Market Scanner** — every tradable Binance Spot pair, searchable, filterable and sortable.
- **Coin pages** (`/crypto/BTCUSDT`) — live price, candlestick/line charts (1m → 1w, 24h → all history), EMA/Bollinger overlays, deterministic indicators, listing status, alerts, notes.
- **Watchlist** — reasons, notes, target prices, personal ranking, performance since added; removed entries are kept.
- **Paper portfolio** — theoretical USDT (default $1,000), simulated buys/sells with fees, average-cost accounting, holdings, snapshots and seven portfolio charts.
- **Decision journal** — thesis, reason, target, horizon, risk, confidence, linked AI report; append-only reviews and revision history.
- **Real vs simulated** — mark any simulated trade as executed / partially executed / cancelled on Binance and record the real price, quantity, fee and order reference. Nothing is imported automatically.
- **AI Research** — streaming chat (OpenAI or Gemini, switched by `.env`) grounded in Binance data and your own records; structured 13-section analysis reports whose stated lean is evaluated at 1h / 24h / 7d / 30d.
- **Analytics** — win rate, average return, holding periods, "sold too early", "bought near local highs", drawdown, monthly returns, BTC/ETH benchmarks, AI track record.
- **Alerts** — price, % move, and position profit/loss alerts with in-app notifications.

> **This application never trades.** It does not hold funds, request Binance API keys, trading or withdrawal permissions, seed phrases or private keys. All trades are simulated. Nothing here is financial advice.

---

## Tech stack

Next.js 16 (App Router, Route Handlers, Server Components) · TypeScript (strict) · Tailwind CSS 4 · Radix UI · Recharts · Lucide · Motion (the successor package of Framer Motion) · MongoDB Atlas (official driver) · Auth.js v5 · Zod · Vitest.

## Quick start on Windows

Requirements: **Node.js 20.9+ (22 LTS recommended)** and a free **MongoDB Atlas** cluster (see below). No Docker, no Python.

```powershell
# 1. Install dependencies
npm install

# 2. Create your local environment file
copy .env.example .env.local

# 3. Generate the password hash for your admin account (hidden prompt)
npm run hash-password
#    → paste the printed "ADMIN_PASSWORD_HASH=..." line (with \$ escapes) into .env.local

# 4. Generate AUTH_SECRET
npx auth secret
#    → or any 32+ character random string in AUTH_SECRET=

# 5. Fill in MONGODB_URI, ADMIN_EMAIL, AI_PROVIDER and the AI key/model in .env.local

# 6. Test the database connection, then create indexes
npm run db:check
npm run db:indexes

# 7. Run
npm run dev
```

Open http://localhost:3000 and sign in with `ADMIN_EMAIL` and the password you hashed.

The same commands work in macOS/Linux shells (`cp` instead of `copy`).

### Why the `\$` escapes?

Next.js expands `$VARIABLES` inside `.env*` files. A bcrypt hash looks like `$2b$12$…`, so each `$` must be written as `\$` in `.env.local`. `npm run hash-password` prints both forms: the escaped line for `.env.local` and the raw value for the Vercel dashboard (which does **not** need escaping). If the hash is mangled, the app reports a clear configuration error instead of silently failing.

## MongoDB Atlas setup

1. Create a free account at https://www.mongodb.com/cloud/atlas and create an **M0 (free)** cluster. Pick a region close to your Vercel region (this repo deploys to Frankfurt, `fra1`, so `eu-central-1` / Frankfurt is a good match).
2. **Database Access** → add a database user with a strong password and the *Read and write to any database* role (or scope it to the `crypto_lab` database).
3. **Network Access** → for local development add your IP. For Vercel (dynamic IPs) add `0.0.0.0/0`; access is still protected by the user credentials.
4. **Connect → Drivers** → copy the `mongodb+srv://…` connection string into `MONGODB_URI` and set the password. `MONGODB_DB` defaults to `crypto_lab`.
5. Run `npm run db:check` — it tests the string step by step (format, DNS, network access, login, transactions) and tells you how to fix the first failure. Then run `npm run db:indexes`.

Atlas is required (or any replica set): trades are written in **MongoDB multi-document transactions** so a balance, holding, transaction, journal entry and market snapshot are saved together or not at all. A standalone local `mongod` does not support transactions and the app will say so.

### Collections

`users`, `user_settings`, `watchlist`, `portfolios`, `holdings`, `transactions`, `portfolio_snapshots`, `market_snapshots`, `conversations`, `messages`, `ai_research`, `decision_journal`, `alerts`, `notifications`, `rate_limits` (TTL), `market_cache`, `job_state`. Schemas are in `src/models/index.ts`; indexes in `src/lib/mongodb/collections.ts`.

## Authentication

- **No registration.** The only account is `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` (bcrypt, cost 12). The plaintext password is never stored anywhere.
- **Google sign-in (optional):** set `GOOGLE_AUTH_ENABLED=true`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_ALLOWED_EMAIL`. Only that verified Google address can sign in, and it maps to the same administrator. In Google Cloud Console create an OAuth client (Web) with the redirect URI `https://<your-domain>/api/auth/callback/google` (and `http://localhost:3000/api/auth/callback/google` for local use).
- Change the password: run `npm run hash-password` again and replace `ADMIN_PASSWORD_HASH`. Changing `ADMIN_EMAIL` invalidates existing sessions.

## AI provider configuration

```env
AI_PROVIDER=gemini          # or openai
GEMINI_API_KEY=...
GEMINI_MODEL=...            # a model id from https://ai.google.dev/gemini-api/docs/models
OPENAI_API_KEY=...
OPENAI_MODEL=...            # a model id from https://platform.openai.com/docs/models
AI_TEMPERATURE=0.3          # leave empty to use the model default
AI_MAX_OUTPUT_TOKENS=3000   # 4000–6000 recommended for full analysis reports
AI_TIMEOUT_MS=90000
```

- Changing `AI_PROVIDER` or the model variable switches provider/model on the next request — no code change. Model ids are never hard-coded.
- If the selected provider is missing its key or model, the app shows exactly which variables are missing (Settings and AI Research pages).
- The app **never falls back to another provider silently**. Provider errors (rate limit, timeout, bad key, unknown model) are shown with a Retry button; your question stays saved.
- OpenAI is called through the Responses API with `store: false`. Some OpenAI reasoning models reject `temperature`; the provider then retries once without it and logs a warning.
- Only the data relevant to a question is sent: market data for the coins mentioned, and your portfolio/journal only when the question is about them. Each answer shows which sources were shared. API keys and prompts are never logged.
- Provider code lives in `src/services/ai/providers/`. To add a provider, implement `AIProvider` (`types.ts`), add its env vars to `src/lib/env.ts` and register it in `factory.ts`.

## Market data (Binance)

- Public endpoints only, no API key: `/api/v3/exchangeInfo`, `/api/v3/ticker/24hr`, `/api/v3/klines`.
- Default base URL is **`https://data-api.binance.vision`** — Binance's public market-data mirror. `api.binance.com` returns HTTP 451 for requests from some regions (including US-hosted servers); set `BINANCE_API_BASE` if you prefer another endpoint.
- Responses are validated with Zod; a malformed or missing value is skipped, never treated as zero.
- An in-memory cache (shared ticker list, 20 s by default) plus a MongoDB copy of the last good data. If Binance fails, the last data is shown and clearly marked **stale** with its timestamp.
- Retries with exponential backoff on network/5xx errors. HTTP 429/418 and `Retry-After` pause all Binance requests; the `X-MBX-USED-WEIGHT-1M` header is watched to back off before the limit.
- A simulated trade on stale data is refused unless you explicitly confirm it; the transaction is flagged `priceWasStale`.
- "First Binance data" is the earliest daily candle Binance serves for a pair. It is **not** the project launch date, token creation date or listing announcement date, and the UI/AI say so.

## Paper-trading accounting

Average cost basis, documented in `src/services/portfolio/accounting.ts`:

- **Buy:** fee = amount × fee rate; total cost = amount + fee (deducted from cash); quantity = amount ÷ price; the fee is included in the cost basis.
- **Sell:** proceeds = quantity × price − fee; cost basis sold = average cost × quantity; realized P/L = proceeds − cost basis sold. Average cost of the remainder is unchanged. Partial sales and repeated buys are supported.
- The server re-prices every order; if the price moved more than 1.5% since the dialog opened, you are asked to confirm the new price.
- Every order carries an idempotency key (unique index), so double-clicks or retries never create duplicates.
- History is immutable: real-world execution status changes are appended to `executionHistory`; journal edits are stored as revisions; resetting the portfolio archives the old one.
- Portfolio charts use stored **snapshots** only (after each trade and on a schedule), never re-pricing the past with today's prices. A snapshot is skipped, not faked, when live prices are unavailable.

## Background work

`/api/cron/tick` (protected by `CRON_SECRET`) takes a scheduled portfolio snapshot if due, evaluates alerts and fills in due AI-report evaluations. While the app is open it also checks alerts on your configured polling interval and snapshots when you open the dashboard, so the Vercel Hobby plan's once-a-day cron is enough to get started.

- `vercel.json` schedules the cron **daily** (Hobby-compatible). On Vercel Pro change the schedule to hourly: `"0 * * * *"`.
- Any external scheduler can call `GET /api/cron/tick` with `Authorization: Bearer <CRON_SECRET>`.
- Telegram or e-mail notifications can be added by implementing the `Notifier` interface in `src/services/alerts/alerts-service.ts`.

## Deploying to Vercel

1. Push the repository to GitHub (`.env.local` is git-ignored — never commit it).
2. In Vercel: **Add New → Project**, import the repo. Framework preset: Next.js. No build settings needed.
3. **Settings → Environment Variables**: add every variable from `.env.example` with real values. Paste `ADMIN_PASSWORD_HASH` **without** the `\` escapes. Generate a long random `CRON_SECRET`.
4. Deploy. Functions run in `fra1` (see `vercel.json`); change the region if you are elsewhere, ideally next to your Atlas cluster.
5. If you enabled Google sign-in, add the production callback URL to the Google OAuth client.
6. Sign in at your deployment URL and check **Settings** for AI, cron and market-data status.

## Testing

```bash
npm run typecheck          # TypeScript (strict)
npm run lint               # ESLint (Next.js config)
npm test                   # unit tests (accounting, valuation, indicators, Binance client/cache,
                           # AI intent detection & parsing, analytics, alerts, prediction evaluation)
npm run check              # all three
```

Integration tests run the paper-trading engine and API routes against a real MongoDB (Binance is stubbed). They need a database that supports transactions, e.g. your Atlas cluster; a temporary database is created and dropped:

```powershell
$env:TEST_MONGODB_URI="mongodb+srv://..."; npm run test:integration     # PowerShell
```
```bash
TEST_MONGODB_URI="mongodb+srv://..." npm run test:integration          # bash
```

Without `TEST_MONGODB_URI` the integration suite is skipped.

## Project structure

```
src/
  app/
    (auth)/login/            sign-in page + server actions
    (dashboard)/             dashboard, market, crypto/[symbol], watchlist, portfolio,
                             research (+ reports), journal, analytics, settings
    api/                     route handlers (auth, market, portfolio, watchlist, ai,
                             research, journal, alerts, notifications, analytics, cron)
  components/                ui, layout, charts, market, portfolio, watchlist, research,
                             chat, journal, alerts, settings
  hooks/                     client data hook
  lib/                       env validation, auth (DAL), mongodb, security (rate limits),
                             api wrapper, validation schemas, errors, logger, utils
  models/                    MongoDB document types
  services/
    binance/                 HTTP client, cache, market-data service, schemas
    market/                  overview, symbol overview, snapshots, asset names
    indicators/              RSI, MACD, EMA/SMA, Bollinger, ATR, volatility, levels
    portfolio/               accounting, valuation, trading service, snapshots
    watchlist/ journal/ alerts/ analytics/ research/ settings/
    ai/                      providers/, context/, orchestration/
  proxy.ts                   optimistic auth redirect + per-request CSP nonce
tests/unit, tests/integration
scripts/                     hash-password, ensure-indexes
```

Business logic lives in `src/services`; route handlers and components only validate input, call services and render.

See also: [SECURITY.md](SECURITY.md) (security checklist) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Known limitations

- Coin names come from a static list of ~85 well-known assets (Binance's public API has no names); others show their ticker.
- The AI has no news feed. It says so instead of inventing events; "relevant market events" sections only use verified data supplied by the app (currently none).
- Benchmarks and timing analytics use up to one year of daily candles.
- Charts with more than 400 candles are shown as a line (candlesticks would be unreadably thin).
