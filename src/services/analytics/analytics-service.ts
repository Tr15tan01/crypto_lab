import "server-only";
import { getCollections } from "@/lib/mongodb/collections";
import { logger } from "@/lib/logger";
import { marketData } from "@/services/binance";
import type { Kline } from "@/services/binance/schemas";
import { getPortfolioState } from "@/services/portfolio/portfolio-service";
import { listSnapshots } from "@/services/portfolio/snapshots";
import { HORIZON_ORDER, HORIZONS } from "@/services/research/evaluation";
import {
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

  const closedRounds = rounds.filter((r) => r.closedAt);
  return {
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
      aiEvaluation:
        "AI biases are judged on the close-to-close return at each horizon. Moves smaller than the threshold are inconclusive. Failed calls are kept.",
    },
  };
}

export type Analytics = Awaited<ReturnType<typeof getAnalytics>>;
