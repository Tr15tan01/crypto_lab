import { roundQuote } from "@/lib/utils/math";

export interface PriceQuote {
  price: number;
  asOf: number;
  /** false when the price is a last-known value (e.g. Binance unreachable or pair delisted). */
  live: boolean;
}

export interface HoldingInput {
  symbol: string;
  baseAsset: string;
  quantity: number;
  averageCost: number;
  investedValue: number;
  realizedPnL: number;
  openedAt?: Date | string;
}

export interface ValuedPosition extends HoldingInput {
  price: number | null;
  priceAsOf: number | null;
  priceLive: boolean;
  marketValue: number | null;
  unrealizedPnL: number | null;
  unrealizedPercent: number | null;
  allocationPercent: number | null;
}

export interface PortfolioValuation {
  cash: number;
  initialBalance: number;
  positions: ValuedPosition[];
  marketValue: number;
  investedValue: number;
  unrealizedPnL: number;
  realizedPnL: number;
  totalValue: number;
  totalReturn: number;
  totalReturnPercent: number | null;
  /** Positions without any price at all are excluded from totals; they are listed here. */
  unpricedSymbols: string[];
  /** Positions valued with a last-known (not live) price. */
  stalePricedSymbols: string[];
  best: ValuedPosition | null;
  worst: ValuedPosition | null;
}

export function valuePortfolio(input: {
  cash: number;
  initialBalance: number;
  realizedPnL: number;
  holdings: HoldingInput[];
  prices: Map<string, PriceQuote>;
}): PortfolioValuation {
  const positions: ValuedPosition[] = input.holdings.map((h) => {
    const q = input.prices.get(h.symbol);
    const marketValue = q ? roundQuote(h.quantity * q.price) : null;
    const unrealizedPnL = marketValue !== null ? roundQuote(marketValue - h.investedValue) : null;
    return {
      ...h,
      price: q?.price ?? null,
      priceAsOf: q?.asOf ?? null,
      priceLive: q?.live ?? false,
      marketValue,
      unrealizedPnL,
      unrealizedPercent:
        unrealizedPnL !== null && h.investedValue > 0 ? (unrealizedPnL / h.investedValue) * 100 : null,
      allocationPercent: null,
    };
  });

  const priced = positions.filter((p) => p.marketValue !== null);
  const marketValue = roundQuote(priced.reduce((s, p) => s + p.marketValue!, 0));
  const unrealizedPnL = roundQuote(priced.reduce((s, p) => s + p.unrealizedPnL!, 0));
  const investedValue = roundQuote(positions.reduce((s, p) => s + p.investedValue, 0));
  const totalValue = roundQuote(input.cash + marketValue);

  for (const p of positions) {
    p.allocationPercent = p.marketValue !== null && totalValue > 0 ? (p.marketValue / totalValue) * 100 : null;
  }

  const ranked = priced.filter((p) => p.unrealizedPercent !== null).sort((a, b) => b.unrealizedPercent! - a.unrealizedPercent!);
  const totalReturn = roundQuote(totalValue - input.initialBalance);

  return {
    cash: input.cash,
    initialBalance: input.initialBalance,
    positions,
    marketValue,
    investedValue,
    unrealizedPnL,
    realizedPnL: input.realizedPnL,
    totalValue,
    totalReturn,
    totalReturnPercent: input.initialBalance > 0 ? (totalReturn / input.initialBalance) * 100 : null,
    unpricedSymbols: positions.filter((p) => p.price === null).map((p) => p.symbol),
    stalePricedSymbols: positions.filter((p) => p.price !== null && !p.priceLive).map((p) => p.symbol),
    best: ranked[0] ?? null,
    worst: ranked.length > 1 ? ranked[ranked.length - 1]! : null,
  };
}

/**
 * What-if: value change if one asset moves by `changePercent`, everything else unchanged.
 * Deterministic arithmetic for the AI assistant and the UI; correlations are NOT modelled.
 */
export function scenarioImpact(valuation: PortfolioValuation, baseAsset: string, changePercent: number) {
  const affected = valuation.positions.filter((p) => p.baseAsset === baseAsset && p.marketValue !== null);
  const exposure = affected.reduce((s, p) => s + p.marketValue!, 0);
  const delta = roundQuote(exposure * (changePercent / 100));
  const newTotal = roundQuote(valuation.totalValue + delta);
  return {
    asset: baseAsset,
    changePercent,
    exposure: roundQuote(exposure),
    exposurePercentOfPortfolio: valuation.totalValue > 0 ? (exposure / valuation.totalValue) * 100 : 0,
    valueChange: delta,
    portfolioValueBefore: valuation.totalValue,
    portfolioValueAfter: newTotal,
    portfolioChangePercent: valuation.totalValue > 0 ? (delta / valuation.totalValue) * 100 : 0,
    assumption: "Only this asset's price changes; other holdings and cash are held constant (no correlation modelled).",
  };
}
