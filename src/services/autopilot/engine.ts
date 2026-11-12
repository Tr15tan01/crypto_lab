import type { IndicatorSummary } from "@/services/indicators/summary";
import type { Scorecard } from "@/services/indicators/scorecard";
import type { DiscoveryRow } from "@/services/discovery/screens";
import type { DiscoverySignal } from "@/services/discovery/signals";

/**
 * Autopilot decision engine. Pure and deterministic: the same inputs always give the same plan,
 * and every number is explained by a factor. It ranks setups and sizes positions by risk; it
 * cannot know the future, and its calls are scored afterwards like the chat's.
 */

export type AutopilotAction = "BUY" | "ADD" | "HOLD" | "TRIM" | "SELL" | "WATCH" | "NEUTRAL" | "AVOID";
export type Timing = "now" | "wait_for_pullback" | "on_breakout" | "exit_now" | "on_bounce" | "none";

export interface Factor {
  name: string;
  /** -2 … +2 */
  score: number;
  weight: number;
  note: string;
}

export interface RegimeInput {
  btcAboveSma50: boolean | null;
  btcAboveSma200: boolean | null;
  btcReturn7dPercent: number | null;
  /** Share of scanned pairs above their 50-day SMA. */
  breadthPercent: number | null;
  fearGreed: number | null;
}

export interface Regime {
  mode: "risk_on" | "neutral" | "risk_off";
  /** Multiplier applied to buy sizes. */
  sizeMultiplier: number;
  score: number;
  notes: string[];
}

export interface DerivativesInput {
  fundingRatePercent: number;
  openInterestChange1dPercent: number | null;
  openInterestChange7dPercent: number | null;
  longAccountsPercent: number | null;
  topTraderLongShortRatio: number | null;
  takerBuySellRatio: number | null;
}

export interface EngineInput {
  row: DiscoveryRow;
  daily: IndicatorSummary;
  fourHour: IndicatorSummary | null;
  scorecard: Scorecard;
  derivatives: DerivativesInput | null;
  orderBookImbalance: number | null;
  smartMoney: { longs: number; shorts: number; traders: number } | null;
  holding: { quantity: number; averageCost: number } | null;
  /**
   * Backtested 7-day edge vs BTC per signal (Signal Lab). When present, firing signals are
   * weighted by what they actually did historically instead of all counting as bullish.
   */
  signalEdges?: Partial<Record<DiscoverySignal, { edge: number; tStat: number; events: number }>> | null;
  /**
   * The learning model's probability that the pair does better than the typical coin over 7 days, its base rate, and
   * how much it is trusted (0 … 1, from its out-of-sample AUC). Weight scales with trust.
   */
  model?: { probability: number; baseRate: number; trust: number } | null;
}

export interface SizingInput {
  portfolioValue: number;
  cash: number;
  /** Percent of portfolio risked per trade if the stop is hit. */
  riskPerTradePercent: number;
  /** Max allocation of one position, percent of portfolio. */
  maxPositionPercent: number;
}

