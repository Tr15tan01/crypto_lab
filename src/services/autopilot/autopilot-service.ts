import "server-only";
import { getCollections } from "@/lib/mongodb/collections";
import { logger } from "@/lib/logger";
import { marketData } from "@/services/binance";
import type { Kline } from "@/services/binance/schemas";
import { getDiscoveryScan } from "@/services/discovery/discovery-service";
import { analyzePair, type DiscoveryRow } from "@/services/discovery/screens";
import { THRESHOLDS } from "@/services/discovery/signals";
import { summarizeIndicators } from "@/services/indicators/summary";
import { isLikelyTokenizedStock } from "@/services/market/asset-names";
import { buildScorecard } from "@/services/indicators/scorecard";
import { effectiveFeeRate, getPortfolioState } from "@/services/portfolio/portfolio-service";
import { recordAutopilotCalls, getTrackRecord } from "@/services/predictions/prediction-service";
import { derivatives, fearGreed, orderBook, smartMoney, type SmartMoney } from "@/services/signals/market-intel";
import type { TradeContext } from "@/components/portfolio/trade-dialog";
import { assessRegime, decide, portfolioRisk, preScore, returnCorrelation, type EngineInput, type Recommendation } from "./engine";
import { cachedSignalBacktest } from "@/services/backtest/backtest-service";
import { calibrateConfidence, latestRun, scoreCandles, selfCalibration } from "@/services/learning/learning-service";
import { BACKTEST_SIGNALS, signalEdge } from "@/services/backtest/signal-backtest";

/**
 * Autopilot: runs the discovery scan through the decision engine and returns a plan — what to
 * buy, what to hold, trim or sell, when, and how much — for the paper portfolio. It never
 * trades by itself; every suggestion opens the normal (simulated) trade dialog.
 */
const BUY_CANDIDATES = 14;
const WATCHLIST_EXTRA = 6;
const CONCURRENCY = 4;
const MIN_LIQUIDITY = 1_000_000;
const PLAN_TTL_MS = 5 * 60_000;

