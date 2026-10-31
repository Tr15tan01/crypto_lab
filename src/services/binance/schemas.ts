import { z } from "zod";

/**
 * Validation for Binance public market-data responses.
 * Numeric strings are converted with `finiteNumber`: a value that is missing or not a finite
 * number fails validation instead of silently becoming 0.
 */
const finiteNumber = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const n = typeof v === "number" ? v : Number(v);
  if (typeof v === "string" && v.trim() === "") {
    ctx.addIssue({ code: "custom", message: "empty numeric string" });
    return z.NEVER;
  }
  if (!Number.isFinite(n)) {
    ctx.addIssue({ code: "custom", message: "not a finite number" });
    return z.NEVER;
  }
  return n;
});

export const exchangeSymbolSchema = z.object({
  symbol: z.string().min(1),
  status: z.string(),
  baseAsset: z.string(),
  quoteAsset: z.string(),
  isSpotTradingAllowed: z.boolean().optional(),
  baseAssetPrecision: z.number().optional(),
  quotePrecision: z.number().optional(),
  permissions: z.array(z.string()).optional(),
  permissionSets: z.array(z.array(z.string())).optional(),
});

export const exchangeInfoSchema = z.object({
  serverTime: z.number(),
  symbols: z.array(z.unknown()),
});

export type ExchangeSymbolRaw = z.infer<typeof exchangeSymbolSchema>;

export const ticker24hSchema = z.object({
  symbol: z.string().min(1),
  priceChange: finiteNumber,
  priceChangePercent: finiteNumber,
  weightedAvgPrice: finiteNumber,
  openPrice: finiteNumber,
  highPrice: finiteNumber,
  lowPrice: finiteNumber,
  lastPrice: finiteNumber,
  volume: finiteNumber,
  quoteVolume: finiteNumber,
  openTime: z.number(),
  closeTime: z.number(),
  count: z.number(),
});

export type Ticker24h = z.infer<typeof ticker24hSchema>;

export const klineRowSchema = z
  .tuple([
    z.number(), // open time
    finiteNumber, // open
    finiteNumber, // high
    finiteNumber, // low
    finiteNumber, // close
    finiteNumber, // volume
    z.number(), // close time
    finiteNumber, // quote volume
    z.number(), // trades
  ])
  .rest(z.unknown());

export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
  trades: number;
}

export function parseKlines(raw: unknown): Kline[] {
  const arr = z.array(z.unknown()).parse(raw);
  const out: Kline[] = [];
  for (const row of arr) {
    const r = klineRowSchema.safeParse(row);
    if (!r.success) continue; // skip a malformed candle rather than inventing values
    const [openTime, open, high, low, close, volume, closeTime, quoteVolume, trades] = r.data;
    out.push({ openTime, open, high, low, close, volume, closeTime, quoteVolume, trades });
  }
  return out;
}