export interface Recommendation {
  symbol: string;
  baseAsset: string;
  name: string | null;
  price: number;
  action: AutopilotAction;
  /** -100 … +100 */
  score: number;
  /** Probability-style confidence that the direction is right over ~7 days (50 … 85). */
  confidence: number;
  timing: Timing;
  timingNote: string;
  entry: { low: number; high: number } | null;
  target: number | null;
  stop: number | null;
  riskReward: number | null;
  /** Suggested size in quote currency (buys: amount to spend; sells: value to sell). */
  suggestedAmount: number | null;
  suggestedAllocationPercent: number | null;
  /** For holdings: share of the position to sell (0–100). */
  sellPercent: number | null;
  factors: Factor[];
  reasonsFor: string[];
  reasonsAgainst: string[];
  signals: DiscoverySignal[];
  cautions: string[];
  holding: { quantity: number; averageCost: number; marketValue: number; pnlPercent: number } | null;
  /** How to get out: trend line and safety stop (positions and buy ideas). */
  exitPlan: ExitPlan | null;
  /** 90-day daily-return correlation with BTC (set by the service). */
  btcCorrelation?: number | null;
  /** The learning model's view, when a trained model exists (set by the service). */
  model?: import("@/services/learning/learning-service").ModelView | null;
  /** Confidence before calibration against Autopilot's own scored calls (set by the service). */
  rawConfidence?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function assessRegime(r: RegimeInput): Regime {
  let score = 0;
  const notes: string[] = [];
  if (r.btcAboveSma200 !== null) {
    score += r.btcAboveSma200 ? 1 : -1;
    notes.push(r.btcAboveSma200 ? "BTC above its 200-day average (bull structure)" : "BTC below its 200-day average (bear structure)");
  }
  if (r.btcAboveSma50 !== null) {
    score += r.btcAboveSma50 ? 1 : -1;
    notes.push(r.btcAboveSma50 ? "BTC above its 50-day average" : "BTC below its 50-day average");
  }
  if (r.breadthPercent !== null) {
    const b = r.breadthPercent;
    score += b >= 60 ? 1 : b <= 35 ? -1 : 0;
    notes.push(`${b.toFixed(0)}% of coins above their 50-day average`);
  }
  if (r.fearGreed !== null) {
    // Contrarian at the extremes: extreme fear has historically been a better time to buy than extreme greed.
    if (r.fearGreed <= 20) {
      score += 0.5;
      notes.push(`Extreme fear (${r.fearGreed}) — contrarian tailwind, but expect volatility`);
    } else if (r.fearGreed >= 80) {
      score -= 1;
      notes.push(`Extreme greed (${r.fearGreed}) — late-cycle risk, tighten stops`);
    } else notes.push(`Fear & Greed ${r.fearGreed}`);
  }
  const mode = score >= 1.5 ? "risk_on" : score <= -1.5 ? "risk_off" : "neutral";
  return { mode, sizeMultiplier: mode === "risk_on" ? 1 : mode === "neutral" ? 0.75 : 0.4, score, notes };
}

const BULLISH_SIGNALS: DiscoverySignal[] = [
  "volume_surge",
  "outperforming_btc",
  "golden_cross",
  "oversold_bounce",
  "breakout",
  "trend_pullback",
  "accumulation",
];

export function buildFactors(input: EngineInput): Factor[] {
  const { row, daily, fourHour, scorecard, derivatives: d, orderBookImbalance, smartMoney } = input;
  const f: Factor[] = [];

  f.push({
    name: "Scorecard",
    score: clamp(scorecard.composite / 40, -2, 2),
    weight: 0.3,
    note: `Trend, momentum, strength vs BTC, range and volume combine to ${scorecard.composite > 0 ? "+" : ""}${scorecard.composite} (${scorecard.label})`,
  });

  const bullish = row.signals.filter((s) => BULLISH_SIGNALS.includes(s));
  const edges = input.signalEdges;
  const tested = edges ? row.signals.filter((s) => edges[s]) : [];
  if (edges && tested.length) {
    // Only signals whose history is at least weakly significant move the score.
    let sum = 0;
    const notes: string[] = [];
    for (const s of tested) {
      const e = edges[s]!;
      const counts = Math.abs(e.tStat) >= 1.5;
      if (counts) sum += e.edge;
      notes.push(`${s.replace(/_/g, " ")} ${e.edge > 0 ? "+" : ""}${e.edge.toFixed(1)}% vs BTC/7d historically (t ${e.tStat.toFixed(1)}${counts ? "" : ", not significant"})`);
    }
    f.push({ name: "Signal track record", score: clamp(sum / 1.5, -2, 2), weight: 0.12, note: notes.join("; ") });
  } else {
    f.push({
      name: "Discovery signals",
      score: clamp(bullish.length * 0.75, 0, 2),
      weight: 0.12,
      note: bullish.length ? `${bullish.length} bullish signal${bullish.length > 1 ? "s" : ""} firing` : "no discovery signal",
    });
  }

  if (fourHour) {
    let s = 0;
    const notes: string[] = [];
    if (fourHour.macd) {
      s += fourHour.macd.histogram > 0 ? 1 : -1;
      notes.push(fourHour.macd.histogram > 0 ? "4h MACD rising" : "4h MACD falling");
    }
    if (fourHour.ema20 !== null) {
      s += daily.price > fourHour.ema20 ? 0.5 : -0.5;
      notes.push(daily.price > fourHour.ema20 ? "above 4h EMA20" : "below 4h EMA20");
    }
    if (fourHour.rsi14 !== null && fourHour.rsi14 > 75) {
      s -= 0.5;
      notes.push(`4h RSI ${fourHour.rsi14.toFixed(0)} overheated`);
    }
    f.push({ name: "Short-term momentum", score: clamp(s, -2, 2), weight: 0.12, note: notes.join("; ") });
  }

  const sr = scorecard.baseRates.sameRegime?.stats.find((x) => x.horizonDays === 7);
  if (sr) {
    f.push({
      name: "History in this regime",
      score: clamp((sr.upPercent - 50) / 8, -2, 2),
      weight: 0.08,
      note: `${sr.upPercent.toFixed(0)}% of past 7-day windows rose in the same trend regime (median ${sr.medianReturnPercent > 0 ? "+" : ""}${sr.medianReturnPercent.toFixed(1)}%)`,
    });
  }

  if (d) {
    let s = 0;
    const notes: string[] = [];
    const priceUp = (row.return7d ?? 0) > 0;
    if (d.fundingRatePercent >= 0.05) {
      s -= 1;
      notes.push(`funding ${d.fundingRatePercent.toFixed(3)}%/8h — longs crowded`);
    } else if (d.fundingRatePercent <= -0.01) {
      s += priceUp ? 1 : 0.5;
      notes.push(`negative funding ${d.fundingRatePercent.toFixed(3)}% — shorts paying, squeeze fuel`);
    }
    if (d.openInterestChange7dPercent !== null && Math.abs(d.openInterestChange7dPercent) >= 10) {
      const oiUp = d.openInterestChange7dPercent > 0;
      s += oiUp === priceUp ? (priceUp ? 0.75 : -0.75) : 0;
      notes.push(`open interest ${oiUp ? "+" : ""}${d.openInterestChange7dPercent.toFixed(0)}% in 7d ${oiUp === priceUp ? (priceUp ? "confirms the rise" : "adds to the selling") : "diverges from price"}`);
    }
    if (d.takerBuySellRatio !== null) {
      if (d.takerBuySellRatio >= 1.08) {
        s += 0.5;
        notes.push(`aggressive buyers (taker ratio ${d.takerBuySellRatio.toFixed(2)})`);
      } else if (d.takerBuySellRatio <= 0.92) {
        s -= 0.5;
        notes.push(`aggressive sellers (taker ratio ${d.takerBuySellRatio.toFixed(2)})`);
      }
    }
    if (d.longAccountsPercent !== null && d.longAccountsPercent >= 75) {
      s -= 0.5;
      notes.push(`${d.longAccountsPercent.toFixed(0)}% of accounts long — retail crowded (contrarian)`);
    }
    if (d.topTraderLongShortRatio !== null) {
      if (d.topTraderLongShortRatio >= 2) {
        s += 0.5;
        notes.push(`top traders ${d.topTraderLongShortRatio.toFixed(1)}× long vs short`);
      } else if (d.topTraderLongShortRatio <= 0.8) {
        s -= 0.5;
        notes.push(`top traders net short (${d.topTraderLongShortRatio.toFixed(2)})`);
      }
    }
    f.push({ name: "Futures positioning", score: clamp(s, -2, 2), weight: 0.1, note: notes.join("; ") || "neutral positioning" });
  }

  if (orderBookImbalance !== null) {
    const s = orderBookImbalance >= 0.25 ? 1 : orderBookImbalance <= -0.25 ? -1 : 0;
    f.push({
      name: "Order book",
      score: s,
      weight: 0.05,
      note: `${orderBookImbalance >= 0 ? "bids" : "asks"} ${Math.abs(orderBookImbalance * 100).toFixed(0)}% heavier within ±2%`,
    });
  }

  if (input.model && input.model.trust > 0) {
    const edgePts = (input.model.probability - input.model.baseRate) * 100;
    f.push({
      name: "Learned model",
      score: clamp(edgePts / 5, -2, 2),
      weight: Math.round(0.18 * input.model.trust * 100) / 100,
      note: `${(input.model.probability * 100).toFixed(0)}% chance to outperform the typical coin in 7d (typical ${(input.model.baseRate * 100).toFixed(0)}%), model trust ${(input.model.trust * 100).toFixed(0)}%`,
    });
  }

  if (smartMoney && smartMoney.traders > 0) {
    const net = smartMoney.longs - smartMoney.shorts;
    f.push({
      name: "Top copy traders",
      score: clamp(net * 0.5 + (smartMoney.traders >= 3 ? Math.sign(net) * 0.5 : 0), -2, 2),
      weight: 0.08,
      note: `${smartMoney.traders} top trader${smartMoney.traders > 1 ? "s" : ""} opened ${smartMoney.longs} long / ${smartMoney.shorts} short in 7d`,
    });
  }

  // Risk flags from the discovery screens are always a drag.
  if (row.cautions.length) {
    f.push({ name: "Risk flags", score: clamp(-row.cautions.length, -2, 0), weight: 0.1, note: row.cautions.join(" ") });
  }
  return f;
}

export function combine(factors: Factor[]): number {
  const w = factors.reduce((a, f) => a + f.weight, 0);
  if (w === 0) return 0;
  return Math.round((factors.reduce((a, f) => a + (f.score / 2) * f.weight, 0) / w) * 100);
}

export interface Levels {
  entry: { low: number; high: number };
  target: number;
  stop: number;
  riskReward: number;
}

/** Entry, stop and target from swing levels and ATR. Stops never sit more than 25% away. */
export function tradeLevels(daily: IndicatorSummary): Levels | null {
  const price = daily.price;
  const atr = daily.atr14;
  if (!atr || !Number.isFinite(price) || price <= 0) return null;
  const support = daily.levels.support[0] ?? null;
  const resistance = daily.levels.resistance.find((r) => r > price + atr) ?? null;
  // Safety stop 3×ATR away: in the exit backtest (Signal Lab) tighter stops were hit by ordinary
  // daily noise and cut returns. A support level 2–4×ATR below is used when there is one.
  let stop = price - 3 * atr;
  if (support !== null && support < price - 2 * atr && support > price - 4 * atr) stop = support - 0.5 * atr;
  stop = Math.max(stop, price * 0.75);
  const risk = price - stop;
  // Reference target: the next swing resistance, else the 1.272 Fibonacci extension of an up-swing.
  const fibExt = daily.fib?.direction === "up" ? (daily.fib.extensions.find((e) => e.price > price + atr)?.price ?? null) : null;
  let target = resistance ?? fibExt ?? price + 4.5 * atr;
  // Demand at least 1.5:1 reward/risk; otherwise aim at the 1.5R level and let the R:R speak.
  target = Math.max(target, price + 1.5 * risk);
  const entryLow = Math.max(stop + 0.5 * atr, price - 0.75 * atr, support ?? 0);
  return {
    entry: { low: Math.min(entryLow, price), high: price },
    target,
    stop,
    riskReward: (target - price) / risk,
  };
}

export interface ExitPlan {
  /** The 20-day average. The rule: sell on a daily close below it. */
  trendLine: number | null;
  /** The last completed daily candle closed below the trend line. */
  trendBroken: boolean;
  /** Safety stop 3×ATR below the entry (new ideas) or the average cost (positions). */
  hardStop: number | null;
  hardStopHit: boolean;
  /** How far the price is above the trend line, percent (negative when below). */
  cushionPercent: number | null;
}

/**
 * The exit rule that held up best in the exit backtest across every kind of entry: get out on
 * the first daily close below the 20-day average, with a wide safety stop for sudden drops.
 * No fixed profit target: targets cut the winners that pay for the losers.
 */
export function exitPlanFor(daily: IndicatorSummary, basis: number): ExitPlan {
  const atr = daily.atr14;
  const line = daily.sma20;
  const ref = daily.lastClose ?? daily.price;
  const hardStop = atr && basis > 0 ? Math.max(basis - 3 * atr, basis * 0.75) : null;
  return {
    trendLine: line,
    trendBroken: line !== null && ref < line,
    hardStop,
    hardStopHit: hardStop !== null && daily.price <= hardStop,
    cushionPercent: line ? (daily.price / line - 1) * 100 : null,
  };
}

/** Risk-based size: lose `riskPerTradePercent` of the portfolio if the stop is hit. */
export function positionSize(price: number, stop: number, sizing: SizingInput, multiplier: number) {
  const stopDistance = (price - stop) / price;
  if (stopDistance <= 0 || sizing.portfolioValue <= 0) return null;
  const allocation = Math.min(sizing.maxPositionPercent, (sizing.riskPerTradePercent / 100 / stopDistance) * 100) * multiplier;
  const amount = Math.min((allocation / 100) * sizing.portfolioValue, sizing.cash);
  return { allocationPercent: allocation, amount: Math.max(0, amount) };
}

export function decide(input: EngineInput, regime: Regime, sizing: SizingInput): Recommendation {
  const { row, daily, holding } = input;
  const price = daily.price;
  const factors = buildFactors(input);
  // Regime tilts every score a little: a rising tide lifts most coins and vice versa.
  const score = clamp(combine(factors) + Math.round(regime.score * 4), -100, 100);
  const confidence = Math.round(clamp(50 + Math.abs(score) * 0.4, 50, 85));
  const levels = tradeLevels(daily);
  const atr = daily.atr14 ?? price * 0.03;

  const reasonsFor = factors.filter((f) => f.score > 0).sort((a, b) => b.score * b.weight - a.score * a.weight).map((f) => `${f.name}: ${f.note}`);
  const reasonsAgainst = factors.filter((f) => f.score < 0).sort((a, b) => a.score * a.weight - b.score * b.weight).map((f) => `${f.name}: ${f.note}`);

  let action: AutopilotAction;
  let entry = levels?.entry ?? null;
  let timing: Timing = "none";
  let timingNote = "";
  let sellPercent: number | null = null;
  let size: { allocationPercent: number; amount: number } | null = null;
  let holdingView: Recommendation["holding"] = null;
  let plan: ExitPlan | null = null;
  // Never buy what the exit rule would sell: a new position needs the price above its 20-day average.
  const belowTrend = daily.sma20 !== null && (daily.lastClose ?? price) < daily.sma20;

  if (holding && holding.quantity > 0) {
    const marketValue = holding.quantity * price;
    const pnlPercent = holding.averageCost > 0 ? (price / holding.averageCost - 1) * 100 : 0;
    holdingView = { quantity: holding.quantity, averageCost: holding.averageCost, marketValue, pnlPercent };
    const allocation = sizing.portfolioValue > 0 ? (marketValue / sizing.portfolioValue) * 100 : 0;
    const brokeDown = daily.ema50 !== null && daily.ema200 !== null && price < daily.ema50 && daily.ema50 < daily.ema200;
    plan = exitPlanFor(daily, holding.averageCost);

    if (plan.trendBroken && plan.trendLine !== null) {
      // The exit rule fires. Sell everything unless the other evidence is still clearly positive.
      action = score < 15 ? "SELL" : "TRIM";
      sellPercent = score < 15 ? 100 : 50;
      timing = "exit_now";
      timingNote =
        `Exit rule triggered: the last daily close (${fmt(daily.lastClose ?? price)}) is below the 20-day average (${fmt(plan.trendLine)}). ` +
        (score < 15
          ? "This was the best-performing exit in the backtest; sell rather than hope."
          : "Other evidence is still positive, so sell half now and the rest if it does not close back above the average within a few days.");
    } else if (plan.hardStopHit && score < 15) {
      action = "SELL";
      sellPercent = 100;
      timing = "exit_now";
      timingNote = `Safety stop hit: the price is more than 3×ATR below your average cost (stop ${fmt(plan.hardStop!)}). Cut the loss.`;
    } else if (score <= -35 || (brokeDown && score < -10)) {
      action = "SELL";
      sellPercent = 100;
      timing = "exit_now";
      timingNote = brokeDown ? "Trend has broken down (price below a falling 50-day). Exit, or sell into the next bounce." : "Most evidence has turned against this position.";
    } else if (score <= -12 || (pnlPercent >= 40 && score < 15) || allocation > sizing.maxPositionPercent * 1.5) {
      action = "TRIM";
      sellPercent = allocation > sizing.maxPositionPercent * 1.5 ? Math.round((1 - sizing.maxPositionPercent / allocation) * 100) : pnlPercent >= 40 ? 33 : 50;
      timing = (daily.rsi14 ?? 50) < 40 ? "on_bounce" : "now";
      timingNote =
        allocation > sizing.maxPositionPercent * 1.5
          ? `Position is ${allocation.toFixed(0)}% of the portfolio — reduce concentration.`
          : pnlPercent >= 40
            ? `Up ${pnlPercent.toFixed(0)}% with fading evidence: lock in part of the gain.`
            : timing === "on_bounce"
              ? "Oversold right now — trim into the next bounce rather than at the low."
              : "Evidence is weakening: reduce exposure.";
    } else if (score >= 40 && allocation < sizing.maxPositionPercent && levels) {
      action = "ADD";
      size = positionSize(price, levels.stop, { ...sizing, maxPositionPercent: sizing.maxPositionPercent - allocation }, regime.sizeMultiplier);
      timing = (daily.rsi14 ?? 50) > 70 ? "wait_for_pullback" : "now";
      timingNote = timing === "now" ? "Setup still strong and the position is below its size limit." : `Strong but stretched — add near ${fmt(levels.entry.low)}.`;
    } else {
      action = "HOLD";
      timingNote =
        plan.trendLine !== null
          ? `Trend intact (${plan.cushionPercent !== null ? `${plan.cushionPercent.toFixed(1)}% above` : "above"} the 20-day average). Sell on a daily close below ${fmt(plan.trendLine)}.`
          : levels
            ? `Keep a stop near ${fmt(levels.stop)}; re-check if price closes below it.`
            : "No change suggested.";
    }
  } else if (score >= 35 && levels && levels.riskReward >= 1.5 && regime.mode !== "risk_off" && !belowTrend) {
    action = "BUY";
    size = positionSize(price, levels.stop, sizing, regime.sizeMultiplier * (score >= 55 ? 1 : 0.7));
    const stretched = (daily.rsi14 ?? 50) > 70 || (daily.ema20 !== null && price > daily.ema20 + 2 * atr);
    const nearHigh = row.high90d !== null && price < row.high90d && price >= row.high90d * 0.97;
    if (stretched) {
      // Wait for a real pullback: the zone sits around the 20-day average, not just under the price.
      const pull = daily.ema20 ?? price - atr;
      const high = Math.min(price - 0.5 * atr, Math.max(pull, price - 1.5 * atr));
      const low = Math.max(levels.stop + 0.5 * atr, Math.min(high, pull) - 0.5 * atr);
      entry = { low: Math.min(low, high), high };
      timing = "wait_for_pullback";
      timingNote = `Stretched above its averages — place a limit order in the entry zone (${fmt(entry.low)}–${fmt(entry.high)}) instead of chasing.`;
    } else if (nearHigh) {
      timing = "on_breakout";
      timingNote = `Just under the 90-day high (${fmt(row.high90d!)}). Buy on a daily close above it; a rejection there is a common failure point.`;
    } else {
      timing = "now";
      timingNote = "Price is in the entry zone and the setup is confirmed.";
    }
  } else if (score >= 15) {
    action = "WATCH";
    timingNote =
      belowTrend && score >= 35 && regime.mode !== "risk_off"
        ? `Good setup, but the last daily close is below the 20-day average (${fmt(daily.sma20!)}): the exit rule would sell it straight away. Buy only after a daily close back above it.`
        : regime.mode === "risk_off" && score >= 35
        ? "Good setup, but the overall market is risk-off — wait for BTC to recover first."
        : levels && levels.riskReward < 1.5
          ? "Constructive, but the reward/risk to the next resistance is poor right now."
          : "Promising but not confirmed — wait for more signals to agree.";
  } else if (score > -15) {
    action = "NEUTRAL";
    timingNote = "No edge either way right now.";
  } else {
    action = "AVOID";
    timingNote = score <= -35 ? "Evidence points down. Not a buy; a short-term bearish call is recorded." : "More evidence against than for — stay out.";
  }

  if (!plan && (action === "BUY" || action === "WATCH")) plan = exitPlanFor(daily, price);
  // For positions, the level to watch is the active exit: the trend line while above it, else the safety stop.
  const holdingStop =
    plan && holdingView
      ? plan.trendLine !== null && plan.trendLine < price
        ? plan.trendLine
        : plan.hardStop !== null && plan.hardStop < price
          ? plan.hardStop
          : null
      : null;

  return {
    symbol: row.symbol,
    baseAsset: row.baseAsset,
    name: row.name,
    price,
    action,
    score,
    confidence,
    timing,
    timingNote,
    entry: levels && (action === "BUY" || action === "ADD" || action === "WATCH") ? entry : null,
    target: levels && !NO_LEVELS.includes(action) ? levels.target : null,
    stop: holdingView ? (action === "SELL" ? null : holdingStop) : levels && !NO_LEVELS.includes(action) ? levels.stop : null,
    exitPlan: plan,
    riskReward: levels && !NO_LEVELS.includes(action) ? levels.riskReward : null,
    suggestedAmount: size ? size.amount : holdingView && sellPercent !== null ? (holdingView.marketValue * sellPercent) / 100 : null,
    suggestedAllocationPercent: size ? size.allocationPercent : null,
    sellPercent,
    factors,
    reasonsFor,
    reasonsAgainst,
    signals: row.signals,
    cautions: row.cautions,
    holding: holdingView,
  };
}

const NO_LEVELS: AutopilotAction[] = ["SELL", "AVOID", "NEUTRAL"];

function fmt(n: number) {
  const abs = Math.abs(n);
  return n.toLocaleString("en-US", { maximumFractionDigits: abs >= 1000 ? 0 : abs >= 1 ? 3 : 6 });
}

/** Pearson correlation of daily returns over the days both series share (last `days`). */
export function returnCorrelation(a: Array<{ openTime: number; close: number }>, b: Array<{ openTime: number; close: number }>, days = 90): number | null {
  const byDay = new Map(b.map((k) => [Math.floor(k.openTime / 86_400_000), k.close]));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = Math.max(1, a.length - days); i < a.length; i++) {
    const d0 = Math.floor(a[i - 1]!.openTime / 86_400_000);
    const d1 = Math.floor(a[i]!.openTime / 86_400_000);
    const b0 = byDay.get(d0);
    const b1 = byDay.get(d1);
    if (!b0 || !b1 || a[i - 1]!.close <= 0) continue;
    xs.push(a[i]!.close / a[i - 1]!.close - 1);
    ys.push(b1 / b0 - 1);
  }
  if (xs.length < 20) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    dx += (xs[i]! - mx) ** 2;
    dy += (ys[i]! - my) ** 2;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : null;
}

