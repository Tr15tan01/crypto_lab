import { describe, expect, it } from "vitest";
import { analyzePair, benchmarkReturns } from "@/services/discovery/screens";
import { scanUniverse } from "@/services/discovery/discovery-service";
import type { Kline } from "@/services/binance/schemas";
import type { MarketTicker } from "@/services/binance/market-data";

const DAY = 24 * 60 * 60_000;
const NOW = Date.UTC(2026, 9, 31, 12);
const TODAY = Date.UTC(2026, 9, 31);

/** Daily candles ending with today's still-forming candle. `closes[i]` is day i's close; volumes default to 1M. */
function candles(closes: number[], volumes?: number[]): Kline[] {
  const start = TODAY - (closes.length - 1) * DAY;
  return closes.map((c, i) => ({
    openTime: start + i * DAY,
    open: c,
    high: c * 1.01,
    low: c * 0.99,
    close: c,
    volume: 1,
    closeTime: start + (i + 1) * DAY - 1,
    quoteVolume: volumes?.[i] ?? 1_000_000,
    trades: 100,
  }));
}

function ticker(price: number, over: Partial<MarketTicker> = {}): MarketTicker {
  return {
    symbol: "TESTUSDT",
    baseAsset: "TEST",
    quoteAsset: "USDT",
    name: null,
    price,
    priceChange: 0,
    priceChangePercent: 0,
    open: price,
    high: price,
    low: price,
    weightedAvgPrice: price,
    volume: 1,
    quoteVolume: 5_000_000,
    tradeCount: 100,
    openTime: NOW - DAY,
    closeTime: NOW,
    ...over,
  };
}

const opts = { now: NOW, historyLimit: 300, benchmark: { return7d: 0, return30d: 0 } };

describe("analyzePair", () => {
  it("dates a new listing from the first candle when history is shorter than requested", () => {
    const row = analyzePair(ticker(1), candles(new Array(20).fill(1)), opts);
    expect(row.listedDays).toBe(19);
    expect(row.signals).toContain("new_listing");
  });

  it("does not claim a listing date when the full window is returned", () => {
    const row = analyzePair(ticker(1), candles(new Array(300).fill(1)), opts);
    expect(row.firstTradeAt).toBeNull();
    expect(row.signals).not.toContain("new_listing");
  });

  it("measures 24h volume against the 30-day median", () => {
    const row = analyzePair(ticker(1, { quoteVolume: 3_000_000 }), candles(new Array(300).fill(1)), opts);
    expect(row.volumeRatio).toBeCloseTo(3, 10);
    expect(row.signals).toContain("volume_surge");
  });

  it("computes relative strength against the benchmark", () => {
    // Up 20% over 30 days while BTC is up 10%: (1.2 / 1.1 − 1) ≈ 9.09%.
    const closes = new Array(300).fill(100);
    const row = analyzePair(ticker(120), candles(closes), { ...opts, benchmark: { return7d: 0, return30d: 10 } });
    expect(row.return30d).toBeCloseTo(20, 10);
    expect(row.vsBtc30d).toBeCloseTo(9.0909, 3);
    expect(row.signals).not.toContain("outperforming_btc"); // needs ≥ 10% vs BTC over 30 days
  });

  it("flags a recent golden cross", () => {
    // Flat (SMA 50 = SMA 200), then five closes higher: the 50-day pulls above on the first of them.
    const closes = [...new Array(290).fill(100), ...new Array(5).fill(110)];
    const row = analyzePair(ticker(110), candles([...closes, 110]), opts);
    expect(row.goldenCrossDaysAgo).toBe(4);
    expect(row.signals).toContain("golden_cross");

    const old = [...new Array(270).fill(100), ...new Array(25).fill(110)];
    expect(analyzePair(ticker(110), candles([...old, 110]), opts).goldenCrossDaysAgo).toBeNull();
  });

  it("flags a breakout above the 90-day high", () => {
    const row = analyzePair(ticker(1.2), candles(new Array(300).fill(1)), opts);
    expect(row.high90d).toBeCloseTo(1.01, 10);
    expect(row.signals).toContain("breakout");
  });

  it("flags an oversold bounce", () => {
    // Steady fall drives RSI to the floor; then a strong rally lifts it back above 40.
    const closes = [...new Array(250).fill(100), ...Array.from({ length: 40 }, (_, i) => 100 - i * 1.5), 45, 47, 50, 54, 58, 62];
    const row = analyzePair(ticker(66), candles([...closes, 66]), opts);
    expect(row.rsiLow!).toBeLessThanOrEqual(30);
    expect(row.rsi14!).toBeGreaterThanOrEqual(40);
    expect(row.signals).toContain("oversold_bounce");
  });

  it("adds cautions for thin liquidity and a run-up", () => {
    const closes = new Array(300).fill(1);
    const row = analyzePair(ticker(1.6, { quoteVolume: 300_000 }), candles(closes), opts);
    expect(row.cautions.some((c) => c.startsWith("Thin liquidity"))).toBe(true);
    expect(row.cautions.some((c) => c.startsWith("Already up 60%"))).toBe(true);
  });

  it("excludes today's forming candle from closed-candle statistics", () => {
    const series = candles(new Array(300).fill(1));
    series[series.length - 1] = { ...series[series.length - 1]!, high: 50, quoteVolume: 1e12 };
    const row = analyzePair(ticker(1), series, opts);
    expect(row.high90d).toBeCloseTo(1.01, 10);
    expect(row.volumeRatio).toBeCloseTo(5, 10);
  });
});

describe("benchmarkReturns", () => {
  it("uses closed candles and the live price", () => {
    const b = benchmarkReturns(110, candles(new Array(40).fill(100)), NOW);
    expect(b.return7d).toBeCloseTo(10, 10);
    expect(b.return30d).toBeCloseTo(10, 10);
  });
});

describe("scanUniverse", () => {
  it("keeps liquid USDT pairs, drops stablecoins, and sorts by volume", () => {
    const t = (symbol: string, baseAsset: string, quoteAsset: string, quoteVolume: number) =>
      ticker(1, { symbol, baseAsset, quoteAsset, quoteVolume });
    const out = scanUniverse([
      t("AUSDT", "A", "USDT", 1_000_000),
      t("BUSDT", "B", "USDT", 9_000_000),
      t("USDCUSDT", "USDC", "USDT", 50_000_000),
      t("CBTC", "C", "BTC", 9_000_000),
      t("DUSDT", "D", "USDT", 10_000),
    ]);
    expect(out.map((x) => x.symbol)).toEqual(["BUSDT", "AUSDT"]);
  });
});
