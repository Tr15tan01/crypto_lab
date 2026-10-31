import { z } from "zod";
import { withApi, parseSearchParams } from "@/lib/api/handler";
import { marketData, normalizeSymbol } from "@/services/binance";
import { INTERVALS, PERIODS } from "@/services/binance/intervals";

export const dynamic = "force-dynamic";

const query = z.object({
  interval: z.enum(INTERVALS),
  period: z.enum(PERIODS),
});

export const GET = withApi<{ symbol: string }>(async ({ req, params }) => {
  const symbol = normalizeSymbol(params.symbol);
  const { interval, period } = parseSearchParams(req, query);
  const res = await marketData().klines(symbol, interval, period);
  return {
    symbol,
    interval,
    period,
    // Compact tuples: [openTime, open, high, low, close, volume, closeTime]
    candles: res.data.map((k) => [k.openTime, k.open, k.high, k.low, k.close, k.volume, k.closeTime]),
    fetchedAt: new Date(res.fetchedAt).toISOString(),
    stale: res.stale,
  };
});
