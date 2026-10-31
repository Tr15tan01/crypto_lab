import type { MarketTicker } from "@/services/binance/market-data";

export interface MarketOverview {
  quoteAsset: string;
  pairCount: number;
  liquidPairCount: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  medianChangePercent: number | null;
  totalQuoteVolume: number;
  leaders: { gainers: MarketTicker[]; losers: MarketTicker[]; volume: MarketTicker[] };
  majors: MarketTicker[];
}

/** Minimum 24h quote volume for gainers/losers lists, so illiquid pairs don't dominate. */
export const LIQUIDITY_FLOOR = 1_000_000;

const MAJORS = ["BTC", "ETH", "BNB", "SOL", "XRP"];

export function buildOverview(tickers: MarketTicker[], quoteAsset = "USDT"): MarketOverview {
  const pairs = tickers.filter((t) => t.quoteAsset === quoteAsset);
  const liquid = pairs.filter((t) => t.quoteVolume >= LIQUIDITY_FLOOR);

  let advancers = 0;
  let decliners = 0;
  let unchanged = 0;
  for (const t of liquid) {
    if (t.priceChangePercent > 0) advancers++;
    else if (t.priceChangePercent < 0) decliners++;
    else unchanged++;
  }

  const changes = liquid.map((t) => t.priceChangePercent).sort((a, b) => a - b);
  const median =
    changes.length === 0
      ? null
      : changes.length % 2
        ? changes[(changes.length - 1) / 2]!
        : (changes[changes.length / 2 - 1]! + changes[changes.length / 2]!) / 2;

  const byChange = [...liquid].sort((a, b) => b.priceChangePercent - a.priceChangePercent);
  return {
    quoteAsset,
    pairCount: pairs.length,
    liquidPairCount: liquid.length,
    advancers,
    decliners,
    unchanged,
    medianChangePercent: median,
    totalQuoteVolume: pairs.reduce((s, t) => s + t.quoteVolume, 0),
    leaders: {
      gainers: byChange.slice(0, 5),
      losers: byChange.slice(-5).reverse(),
      volume: [...pairs].sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 5),
    },
    majors: MAJORS.map((b) => pairs.find((t) => t.baseAsset === b)).filter((t): t is MarketTicker => Boolean(t)),
  };
}
