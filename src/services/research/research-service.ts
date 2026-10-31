import "server-only";
import { ObjectId } from "mongodb";
import { getCollections } from "@/lib/mongodb/collections";
import { AppError, NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { marketData } from "@/services/binance";
import { summarizeIndicators, type IndicatorSummary } from "@/services/indicators/summary";
import { recordMarketSnapshot } from "@/services/market/snapshots";
import { getAIProvider } from "@/services/ai/providers/factory";
import { RESEARCH_SYSTEM_PROMPT } from "@/services/ai/orchestration/prompts";
import { extractAssessment } from "@/services/ai/orchestration/follow-ups";
import type { AIResearchDoc } from "@/models";
import { HORIZONS, HORIZON_ORDER, evaluateOutcome } from "./evaluation";

function compact(s: IndicatorSummary) {
  const r = (v: number | null | undefined) => (v === null || v === undefined ? null : Number(v.toPrecision(6)));
  return {
    interval: s.interval,
    candles: s.candles,
    asOf: s.asOf ? new Date(s.asOf).toISOString() : null,
    rsi14: r(s.rsi14),
    macd: s.macd ? { macd: r(s.macd.macd), signal: r(s.macd.signal), histogram: r(s.macd.histogram) } : null,
    ema20: r(s.ema20),
    ema50: r(s.ema50),
    ema200: r(s.ema200),
    bollinger: s.bollinger
      ? { upper: r(s.bollinger.upper), middle: r(s.bollinger.middle), lower: r(s.bollinger.lower), percentB: r(s.bollinger.percentB), bandwidthPercent: r(s.bollinger.bandwidthPercent) }
      : null,
    atr14: r(s.atr14),
    atrPercent: r(s.atrPercent),
    volume: { last: r(s.volume.last), sma20: r(s.volume.sma20), ratio: r(s.volume.ratio) },
    volatility: { periodStdPercent: r(s.volatility.periodStdPercent), annualizedPercent: r(s.volatility.annualizedPercent) },
    returnsPercent: Object.fromEntries(Object.entries(s.returns).map(([k, v]) => [k, r(v)])),
    range: s.range ? { high: r(s.range.high), low: r(s.range.low), positionPercent: r(s.range.positionPercent) } : null,
    swingSupport: s.levels.support.map(r),
    swingResistance: s.levels.resistance.map(r),
    readings: s.signals.map((x) => `${x.name}: ${x.value} (${x.reading}) — ${x.note}`),
    warnings: s.warnings,
  };
}

/**
 * Generates and stores a structured analysis report. Indicators are computed in code; the AI
 * only interprets them. The report stores provider, model, the indicator values and a market
 * snapshot reference, so it can be compared with later prices.
 */
export async function generateResearch(userId: string, symbol: string, signal?: AbortSignal) {
  const provider = getAIProvider(); // fails fast with a clear configuration error
  const md = marketData();
  const tickerRes = await md.ticker(symbol, 10);
  const ticker = tickerRes.data;
  if (!ticker) throw new AppError("VALIDATION", `${symbol} is not listed on Binance Spot.`);
  if (tickerRes.stale) {
    throw new AppError("STALE_DATA", "Live market data is unavailable, so a new analysis would be based on stale prices. Try again shortly.");
  }

  const [daily, fourHour, first] = await Promise.all([
    md.klines(symbol, "1d", "1y"),
    md.klines(symbol, "4h", "90d").catch(() => null),
    md.firstCandle(symbol).catch(() => null),
  ]);
  if (daily.data.length < 30) {
    throw new AppError("VALIDATION", "Not enough trading history on Binance for a meaningful analysis (needs 30+ daily candles).");
  }
  const dailySummary = summarizeIndicators(daily.data, "1d", ticker.price);
  const fourHourSummary = fourHour && fourHour.data.length > 50 ? summarizeIndicators(fourHour.data, "4h", ticker.price) : null;
  const snapshotId = await recordMarketSnapshot(ticker, { fetchedAt: tickerRes.fetchedAt, stale: false, reason: "research" });

  const indicators = { daily: compact(dailySummary), fourHour: fourHourSummary ? compact(fourHourSummary) : null };
  const context = {
    pair: ticker.symbol,
    baseAsset: ticker.baseAsset,
    quoteAsset: ticker.quoteAsset,
    dataTimestamp: new Date(tickerRes.fetchedAt).toISOString(),
    source: "Binance Spot public market data",
    ticker24h: {
      lastPrice: ticker.price,
      changePercent: ticker.priceChangePercent,
      high: ticker.high,
      low: ticker.low,
      baseVolume: ticker.volume,
      quoteVolume: ticker.quoteVolume,
      trades: ticker.tradeCount,
    },
    firstAvailableBinanceTradingData: first?.data ? new Date(first.data.openTime).toISOString() : null,
    indicators,
    verifiedEvents: [],
  };

  const raw = await provider.generate({
    system: RESEARCH_SYSTEM_PROMPT,
    messages: [{ role: "user", content: `APPLICATION CONTEXT (JSON):\n${JSON.stringify(context)}\n\nWrite the report for ${ticker.symbol}.` }],
    signal,
  });
  if (!raw.trim()) throw new AppError("AI_UNAVAILABLE", "The AI provider returned an empty report. Retry.", { retryable: true });
  const { content, assessment } = extractAssessment(raw);

  const { aiResearch } = await getCollections();
  const doc: AIResearchDoc = {
    _id: new ObjectId(),
    userId,
    symbol: ticker.symbol,
    provider: provider.name,
    model: provider.model,
    analysis: content,
    indicators,
    marketSnapshotReference: snapshotId,
    priceAtAnalysis: ticker.price,
    dataTimestamp: new Date(tickerRes.fetchedAt),
    bias: assessment.bias,
    scenarios: {
      bullish: assessment.bullishRange ? { low: assessment.bullishRange[0], high: assessment.bullishRange[1] } : null,
      bearish: assessment.bearishRange ? { low: assessment.bearishRange[0], high: assessment.bearishRange[1] } : null,
    },
    evaluations: [],
    timestamp: new Date(),
  };
  await aiResearch.insertOne(doc);
  logger.info("research.generated", { symbol: doc.symbol, provider: doc.provider, bias: doc.bias });
  return doc;
}

export async function listResearch(userId: string, opts: { symbol?: string; limit?: number } = {}) {
  const { aiResearch } = await getCollections();
  return aiResearch
    .find({ userId, ...(opts.symbol ? { symbol: opts.symbol } : {}) }, { projection: { analysis: 0, indicators: 0 } })
    .sort({ timestamp: -1 })
    .limit(Math.min(opts.limit ?? 50, 200))
    .toArray();
}

export async function getResearch(userId: string, id: string) {
  const { aiResearch } = await getCollections();
  const doc = await aiResearch.findOne({ _id: new ObjectId(id), userId });
  if (!doc) throw new NotFoundError("Report not found.");
  return doc;
}

/**
 * Fills in any horizon evaluations that have become due. Idempotent: each horizon is evaluated
 * once and never rewritten. Bounded per call to protect Binance rate limits.
 */
export async function evaluateDueResearch(userId: string, maxReports = 10): Promise<number> {
  const { aiResearch } = await getCollections();
  const now = Date.now();
  const candidates = await aiResearch
    .find(
      { userId, "evaluations.3": { $exists: false }, timestamp: { $lte: new Date(now - HORIZONS["1h"].ms) } },
      { projection: { analysis: 0, indicators: 0 } },
    )
    .sort({ timestamp: 1 })
    .limit(maxReports * 3)
    .toArray();

  let added = 0;
  let processed = 0;
  for (const r of candidates) {
    if (processed >= maxReports) break;
    const done = new Set(r.evaluations.map((e) => e.horizon));
    const due = HORIZON_ORDER.filter((h) => !done.has(h) && r.timestamp.getTime() + HORIZONS[h].ms <= now);
    if (!due.length) continue;
    processed++;
    for (const h of due) {
      try {
        const start = r.timestamp.getTime();
        const kl = await marketData().klinesBetween(r.symbol, HORIZONS[h].interval, start, start + HORIZONS[h].ms);
        if (kl.stale) continue;
        const ev = evaluateOutcome(r.bias, r.priceAtAnalysis, start, h, kl.data);
        if (!ev) continue;
        // Only add if this horizon was not evaluated concurrently.
        const res = await aiResearch.updateOne(
          { _id: r._id, "evaluations.horizon": { $ne: h } },
          { $push: { evaluations: ev } },
        );
        added += res.modifiedCount;
      } catch (err) {
        logger.warn("research.evaluation_failed", { symbol: r.symbol, horizon: h, error: err });
      }
    }
  }
  return added;
}
