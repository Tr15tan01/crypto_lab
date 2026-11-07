import "server-only";
import { getCollections } from "@/lib/mongodb/collections";
import { logger } from "@/lib/logger";
import { marketData } from "@/services/binance";
import type { Kline } from "@/services/binance/schemas";
import { getPortfolioState } from "@/services/portfolio/portfolio-service";
import { listSnapshots } from "@/services/portfolio/snapshots";
import { HORIZON_ORDER, HORIZONS } from "@/services/research/evaluation";
import { rsi, sma } from "@/services/indicators/core";
import { fearGreedHistory } from "@/services/signals/market-intel";
import {
  bucketRounds,
  insightsFrom,
  tradeQuality,
  type ScoredRound,
  buyAndHoldSeries,
  maxDrawdown,
  monthlyReturns,
  positionRounds,
  rangePosition,
  sellStats,
  type Point,
  type TxLike,
} from "./metrics";

const DAY = 86_400_000;
const EARLY_SELL_DAYS = 7;
const EARLY_SELL_THRESHOLD = 5; // % higher a week after selling
const NEAR_HIGH_THRESHOLD = 90; // top 10% of the prior 30-day range

async function dailyCloses(symbol: string): Promise<Kline[] | null> {
  try {
    return (await marketData().klines(symbol, "1d", "1y")).data;
  } catch {
    return null;
  }
}