export interface PortfolioRisk {
  /** Loss if every held position fell to its stop. */
  lossAtStops: number;
  lossAtStopsPercent: number;
  /** Held positions without a usable stop (sell suggestions, or no level data). */
  unprotected: string[];
  largestPosition: { symbol: string; percent: number } | null;
  top3Percent: number;
  cashPercent: number;
  /** Value-weighted 90-day correlation of the holdings with BTC. */
  btcCorrelation: number | null;
  warnings: string[];
}

export function portfolioRisk(
  recs: Array<Pick<Recommendation, "symbol" | "price" | "stop" | "holding"> & { btcCorrelation?: number | null }>,
  portfolioValue: number,
  cash: number,
): PortfolioRisk {
  const held = recs.filter((r) => r.holding && r.holding.quantity > 0);
  let loss = 0;
  const unprotected: string[] = [];
  for (const r of held) {
    if (r.stop !== null && r.stop < r.price) loss += r.holding!.quantity * (r.price - r.stop);
    else unprotected.push(r.symbol);
  }
  const weights = held.map((r) => ({ symbol: r.symbol, value: r.holding!.marketValue, corr: r.btcCorrelation ?? null })).sort((a, b) => b.value - a.value);
  const pct = (v: number) => (portfolioValue > 0 ? (v / portfolioValue) * 100 : 0);
  const corrW = weights.filter((w) => w.corr !== null);
  const corrTotal = corrW.reduce((s, w) => s + w.value, 0);
  const btcCorrelation = corrTotal > 0 ? corrW.reduce((s, w) => s + w.corr! * w.value, 0) / corrTotal : null;
  const largest = weights[0] ? { symbol: weights[0].symbol, percent: pct(weights[0].value) } : null;
  const top3Percent = pct(weights.slice(0, 3).reduce((s, w) => s + w.value, 0));
  const warnings: string[] = [];
  if (largest && largest.percent > 30) warnings.push(`${largest.symbol} is ${largest.percent.toFixed(0)}% of the portfolio — one bad move hurts a lot.`);
  if (pct(loss) > 10) warnings.push(`Hitting every stop would cost ${pct(loss).toFixed(1)}% of the portfolio; consider smaller positions or tighter stops.`);
  if (btcCorrelation !== null && btcCorrelation > 0.8 && held.length >= 3) warnings.push("Holdings move almost in lockstep with BTC: diversification is limited.");
  if (held.length && pct(cash) < 5) warnings.push("Under 5% cash: no room to buy dips.");
  return {
    lossAtStops: loss,
    lossAtStopsPercent: pct(loss),
    unprotected,
    largestPosition: largest,
    top3Percent,
    cashPercent: pct(cash),
    btcCorrelation,
    warnings,
  };
}

/** Cheap pre-rank over the whole scan, to pick which pairs get the full (network-heavy) analysis. */
export function preScore(row: DiscoveryRow): number {
  let s = row.signals.filter((x) => BULLISH_SIGNALS.includes(x)).length * 15;
  if (row.vsBtc30d !== null) s += clamp(row.vsBtc30d, -30, 30) * 0.5;
  if (row.rsi14 !== null) s += row.rsi14 >= 50 && row.rsi14 <= 70 ? 8 : row.rsi14 > 75 ? -8 : 0;
  if (row.sma50 !== null && row.sma200 !== null) s += row.sma50 > row.sma200 ? 8 : -5;
  s -= row.cautions.length * 12;
  return s;
}
