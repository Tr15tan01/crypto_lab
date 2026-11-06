import "server-only";
import { getCollections } from "@/lib/mongodb/collections";
import { marketData, type MarketTicker } from "@/services/binance";
import { buildOverview } from "@/services/market/overview";
import { summarizeIndicators } from "@/services/indicators/summary";
import { buildScorecard } from "@/services/indicators/scorecard";
import { summarizeTrackRecord } from "@/services/predictions/scoring";
import type { PricedSymbol } from "@/services/predictions/prediction-service";
import { derivatives, fearGreed, orderBook, smartMoney, type SmartMoney } from "@/services/signals/market-intel";
import { latestRun, scoreCandles } from "@/services/learning/learning-service";
import type { LearningRunDoc } from "@/models";
import { getPortfolioState } from "@/services/portfolio/portfolio-service";
import { scenarioImpact } from "@/services/portfolio/valuation";
import type { Kline } from "@/services/binance/schemas";
import type { PredictionDoc } from "@/models";
import { detectIntent } from "./detect";

export interface ContextSummary {
  symbols: string[];
  included: string[];
  dataTimestamp: string | null;
}

export interface BuiltContext {
  text: string;
  summary: ContextSummary;
  /** Live (non-stale) prices of the pairs in the context, used to record the AI's calls. */
  priced: Record<string, PricedSymbol>;
}

const DAY = 86_400_000;

function round(v: number | null | undefined, dp = 6): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return Number(v.toPrecision(dp));
}

function iso(ms: number | Date | null | undefined) {
  if (ms === null || ms === undefined) return null;
  return new Date(ms).toISOString();
}

function priceAgo(klines: Kline[], days: number) {
  const target = Date.now() - days * DAY;
  // Last daily candle that closed on or before the target time.
  for (let i = klines.length - 1; i >= 0; i--) {
    if (klines[i]!.closeTime <= target) return { date: iso(klines[i]!.closeTime), close: round(klines[i]!.close) };
  }
  return null;
}

function tickerFacts(t: MarketTicker) {
  return {
    pair: t.symbol,
    lastPrice: t.price,
    change24hPercent: round(t.priceChangePercent, 4),
    high24h: t.high,
    low24h: t.low,
    baseVolume24h: round(t.volume),
    quoteVolume24h: round(t.quoteVolume),
    trades24h: t.tradeCount,
  };
}

/**
 * Builds the APPLICATION CONTEXT block sent with a question. Only data relevant to the
 * question is included; the summary (not the data) is stored with the message for auditing.
 */