export interface AutopilotOptions {
  riskPerTradePercent: number;
  maxPositionPercent: number;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const globalForPlans = globalThis as unknown as { __cryptoLabPlans?: Map<string, { at: number; plan: AutopilotPlan }> };
const plans = () => (globalForPlans.__cryptoLabPlans ??= new Map());

export type AutopilotPlan = Awaited<ReturnType<typeof buildPlan>>;

export async function getAutopilotPlan(userId: string, opts: AutopilotOptions, refresh = false) {
  const key = `${userId}:${opts.riskPerTradePercent}:${opts.maxPositionPercent}`;
  const hit = plans().get(key);
  if (!refresh && hit && Date.now() - hit.at < PLAN_TTL_MS) return hit.plan;
  const plan = await buildPlan(userId, opts);
  plans().set(key, { at: Date.now(), plan });
  if (plans().size > 20) plans().delete(plans().keys().next().value!);
  return plan;
}

/** A row for a held pair the scan did not cover (e.g. below its volume floor). */
async function rowFor(symbol: string, benchmark: DiscoveryRow | null): Promise<DiscoveryRow | null> {
  const md = marketData();
  const [t, candles] = await Promise.all([
    md.ticker(symbol).catch(() => null),
    md.recentDailyCandles(symbol, THRESHOLDS.historyDays).catch(() => null),
  ]);
  if (!t?.data || !candles?.length) return null;
  return analyzePair(t.data, candles, {
    now: Date.now(),
    historyLimit: THRESHOLDS.historyDays,
    benchmark: benchmark ? { return7d: benchmark.return7d, return30d: benchmark.return30d } : null,
  });
}

async function buildPlan(userId: string, opts: AutopilotOptions) {
  const md = marketData();
  const { watchlist } = await getCollections();
  const [scan, state, fng, smart, watched, btcDaily, symbolMap, backtest] = await Promise.all([
    getDiscoveryScan(),
    getPortfolioState(userId),
    fearGreed(),
    smartMoney(),
    watchlist.find({ userId, active: true }, { projection: { symbol: 1 } }).limit(50).toArray(),
    md.klines("BTCUSDT", "1d", "1y").then((r) => r.data).catch((): Kline[] | null => null),
    md.symbolMap().then((r) => r.data).catch(() => null),
    cachedSignalBacktest().catch(() => null),
  ]);
  const [learned, calibration] = await Promise.all([latestRun().catch(() => null), selfCalibration(userId).catch(() => [])]);
  const signalEdges: NonNullable<EngineInput["signalEdges"]> = {};
  for (const s of BACKTEST_SIGNALS) {
    const e = signalEdge(backtest, s);
    if (e) signalEdges[s] = e;
  }

  const rows = scan.data.rows;
  const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
  const btc = bySymbol.get("BTCUSDT") ?? null;
  const withSma = rows.filter((r) => r.sma50 !== null);
  const regime = assessRegime({
    btcAboveSma50: btc?.sma50 != null ? btc.price > btc.sma50 : null,
    btcAboveSma200: btc?.sma200 != null ? btc.price > btc.sma200 : null,
    btcReturn7dPercent: btc?.return7d ?? null,
    breadthPercent: withSma.length ? (withSma.filter((r) => r.price > r.sma50!).length / withSma.length) * 100 : null,
    fearGreed: fng?.value ?? null,
  });

  const positions = state.valuation.positions.filter((p) => p.quantity > 0);
  const held = new Map(positions.map((p) => [p.symbol, p]));
  const heldRows = await Promise.all(positions.map((p) => bySymbol.get(p.symbol) ?? rowFor(p.symbol, btc)));

  const ranked = rows
    .filter(
      (r) => !held.has(r.symbol) && r.quoteVolume24h >= MIN_LIQUIDITY && r.symbol !== "BTCUSDT" && !isLikelyTokenizedStock(r.baseAsset),
    )
    .map((r) => ({ r, s: preScore(r) }))
    .sort((a, b) => b.s - a.s);
  const picks = new Map<string, DiscoveryRow>();
  for (const { r } of ranked.slice(0, BUY_CANDIDATES)) picks.set(r.symbol, r);
  if (btc && !held.has("BTCUSDT")) picks.set("BTCUSDT", btc);
  for (const w of watched.slice(0, WATCHLIST_EXTRA)) {
    const r = bySymbol.get(w.symbol);
    if (r && !held.has(r.symbol)) picks.set(r.symbol, r);
  }
  const universe = [...heldRows.filter((r): r is DiscoveryRow => r !== null), ...picks.values()];

  const smartBySymbol = new Map((smart?.entries ?? []).map((e) => [e.symbol, e]));
  const sizing = {
    portfolioValue: state.valuation.totalValue,
    cash: state.valuation.cash,
    riskPerTradePercent: opts.riskPerTradePercent,
    maxPositionPercent: opts.maxPositionPercent,
  };

  const analysed = await mapLimit(universe, CONCURRENCY, async (row): Promise<Recommendation | null> => {
    try {
      const [daily, fourHour, deriv, book] = await Promise.all([
        md.klines(row.symbol, "1d", "1y").then((r) => r.data),
        md.klines(row.symbol, "4h", "90d").then((r) => r.data).catch(() => null),
        derivatives(row.symbol),
        orderBook(row.symbol),
      ]);
      if (daily.length < 30) return null;
      const summary = summarizeIndicators(daily, "1d", row.price);
      const h = held.get(row.symbol);
      const modelView = learned && row.baseAsset !== "BTC" ? scoreCandles(learned, daily, btcDaily) : null;
      const rec = decide(
        {
          row,
          daily: summary,
          fourHour: fourHour && fourHour.length > 50 ? summarizeIndicators(fourHour, "4h", row.price) : null,
          scorecard: buildScorecard(daily, summary, row.baseAsset === "BTC" ? null : btcDaily),
          derivatives: deriv,
          orderBookImbalance: book?.imbalance ?? null,
          smartMoney: smartBySymbol.get(row.symbol) ?? null,
          holding: h ? { quantity: h.quantity, averageCost: h.averageCost } : null,
          signalEdges: Object.keys(signalEdges).length ? signalEdges : null,
          model: modelView && learned ? { probability: modelView.probability, baseRate: learned.test.metrics.baseRate, trust: learned.trust } : null,
        },
        regime,
        sizing,
      );
      rec.model = modelView;
      // Learn from Autopilot's own record: pull confidence toward what similar calls achieved.
      rec.rawConfidence = rec.confidence;
      rec.confidence = calibrateConfidence(rec.confidence, calibration, "autopilot");
      rec.btcCorrelation = btcDaily && row.baseAsset !== "BTC" ? returnCorrelation(daily, btcDaily) : row.baseAsset === "BTC" ? 1 : null;
      return rec;
    } catch (err) {
      logger.warn("autopilot.analysis_failed", { symbol: row.symbol, error: err });
      return null;
    }
  });
  const recs = analysed.filter((r): r is Recommendation => r !== null);

  // Keep total buys within available cash, best setups first.
  let cashLeft = sizing.cash;
  for (const r of recs.filter((x) => x.action === "BUY" || x.action === "ADD").sort((a, b) => b.score - a.score)) {
    if (r.suggestedAmount === null) continue;
    r.suggestedAmount = Math.max(0, Math.min(r.suggestedAmount, cashLeft));
    cashLeft -= r.suggestedAmount;
  }

  const order: Record<Recommendation["action"], number> = { SELL: 0, TRIM: 1, ADD: 2, HOLD: 3, BUY: 4, WATCH: 5, NEUTRAL: 6, AVOID: 7 };
  recs.sort((a, b) => order[a.action] - order[b.action] || b.score - a.score);

  if (!scan.stale) {
    const calls = recs
      .filter((r) => ((r.action === "BUY" || r.action === "ADD") && r.score >= 35) || ((r.action === "SELL" || r.action === "AVOID") && r.score <= -35))
      .map((r) => ({
        symbol: r.symbol,
        bias: r.score > 0 ? ("bullish" as const) : ("bearish" as const),
        confidence: r.confidence,
        price: r.price,
        target: r.target,
        stop: r.stop,
        score: r.score,
      }));
    await recordAutopilotCalls(userId, calls, new Date(scan.fetchedAt)).catch((err) =>
      logger.warn("autopilot.record_failed", { error: err }),
    );
  }

  const fee = effectiveFeeRate(state.portfolio);
  const tradeContexts: Record<string, TradeContext> = {};
  for (const r of recs) {
    const info = symbolMap?.get(r.symbol);
    const h = held.get(r.symbol);
    tradeContexts[r.symbol] = {
      symbol: r.symbol,
      baseAsset: r.baseAsset,
      quoteAsset: info?.quoteAsset ?? "USDT",
      price: r.price,
      priceFetchedAt: new Date(scan.fetchedAt).toISOString(),
      priceStale: scan.stale,
      tradable: info?.tradable ?? true,
      availableBalance: state.portfolio.availableBalance,
      portfolioQuoteAsset: state.portfolio.quoteAsset,
      feeRatePercent: fee,
      holdingQuantity: h?.quantity ?? 0,
      averageCost: h?.averageCost ?? 0,
    };
  }

  const record = await getTrackRecord(userId, { source: "autopilot" }).catch(() => null);

  return {
    generatedAt: new Date().toISOString(),
    scanFetchedAt: new Date(scan.fetchedAt).toISOString(),
    stale: scan.stale,
    regime,
    fearGreed: fng,
    smartMoney: smart ? { ...smart, entries: smart.entries.slice(0, 10) } : (null as SmartMoney | null),
    sizing: { ...sizing, cashAfterBuys: cashLeft },
    risk: portfolioRisk(recs, sizing.portfolioValue, sizing.cash),
    signalLabAvailable: backtest !== null,
    learning: learned
      ? { trainedAt: learned.createdAt.toISOString(), testAuc: learned.test.metrics.auc, trust: learned.trust, baseRate: learned.test.metrics.baseRate }
      : null,
    universe: { scanned: rows.length, analysed: recs.length },
    recommendations: recs,
    tradeContexts,
    trackRecord: record,
  };
}
