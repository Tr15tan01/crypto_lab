import "server-only";
import { marketData } from "@/services/binance";
import { effectiveFeeRate, type PortfolioState } from "./portfolio-service";
import type { HoldingRow } from "@/components/portfolio/holdings-table";

/** Shapes valued positions for the holdings table, including the context the Sell dialog needs. */
export async function holdingRows(state: PortfolioState): Promise<HoldingRow[]> {
  let symbols: Map<string, { tradable: boolean; quoteAsset: string }> = new Map();
  try {
    symbols = (await marketData().symbolMap()).data;
  } catch {
    // unknown tradability → selling disabled rather than guessed
  }
  const p = state.portfolio;
  return state.valuation.positions.map((pos) => ({
    symbol: pos.symbol,
    baseAsset: pos.baseAsset,
    quantity: pos.quantity,
    averageCost: pos.averageCost,
    investedValue: pos.investedValue,
    price: pos.price,
    priceLive: pos.priceLive,
    priceAsOf: pos.priceAsOf,
    marketValue: pos.marketValue,
    unrealizedPnL: pos.unrealizedPnL,
    unrealizedPercent: pos.unrealizedPercent,
    allocationPercent: pos.allocationPercent,
    trade: {
      symbol: pos.symbol,
      baseAsset: pos.baseAsset,
      quoteAsset: symbols.get(pos.symbol)?.quoteAsset ?? p.quoteAsset,
      price: pos.price,
      priceFetchedAt: pos.priceAsOf ? new Date(pos.priceAsOf).toISOString() : null,
      priceStale: !pos.priceLive,
      tradable: symbols.get(pos.symbol)?.tradable ?? false,
      availableBalance: p.availableBalance,
      portfolioQuoteAsset: p.quoteAsset,
      feeRatePercent: effectiveFeeRate(p),
      holdingQuantity: pos.quantity,
      averageCost: pos.averageCost,
    },
  }));
}