export async function buildChatContext(
  userId: string,
  question: string,
  opts: { focusSymbol?: string | null; recentText?: string } = {},
): Promise<BuiltContext> {
  const md = marketData();
  const included: string[] = [];
  const ctx: Record<string, unknown> = { generatedAt: new Date().toISOString() };
  let dataTimestamp: number | null = null;

  let tickers: MarketTicker[] = [];
  let tickersStale = false;
  try {
    const res = await md.allTickers();
    tickers = res.data;
    tickersStale = res.stale;
    dataTimestamp = res.fetchedAt;
    ctx.marketData = {
      source: "Binance Spot public market data",
      fetchedAt: iso(res.fetchedAt),
      status: res.stale ? "STALE — Binance unreachable, last known values" : "live",
    };
  } catch {
    ctx.marketData = { status: "UNAVAILABLE — Binance could not be reached and no cached data exists" };
  }

  const usdt = tickers.filter((t) => t.quoteAsset === "USDT");
  const known = new Set(usdt.map((t) => t.baseAsset));
  const focusBase = opts.focusSymbol ? usdt.find((t) => t.symbol === opts.focusSymbol)?.baseAsset ?? null : null;
  // Follow-up questions ("and what about its volume?") inherit symbols from the recent turns.
  let intent = detectIntent(question, known, focusBase);
  if (intent.baseAssets.length === 0 && opts.recentText) {
    const prior = detectIntent(opts.recentText, known, focusBase);
    intent = { ...intent, baseAssets: prior.baseAssets.slice(0, 2), marketWide: intent.marketWide && prior.baseAssets.length === 0 };
  }

  if (intent.marketWide && usdt.length) {
    const o = buildOverview(tickers, "USDT");
    ctx.marketOverview = {
      note: `Breadth among USDT pairs with ≥ $1M 24h volume (${o.liquidPairCount} pairs)`,
      advancers: o.advancers,
      decliners: o.decliners,
      medianChange24hPercent: round(o.medianChangePercent, 4),
      majors: o.majors.map(tickerFacts),
      topGainers: o.leaders.gainers.map((t) => ({ pair: t.symbol, change24hPercent: round(t.priceChangePercent, 4) })),
      topLosers: o.leaders.losers.map((t) => ({ pair: t.symbol, change24hPercent: round(t.priceChangePercent, 4) })),
    };
    included.push("market overview");
  }

  const symbols = intent.baseAssets
    .map((b) => usdt.find((t) => t.baseAsset === b))
    .filter((t): t is MarketTicker => Boolean(t));
  const { holdings, transactions, decisionJournal, watchlist, aiResearch, marketSnapshots, portfolios, predictions } =
    await getCollections();
  const activePortfolio = symbols.length ? await portfolios.findOne({ userId, status: "active" }) : null;
  const priced: Record<string, PricedSymbol> = {};

  // Shared inputs for the per-asset forecasting data: BTC as the benchmark and the AI's own record.
  let btcDaily: Kline[] | null = null;
  let pastCalls: PredictionDoc[] = [];
  let smart: SmartMoney | null = null;
  let learned: LearningRunDoc | null = null;
  if (symbols.length) {
    [btcDaily, pastCalls, smart, learned] = await Promise.all([
      md.klines("BTCUSDT", "1d", "1y").then((r) => r.data).catch(() => null),
      predictions.find({ userId, source: { $ne: "autopilot" } }).sort({ timestamp: -1 }).limit(200).toArray(),
      smartMoney(),
      latestRun().catch(() => null),
    ]);
  }
  if (pastCalls.length) {
    const record = summarizeTrackRecord(pastCalls);
    ctx.myAITrackRecord = {
      note: "Your own past directional calls in this chat, scored automatically at their horizon (close-to-close).",
      ...record,
    };
    included.push("AI track record");
  }

  const assets: Record<string, unknown>[] = [];
  for (const t of symbols) {
    const entry: Record<string, unknown> = { asset: t.baseAsset, ...tickerFacts(t) };
    if (tickersStale) entry.dataWarning = "STALE price data";

    const [daily, first, symbolInfo, fourHour, deriv, book] = await Promise.allSettled([
      md.klines(t.symbol, "1d", "1y"),
      md.firstCandle(t.symbol),
      md.symbolInfo(t.symbol),
      md.klines(t.symbol, "4h", "90d"),
      derivatives(t.symbol),
      orderBook(t.symbol),
    ]);
    if (deriv.status === "fulfilled" && deriv.value) {
      const d = deriv.value;
      entry.futuresPositioning = {
        note: "Binance USD-M perpetual data. Funding % per 8h (positive = longs pay shorts). Extremes are often contrarian.",
        fundingRatePercent: round(d.fundingRatePercent, 4),
        openInterestChange1dPercent: round(d.openInterestChange1dPercent, 4),
        openInterestChange7dPercent: round(d.openInterestChange7dPercent, 4),
        longAccountsPercent: round(d.longAccountsPercent, 4),
        topTraderLongShortRatio: round(d.topTraderLongShortRatio, 4),
        takerBuySellRatio: round(d.takerBuySellRatio, 4),
      };
      included.push(`${t.baseAsset} futures positioning`);
    }
    if (book.status === "fulfilled" && book.value) {
      entry.orderBook = {
        note: "Spot order book within ±2% of mid. imbalance +1 = only bids, -1 = only asks.",
        imbalance: round(book.value.imbalance, 3),
        spreadPercent: round(book.value.spreadPercent, 4),
        depthQuote2Percent: round(book.value.depthQuote2Percent, 4),
      };
    }
    const sm = smart?.entries.find((e) => e.symbol === t.symbol);
    if (smart && sm) {
      entry.topCopyTraders = {
        note: `Positions opened in the last ${smart.window} by ${smart.tradersSampled} top Binance futures lead traders (by 90d P&L). A crowd signal, leveraged traders.`,
        ...sm,
      };
    }
    let compositeScore: number | null = null;
    if (symbolInfo.status === "fulfilled") {
      entry.binanceStatus = symbolInfo.value.data?.status ?? "not listed";
    }
    if (first.status === "fulfilled" && first.value.data) {
      entry.firstAvailableBinanceTradingData = iso(first.value.data.openTime);
      entry.firstAvailableBinanceTradingDataNote =
        "Date of the earliest daily candle Binance serves for this pair. Not the project launch or listing announcement date.";
    }
    if (daily.status === "fulfilled" && daily.value.data.length > 15) {
      const k = daily.value.data;
      const s = summarizeIndicators(k, "1d", t.price);
      entry.dailyIndicators = {
        computedFrom: `${s.candles} closed daily candles up to ${iso(s.asOf)}`,
        rsi14: round(s.rsi14, 4),
        macd: s.macd ? { macd: round(s.macd.macd), signal: round(s.macd.signal), histogram: round(s.macd.histogram) } : null,
        ema20: round(s.ema20),
        ema50: round(s.ema50),
        ema200: round(s.ema200),
        bollinger: s.bollinger
          ? { upper: round(s.bollinger.upper), middle: round(s.bollinger.middle), lower: round(s.bollinger.lower), percentB: round(s.bollinger.percentB, 4) }
          : null,
        atr14: round(s.atr14),
        atrPercent: round(s.atrPercent, 4),
        volumeVs20dAverage: round(s.volume.ratio, 4),
        realisedVolatility30dAnnualisedPercent: round(s.volatility.annualizedPercent, 4),
        returnsPercent: Object.fromEntries(Object.entries(s.returns).map(([k2, v]) => [k2, round(v, 4)])),
        range90d: s.range ? { high: round(s.range.high), low: round(s.range.low), positionPercent: round(s.range.positionPercent, 4) } : null,
        swingSupport: s.levels.support.map((v) => round(v)),
        swingResistance: s.levels.resistance.map((v) => round(v)),
        ruleBasedReadings: s.signals.map((x) => `${x.name}: ${x.value} — ${x.note}`),
        warnings: s.warnings,
      };
      const card = buildScorecard(k, s, t.baseAsset === "BTC" ? null : btcDaily);
      compositeScore = card.composite;
      entry.scorecard = {
        note: "Rule-based summary computed by the application. composite: -100 (all bearish) … +100 (all bullish). Components score -2 … +2.",
        composite: card.composite,
        label: card.label,
        components: card.components.map((c) => `${c.name} ${c.score > 0 ? "+" : ""}${c.score} (weight ${c.weight}): ${c.note}`),
        relativeToBtc: card.relativeToBtc,
        drawdownFrom1yHighPercent: card.drawdownFromHighPercent,
        oneSigmaMovePercent: card.oneSigmaMovePercent,
      };
      entry.baseRates = {
        note: "How this pair actually behaved over every past 7- and 30-day window in the last year (close to close). sameRegime only counts days on the same side of the 50-day SMA as today.",
        allWindows: card.baseRates.allWindows,
        sameRegime: card.baseRates.sameRegime,
      };
      included.push(`${t.baseAsset} scorecard`);
      const view = learned && t.baseAsset !== "BTC" ? scoreCandles(learned, k, btcDaily) : null;
      if (view && learned) {
        entry.learnedModel = {
          note:
            "The app's own model, trained daily on ~2.5 years of daily data for the 100 most liquid pairs. probability = chance this pair beats BTC over the next 7 days. " +
            `Out-of-sample AUC ${learned.test.metrics.auc} (0.5 = no skill); typical probability ${learned.test.metrics.baseRate}. Treat as one input, weighted by its trust.`,
          probability: view.probability,
          edgeVsTypicalPoints: view.edgePoints,
          trust: view.trust,
          trainedAt: view.trainedAt,
          topDrivers: view.drivers.map((d) => `${d.label} (${d.value}): ${d.contribution > 0 ? "+" : ""}${d.contribution} log-odds`),
        };
        included.push(`${t.baseAsset} learned model`);
      }
      entry.historicalCloses = {
        "1dAgo": priceAgo(k, 1),
        "7dAgo": priceAgo(k, 7),
        "30dAgo": priceAgo(k, 30),
        "90dAgo": priceAgo(k, 90),
        "180dAgo": priceAgo(k, 180),
        "365dAgo": priceAgo(k, 364),
      };
      included.push(`${t.baseAsset} indicators`);
    }

    if (fourHour.status === "fulfilled" && fourHour.value.data.length > 50) {
      const s4 = summarizeIndicators(fourHour.value.data, "4h", t.price);
      entry.fourHourIndicators = {
        computedFrom: `${s4.candles} closed 4h candles up to ${iso(s4.asOf)}`,
        rsi14: round(s4.rsi14, 4),
        macdHistogram: s4.macd ? round(s4.macd.histogram) : null,
        ema20: round(s4.ema20),
        ema50: round(s4.ema50),
        returnsPercent: Object.fromEntries(Object.entries(s4.returns).map(([k2, v]) => [`${k2}x4h`, round(v, 4)])),
        swingSupport: s4.levels.support.map((v) => round(v)),
        swingResistance: s4.levels.resistance.map((v) => round(v)),
        ruleBasedReadings: s4.signals.map((x) => `${x.name}: ${x.value} (${x.reading})`),
      };
      included.push(`${t.baseAsset} 4h indicators`);
    }
    if (!tickersStale) priced[t.symbol] = { price: t.price, compositeScore };

    const calls = pastCalls.filter((p) => p.symbol === t.symbol).slice(0, 5);
    if (calls.length) {
      entry.myPastAICallsOnThisPair = calls.map((p) => ({
        at: iso(p.timestamp),
        bias: p.bias,
        confidence: p.confidence,
        horizon: p.horizon,
        priceAtCall: p.priceAtPrediction,
        target: p.target,
        stop: p.stop,
        result: p.evaluation
          ? `${p.evaluation.outcome} (${round(p.evaluation.returnPercent, 3)}%${p.evaluation.levelHit && p.evaluation.levelHit !== "none" ? `, ${p.evaluation.levelHit} hit first` : ""})`
          : `pending until ${iso(p.dueAt)}`,
      }));
    }

    // The user's own data for this asset (always relevant to a question about it).
    const holding = activePortfolio ? await holdings.findOne({ portfolioId: activePortfolio._id, symbol: t.symbol }) : null;
    if (holding && holding.quantity > 0) {
      entry.mySimulatedPosition = {
        quantity: holding.quantity,
        averageCost: round(holding.averageCost),
        costBasis: round(holding.investedValue),
        marketValue: round(holding.quantity * t.price),
        unrealizedPnL: round(holding.quantity * t.price - holding.investedValue),
        openedAt: iso(holding.openedAt),
      };
    }
    const txs = await transactions.find({ userId, symbol: t.symbol }).sort({ timestamp: -1 }).limit(10).toArray();
    if (txs.length) {
      entry.mySimulatedTransactions = txs.map((x) => ({
        type: x.type,
        at: iso(x.timestamp),
        quantity: x.quantity,
        price: x.price,
        total: round(x.total),
        realizedPnL: x.realizedPnL !== undefined ? round(x.realizedPnL) : undefined,
        realWorldStatus: x.executionStatus,
      }));
      included.push(`${t.baseAsset} transactions`);
    }
    const journals = await decisionJournal.find({ userId, symbol: t.symbol }).sort({ timestamp: -1 }).limit(5).toArray();
    if (journals.length) {
      entry.myJournalEntries = journals.map((j) => ({
        at: iso(j.timestamp),
        decision: j.decisionType,
        priceAtDecision: j.priceAtDecision,
        thesis: j.thesis?.slice(0, 600),
        reason: j.reason?.slice(0, 300),
        targetPrice: j.targetPrice,
        horizon: j.expectedTimeHorizon,
        risk: j.riskLevel,
        confidence: j.confidence,
        latestReview: j.outcome ?? null,
      }));
      included.push(`${t.baseAsset} journal`);
    }
    const watch = await watchlist.findOne({ userId, symbol: t.symbol, active: true });
    if (watch) {
      entry.myWatchlistEntry = {
        addedAt: iso(watch.addedAt),
        priceAtAdd: watch.priceAtAdd,
        reason: watch.reason?.slice(0, 400),
        targetPrice: watch.targetPrice,
      };
    }
    const research = await aiResearch.find({ userId, symbol: t.symbol }).sort({ timestamp: -1 }).limit(2).toArray();
    if (research.length) {
      entry.previousAIResearch = research.map((r) => ({
        at: iso(r.timestamp),
        priceAtAnalysis: r.priceAtAnalysis,
        bias: r.bias,
        evaluations: r.evaluations.map((e) => `${e.horizon}: ${e.outcome} (${round(e.returnPercent, 3)}%)`),
        excerpt: r.analysis.split("## 13.")[1]?.slice(0, 700) ?? r.analysis.slice(0, 500),
      }));
      included.push(`${t.baseAsset} past research`);
    }
    const snaps = await marketSnapshots.find({ symbol: t.symbol }).sort({ timestamp: -1 }).limit(5).toArray();
    if (snaps.length) {
      entry.storedMarketSnapshots = snaps.map((s) => ({ at: iso(s.dataTimestamp), price: s.price, reason: s.reason }));
    }
    assets.push(entry);
  }
  // A coin call needs the backdrop even when the question names no market-wide topic.
  if (assets.length && !ctx.marketOverview && usdt.length) {
    const o = buildOverview(tickers, "USDT");
    const btc = usdt.find((t) => t.symbol === "BTCUSDT");
    const btcSummary = btcDaily && btcDaily.length > 50 && btc ? summarizeIndicators(btcDaily, "1d", btc.price) : null;
    const fng = await fearGreed();
    ctx.marketBackdrop = {
      fearGreedIndex: fng ? { value: fng.value, label: fng.label, weekAgo: fng.weekAgo, at: iso(fng.at) } : null,
      breadth: `${o.advancers} advancers / ${o.decliners} decliners among ${o.liquidPairCount} liquid USDT pairs`,
      medianChange24hPercent: round(o.medianChangePercent, 4),
      btc: btc
        ? {
            lastPrice: btc.price,
            change24hPercent: round(btc.priceChangePercent, 4),
            returnsPercent: btcSummary ? Object.fromEntries(Object.entries(btcSummary.returns).map(([k, v]) => [k, round(v, 4)])) : null,
            ema50AboveEma200: btcSummary?.ema50 != null && btcSummary.ema200 != null ? btcSummary.ema50 > btcSummary.ema200 : null,
            rsi14: btcSummary ? round(btcSummary.rsi14, 4) : null,
          }
        : null,
    };
    included.push("market backdrop");
  }
  if (assets.length) {
    ctx.assets = assets;
    included.push(`market data: ${symbols.map((s) => s.baseAsset).join(", ")}`);
  }

  if (intent.portfolio) {
    const state = await getPortfolioState(userId);
    const v = state.valuation;
    ctx.mySimulatedPortfolio = {
      note: "Paper portfolio with theoretical funds",
      startingBalance: state.portfolio.initialBalance,
      quoteAsset: state.portfolio.quoteAsset,
      cash: round(v.cash),
      totalValue: round(v.totalValue),
      totalReturnPercent: round(v.totalReturnPercent, 4),
      realizedPnL: round(v.realizedPnL),
      unrealizedPnL: round(v.unrealizedPnL),
      pricesAsOf: state.pricesFetchedAt,
      unpricedPositions: v.unpricedSymbols,
      positions: v.positions.map((p) => ({
        pair: p.symbol,
        quantity: p.quantity,
        averageCost: round(p.averageCost),
        price: p.price,
        marketValue: round(p.marketValue),
        unrealizedPnL: round(p.unrealizedPnL),
        unrealizedPercent: round(p.unrealizedPercent, 4),
        allocationPercent: round(p.allocationPercent, 4),
        priceIsLive: p.priceLive,
      })),
    };
    if (intent.scenarios.length) {
      ctx.whatIfScenarios = intent.scenarios.map((s) => scenarioImpact(v, s.asset, s.changePercent));
      included.push("what-if scenarios");
    }
    included.push("portfolio");

    if (intent.history && symbols.length === 0) {
      const recent = await transactions.find({ userId, portfolioId: state.portfolio._id }).sort({ timestamp: -1 }).limit(15).toArray();
      ctx.myRecentSimulatedTransactions = recent.map((x) => ({
        pair: x.symbol,
        type: x.type,
        at: iso(x.timestamp),
        price: x.price,
        total: round(x.total),
        realizedPnL: x.realizedPnL !== undefined ? round(x.realizedPnL) : undefined,
      }));
      included.push("recent transactions");
    }
  }

  if (intent.journal && symbols.length === 0) {
    const journals = await decisionJournal.find({ userId }).sort({ timestamp: -1 }).limit(8).toArray();
    ctx.myRecentJournalEntries = journals.map((j) => ({
      pair: j.symbol,
      at: iso(j.timestamp),
      decision: j.decisionType,
      priceAtDecision: j.priceAtDecision,
      thesis: j.thesis?.slice(0, 400),
      targetPrice: j.targetPrice,
      confidence: j.confidence,
      latestReview: j.outcome ?? null,
    }));
    included.push("journal");
  }

  const text = `APPLICATION CONTEXT (JSON, generated by the app; treat as the only source of facts):\n${JSON.stringify(ctx)}`;
  return {
    text,
    summary: {
      symbols: symbols.map((s) => s.symbol),
      included,
      dataTimestamp: dataTimestamp ? new Date(dataTimestamp).toISOString() : null,
    },
    priced,
  };
}
