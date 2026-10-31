import "server-only";
import { marketData, type MarketTicker, type SymbolInfo } from "@/services/binance";
import { summarizeIndicators, type IndicatorSummary } from "@/services/indicators/summary";
import { assetName } from "./asset-names";
import { isAppError } from "@/lib/errors";

export interface SymbolOverview {
  symbol: string;
  name: string | null;
  info: SymbolInfo | null;
  listing: "tradable" | "not_tradable" | "not_listed" | "unknown";
  ticker: MarketTicker | null;
  tickerError: string | null;
  fetchedAt: string | null;
  stale: boolean;
  firstAvailableCandle: string | null;
  indicators: IndicatorSummary | null;
  indicatorsError: string | null;
}

function message(err: unknown) {
  return isAppError(err) ? err.publicMessage : "Market data is temporarily unavailable.";
}

/** Everything the detail page and the AI need about one pair; each part fails independently. */
export async function getSymbolOverview(symbol: string, opts: { indicators?: boolean } = {}): Promise<SymbolOverview> {
  const md = marketData();
  const out: SymbolOverview = {
    symbol,
    name: null,
    info: null,
    listing: "unknown",
    ticker: null,
    tickerError: null,
    fetchedAt: null,
    stale: false,
    firstAvailableCandle: null,
    indicators: null,
    indicatorsError: null,
  };

  try {
    const info = await md.symbolInfo(symbol);
    out.info = info.data;
    out.listing = info.data ? (info.data.tradable ? "tradable" : "not_tradable") : "not_listed";
    out.name = info.data ? assetName(info.data.baseAsset) : null;
  } catch (err) {
    out.tickerError = message(err);
    return out;
  }
  if (!out.info) return out;

  const [tickerRes, firstRes, klineRes] = await Promise.allSettled([
    md.ticker(symbol),
    md.firstCandle(symbol),
    opts.indicators === false ? Promise.resolve(null) : md.klines(symbol, "1d", "1y"),
  ]);

  if (tickerRes.status === "fulfilled" && tickerRes.value.data) {
    out.ticker = tickerRes.value.data;
    out.fetchedAt = new Date(tickerRes.value.fetchedAt).toISOString();
    out.stale = tickerRes.value.stale;
  } else if (tickerRes.status === "rejected") {
    out.tickerError = message(tickerRes.reason);
  }

  if (firstRes.status === "fulfilled" && firstRes.value.data) {
    out.firstAvailableCandle = new Date(firstRes.value.data.openTime).toISOString();
  }

  if (klineRes.status === "fulfilled" && klineRes.value) {
    if (klineRes.value.data.length >= 15) {
      out.indicators = summarizeIndicators(klineRes.value.data, "1d", out.ticker?.price);
    } else {
      out.indicatorsError = "Not enough daily history to calculate indicators yet.";
    }
  } else if (klineRes.status === "rejected") {
    out.indicatorsError = message(klineRes.reason);
  }

  return out;
}