export async function getAnalytics(userId: string) {
  const state = await getPortfolioState(userId);
  const portfolio = state.portfolio;
  const { transactions, aiResearch } = await getCollections();
  const txDocs = await transactions.find({ userId, portfolioId: portfolio._id }).sort({ timestamp: 1 }).toArray();
  const txs: TxLike[] = txDocs.map((t) => ({
    id: t._id.toString(),
    type: t.type,
    symbol: t.symbol,
    quantity: t.quantity,
    price: t.price,
    grossAmount: t.grossAmount,
    total: t.total,
    fee: t.fee,
    realizedPnL: t.realizedPnL,
    costBasisSold: t.costBasisSold,
    timestamp: t.timestamp.getTime(),
  }));

  const rounds = positionRounds(txs);
  const sells = sellStats(txs);
  const priceNow = new Map(state.valuation.positions.map((p) => [p.symbol, p.price]));

  // Daily candles for traded symbols (cached, one request each) for timing analysis.
  const symbols = [...new Set(txs.map((t) => t.symbol))].slice(0, 25);
  const klines = new Map<string, Kline[]>();
  await Promise.all(
    symbols.map(async (s) => {
      const k = await dailyCloses(s);
      if (k) klines.set(s, k);
    }),
  );

  // Purchases: profitable vs not (current price for open rounds, average exit for closed ones).
  let profitableBuys = 0;
  let evaluatedBuys = 0;
  let nearHighBuys = 0;
  let timedBuys = 0;
  for (const r of rounds) {
    const exit = r.closedAt ? r.averageExit : (priceNow.get(r.symbol) ?? null);
    for (const id of r.buyIds) {
      const b = txs.find((t) => t.id === id)!;
      const effectiveCost = b.total / b.quantity;
      if (exit !== null && exit !== undefined) {
        evaluatedBuys++;
        if (exit > effectiveCost) profitableBuys++;
      }
      const k = klines.get(b.symbol);
      if (k) {
        const prior = k.filter((c) => c.closeTime < b.timestamp && c.openTime >= b.timestamp - 30 * DAY);
        const pos = rangePosition(b.price, prior.map((c) => c.high), prior.map((c) => c.low));
        if (pos !== null && prior.length >= 10) {
          timedBuys++;
          if (pos >= NEAR_HIGH_THRESHOLD) nearHighBuys++;
        }
      }
    }
  }

  // Sells: did the price keep rising afterwards?
  let earlySells = 0;
  let timedSells = 0;
  for (const s of txs.filter((t) => t.type === "SELL")) {
    if (Date.now() - s.timestamp < EARLY_SELL_DAYS * DAY) continue;
    const k = klines.get(s.symbol);
    if (!k) continue;
    const later = k.find((c) => c.closeTime >= s.timestamp + EARLY_SELL_DAYS * DAY);
    if (!later) continue;
    timedSells++;
    if (((later.close - s.price) / s.price) * 100 >= EARLY_SELL_THRESHOLD) earlySells++;
  }

  // Portfolio value series from stored snapshots only (never re-priced with today's prices).
  const snaps = await listSnapshots(userId, portfolio._id);
  const series: Point[] = snaps.map((s) => ({ t: s.timestamp.getTime(), v: s.totalValue }));

  // Benchmarks: the starting balance held in BTC / ETH from the portfolio creation time.
  const start = portfolio.createdAt.getTime();
  const benchmarks: Record<string, { series: Point[]; returnPercent: number | null; startPrice: number | null }> = {};
  for (const sym of ["BTCUSDT", "ETHUSDT"]) {
    try {
      const k = (await marketData().klines(sym, "1d", "1y")).data;
      let startPrice: number | null = null;
      if (Date.now() - start < 2 * DAY) {
        const live = await marketData().klinesBetween(sym, "1h", start - 3_600_000, Date.now());
        startPrice = live.data.find((c) => c.closeTime >= start)?.open ?? null;
      } else {
        startPrice = k.find((c) => c.closeTime >= start)?.open ?? null;
      }
      if (!startPrice) continue;
      const closes: Point[] = k.filter((c) => c.closeTime >= start).map((c) => ({ t: Math.min(c.closeTime, Date.now()), v: c.close }));
      const s = buyAndHoldSeries(portfolio.initialBalance, startPrice, [{ t: start, v: startPrice }, ...closes]);
      const last = s[s.length - 1];
      benchmarks[sym] = {
        series: s,
        startPrice,
        returnPercent: last ? ((last.v - portfolio.initialBalance) / portfolio.initialBalance) * 100 : null,
      };
    } catch (err) {
      logger.warn("analytics.benchmark_failed", { symbol: sym, error: err });
    }
  }

  // AI research outcomes, tracked separately from portfolio performance.
  const reports = await aiResearch.find({ userId }, { projection: { analysis: 0, indicators: 0 } }).toArray();
  const aiByHorizon = HORIZON_ORDER.map((h) => {
    const evs = reports.flatMap((r) => r.evaluations.filter((e) => e.horizon === h));
    const judged = evs.filter((e) => e.outcome === "correct" || e.outcome === "incorrect");
    const correct = evs.filter((e) => e.outcome === "correct").length;
    return {
      horizon: h,
      thresholdPercent: HORIZONS[h].thresholdPercent,
      evaluated: evs.length,
      correct,
      incorrect: evs.filter((e) => e.outcome === "incorrect").length,
      inconclusive: evs.filter((e) => e.outcome === "inconclusive").length,
      notEvaluable: evs.filter((e) => e.outcome === "not_evaluated").length,
      hitRatePercent: judged.length ? (correct / judged.length) * 100 : null,
      avgMaxUpside: evs.length ? evs.reduce((s, e) => s + e.maxUpsidePercent, 0) / evs.length : null,
      avgMaxDownside: evs.length ? evs.reduce((s, e) => s + e.maxDownsidePercent, 0) / evs.length : null,
    };
  });

  // ── What works for you: every round scored, then grouped by the conditions at entry ──
  const scored: ScoredRound[] = rounds.map((r) => {
    const now = priceNow.get(r.symbol) ?? null;
    const unrealized = !r.closedAt && now !== null && r.averageEntry > 0 ? (now / r.averageEntry - 1) * 100 : null;
    const openQty = r.averageEntry > 0 ? (r.invested - r.proceeds) / r.averageEntry : 0;
    return {
      symbol: r.symbol,
      openedAt: r.openedAt,
      closedAt: r.closedAt,
      holdMs: r.holdMs,
      pnl: r.closedAt ? r.realizedPnL : r.realizedPnL + (unrealized !== null ? (unrealized / 100) * r.averageEntry * Math.max(0, openQty) : 0),
      returnPercent: r.closedAt ? r.realizedReturnPercent : unrealized,
    };
  });
  const quality = tradeQuality(scored);

  const [fng, btcDaily] = await Promise.all([fearGreedHistory(), dailyCloses("BTCUSDT")]);
  const dayOf = (t: number) => Math.floor(t / DAY);
  const moodAt = (t: number) => fng.get(dayOf(t)) ?? fng.get(dayOf(t) - 1) ?? null;
  const btcCloses = btcDaily?.map((k) => k.close) ?? [];
  const btcSma50 = sma(btcCloses, 50);
  const lastClosedBefore = (k: Kline[], t: number) => {
    let idx = -1;
    for (let i = 0; i < k.length; i++) {
      if (k[i]!.closeTime < t) idx = i;
      else break;
    }
    return idx;
  };
  const rsiBySymbol = new Map<string, Array<number | null>>();
  for (const [sym, k] of klines) rsiBySymbol.set(sym, rsi(k.map((c) => c.close), 14));

  const byMood = bucketRounds(
    scored,
    (r) => {
      const v = moodAt(r.openedAt);
      if (v === null) return null;
      return v <= 24 ? "xfear" : v <= 44 ? "fear" : v <= 55 ? "neutral" : v <= 75 ? "greed" : "xgreed";
    },
    [
      { key: "xfear", label: "Bought in extreme fear (0–24)" },
      { key: "fear", label: "Bought in fear (25–44)" },
      { key: "neutral", label: "Bought in neutral mood (45–55)" },
      { key: "greed", label: "Bought in greed (56–75)" },
      { key: "xgreed", label: "Bought in extreme greed (76–100)" },
    ],
  );
  const byBtcTrend = bucketRounds(
    scored,
    (r) => {
      if (!btcDaily) return null;
      const i = lastClosedBefore(btcDaily, r.openedAt);
      return i >= 0 && btcSma50[i] != null ? (btcCloses[i]! > btcSma50[i]! ? "up" : "down") : null;
    },
    [
      { key: "up", label: "Bought while BTC was above its 50-day average" },
      { key: "down", label: "Bought while BTC was below its 50-day average" },
    ],
  );
  const byRsi = bucketRounds(
    scored,
    (r) => {
      const k = klines.get(r.symbol);
      const series = rsiBySymbol.get(r.symbol);
      if (!k || !series) return null;
      const v = series[lastClosedBefore(k, r.openedAt)];
      if (v === null || v === undefined) return null;
      return v < 30 ? "os" : v < 50 ? "weak" : v < 70 ? "strong" : "ob";
    },
    [
      { key: "os", label: "Bought when RSI was oversold (<30)" },
      { key: "weak", label: "Bought when RSI was 30–50" },
      { key: "strong", label: "Bought when RSI was 50–70" },
      { key: "ob", label: "Bought when RSI was overbought (>70)" },
    ],
  );
  const byHold = bucketRounds(
    scored.filter((r) => r.closedAt),
    (r) => (r.holdMs < DAY ? "d" : r.holdMs < 7 * DAY ? "w" : r.holdMs < 30 * DAY ? "m" : "l"),
    [
      { key: "d", label: "Held under a day" },
      { key: "w", label: "Held 1–7 days" },
      { key: "m", label: "Held 1–4 weeks" },
      { key: "l", label: "Held over a month" },
    ],
  );
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const byWeekday = bucketRounds(
    scored,
    (r) => String(new Date(r.openedAt).getUTCDay()),
    [1, 2, 3, 4, 5, 6, 0].map((d) => ({ key: String(d), label: `Bought on ${WEEKDAYS[d]}` })),
  );

  // Journal: does higher stated confidence mean better decisions? (reviewed entries only)
  const { decisionJournal } = await getCollections();
  const reviewed = await decisionJournal
    .find({ userId, confidence: { $ne: null }, outcome: { $in: ["correct", "incorrect", "mixed"] } }, { projection: { confidence: 1, outcome: 1 } })
    .toArray();
  const confidence = [
    { key: "low", label: "Confidence 1–3", from: 1, to: 3 },
    { key: "mid", label: "Confidence 4–6", from: 4, to: 6 },
    { key: "high", label: "Confidence 7–10", from: 7, to: 10 },
  ]
    .map((b) => {
      const sel = reviewed.filter((e) => (e.confidence ?? 0) >= b.from && (e.confidence ?? 0) <= b.to);
      return {
        key: b.key,
        label: b.label,
        reviewed: sel.length,
        correctPercent: sel.length ? (sel.filter((e) => e.outcome === "correct").length / sel.length) * 100 : null,
      };
    })
    .filter((b) => b.reviewed > 0);

  const breakdowns = [
    { name: "Market mood", buckets: byMood },
    { name: "BTC trend", buckets: byBtcTrend },
    { name: "RSI at entry", buckets: byRsi },
    { name: "Holding time", buckets: byHold },
    { name: "Day of week", buckets: byWeekday },
  ];
  const insights = insightsFrom(breakdowns);
  if (quality.closed >= 5 && quality.payoffRatio !== null && quality.breakEvenWinRate !== null && sells.winRatePercent !== null) {
    const edge = sells.winRatePercent - quality.breakEvenWinRate;
    insights.unshift({
      tone: edge >= 0 ? "up" : "down",
      text: `Your wins are ${quality.payoffRatio.toFixed(2)}× the size of your losses, so you need a ${quality.breakEvenWinRate.toFixed(0)}% win rate to break even; you are at ${sells.winRatePercent.toFixed(0)}% (${edge >= 0 ? "above" : "below"} break-even).`,
    });
  }

  const closedRounds = rounds.filter((r) => r.closedAt);
  return {
    quality,
    whatWorks: { breakdowns, confidence, insights, fearGreedAvailable: fng.size > 0 },
    portfolio: {
      createdAt: portfolio.createdAt,
      initialBalance: portfolio.initialBalance,
      totalValue: state.valuation.totalValue,
      totalReturnPercent: state.valuation.totalReturnPercent,
      realizedPnL: state.valuation.realizedPnL,
      unrealizedPnL: state.valuation.unrealizedPnL,
      totalFeesPaid: portfolio.totalFeesPaid,
      pricesStale: state.pricesStale,
    },
    trades: {
      total: txs.length,
      buys: txs.filter((t) => t.type === "BUY").length,
      sells: sells.count,
      winRatePercent: sells.winRatePercent,
      averageReturnPercent: sells.averageReturnPercent,
      best: sells.best,
      worst: sells.worst,
    },
    purchases: {
      evaluated: evaluatedBuys,
      profitable: profitableBuys,
      profitablePercent: evaluatedBuys ? (profitableBuys / evaluatedBuys) * 100 : null,
      timed: timedBuys,
      nearHigh: nearHighBuys,
      nearHighPercent: timedBuys ? (nearHighBuys / timedBuys) * 100 : null,
    },
    exits: {
      timed: timedSells,
      early: earlySells,
      earlyPercent: timedSells ? (earlySells / timedSells) * 100 : null,
    },
    holding: {
      closedRounds: closedRounds.length,
      averageHoldDays: closedRounds.length
        ? closedRounds.reduce((s, r) => s + r.holdMs, 0) / closedRounds.length / DAY
        : null,
      medianHoldDays: closedRounds.length
        ? [...closedRounds].sort((a, b) => a.holdMs - b.holdMs)[Math.floor(closedRounds.length / 2)]!.holdMs / DAY
        : null,
    },
    rounds,
    bySymbol: Object.values(
      rounds.reduce<Record<string, { symbol: string; realizedPnL: number; rounds: number; unrealizedPnL: number | null }>>((acc, r) => {
        const e = (acc[r.symbol] ??= { symbol: r.symbol, realizedPnL: 0, rounds: 0, unrealizedPnL: null });
        e.realizedPnL += r.realizedPnL;
        e.rounds++;
        const pos = state.valuation.positions.find((p) => p.symbol === r.symbol);
        e.unrealizedPnL = pos?.unrealizedPnL ?? null;
        return acc;
      }, {}),
    ).sort((a, b) => b.realizedPnL + (b.unrealizedPnL ?? 0) - (a.realizedPnL + (a.unrealizedPnL ?? 0))),
    drawdown: maxDrawdown(series),
    monthly: monthlyReturns(series),
    series,
    benchmarks,
    ai: { reports: reports.length, withBias: reports.filter((r) => r.bias).length, byHorizon: aiByHorizon },
    definitions: {
      earlySell: `A sale counts as "too early" if the price ${EARLY_SELL_DAYS} days later was at least ${EARLY_SELL_THRESHOLD}% higher.`,
      nearHigh: `A purchase counts as "near a local high" if its price was in the top ${100 - NEAR_HIGH_THRESHOLD}% of the previous 30 days' range.`,
      profitableBuy:
        "A purchase is profitable if the current price (open positions) or the average exit price (closed positions) is above its cost including fees.",
      benchmark: "Benchmarks invest the starting balance in BTC or ETH at the portfolio creation time and hold it.",
      whatWorks:
        "Each position round is grouped by the conditions on the day it was opened (Fear & Greed index, BTC vs its 50-day average, the coin's RSI(14) on the last closed daily candle, weekday in UTC). Results are realised for closed rounds and unrealised for open ones.",
      quality:
        "Payoff ratio = average winning return ÷ average losing return. Profit factor = total gains ÷ total losses (above 1 = profitable). Expectancy = average result per closed round.",
      aiEvaluation:
        "AI biases are judged on the close-to-close return at each horizon. Moves smaller than the threshold are inconclusive. Failed calls are kept.",
    },
  };
}

export type Analytics = Awaited<ReturnType<typeof getAnalytics>>;
