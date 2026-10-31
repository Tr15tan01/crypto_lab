# Architecture notes

## Request flow

```
Browser ──► proxy.ts (cookie check + CSP nonce)
        ──► Server Component page ──► requireUser() ──► services/* ──► MongoDB / Binance / AI
        ──► Route Handler (withApi: session, origin, rate limit, Zod) ──► services/*
```

Pages render server-side with `force-dynamic` (all data is personal and time-sensitive). Cache Components are disabled deliberately; caching happens in the market-data service where freshness is explicit.

## Market data

`services/binance/http.ts` (timeouts, retries, rate-limit pauses) → `cache.ts` (memory + MongoDB last-good copy, stale-on-failure, in-flight de-duplication) → `market-data.ts` (exchange info, tickers, klines with backwards pagination, first candle). Every result carries `fetchedAt` and `stale`, which the UI shows next to the data.

## Paper trading

`accounting.ts` is pure and unit-tested. `portfolio-service.ts` runs each trade in a MongoDB transaction:

1. Replay check by idempotency key.
2. Server-side price fetch; stale-data and price-drift rules.
3. Transaction: read portfolio + holding → compute → conditional update of the portfolio (`version` match) → upsert holding → insert market snapshot, journal entry, transaction.
4. After the response, a portfolio snapshot is stored (`after()`).

## AI

```
chat-service.streamReply
  ├─ persist user message
  ├─ context-builder (detect intent → only relevant data → JSON context + summary)
  ├─ AIProvider.stream (OpenAI Responses API / Gemini generateContentStream)
  ├─ NDJSON events to the browser: meta, delta…, done | error
  └─ persist assistant message (+ provider, model, context summary, follow-ups)
```

Research reports compute indicators in code, store the indicator values and a market snapshot reference with the report, and parse a machine-readable lean (`bullish`/`neutral`/`bearish`). `research/evaluation.ts` judges that lean at 1h/24h/7d/30d using close-to-close returns with per-horizon thresholds, recording max upside/downside too.

## Extending

- New AI provider: `services/ai/providers` + `lib/env.ts` + `factory.ts`.
- New notification channel: implement `Notifier` in `services/alerts/alerts-service.ts`.
- Other quote assets: the market layer already returns all quote assets; the portfolio's `quoteAsset` decides which pairs can be simulated.
- Multiple users: every document already has `userId`.
