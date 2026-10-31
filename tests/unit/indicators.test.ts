import { describe, expect, it } from "vitest";
import { atr, bollinger, ema, logReturnStdDev, macd, rsi, sma, swingLevels } from "@/services/indicators/core";
import { summarizeIndicators } from "@/services/indicators/summary";
import type { Kline } from "@/services/binance/schemas";

// Wilder's RSI reference series (StockCharts "RSI" ChartSchool example).
const WILDER = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0,
  46.03, 46.41, 46.22, 45.64, 46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57, 43.42, 42.66,
  43.13,
];

describe("moving averages", () => {
  it("sma", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("ema seeds with sma then smooths", () => {
    const e = ema([1, 2, 3, 4, 5], 3);
    expect(e.slice(0, 2)).toEqual([null, null]);
    expect(e[2]).toBe(2);
    expect(e[3]).toBeCloseTo(3, 10); // 4*0.5 + 2*0.5
    expect(e[4]).toBeCloseTo(4, 10);
  });

  it("returns all nulls without enough data", () => {
    expect(ema([1, 2], 5)).toEqual([null, null]);
  });
});

describe("rsi", () => {
  it("matches the Wilder reference values", () => {
    const r = rsi(WILDER, 14);
    expect(r.slice(0, 14).every((v) => v === null)).toBe(true);
    const expected = [70.46, 66.25, 66.48, 69.35, 66.29, 57.92, 62.88, 63.21, 56.01, 62.34, 54.67, 50.39, 40.02];
    expected.forEach((v, i) => expect(r[14 + i]!).toBeCloseTo(v, 1));
  });

  it("is 100 for strictly rising prices and 50 for flat prices", () => {
    expect(rsi(Array.from({ length: 20 }, (_, i) => i + 1), 14)[19]).toBe(100);
    expect(rsi(new Array(20).fill(5), 14)[19]).toBe(50);
  });
});

describe("macd", () => {
  it("is zero for a flat series", () => {
    const m = macd(new Array(60).fill(10));
    expect(m.macd[59]).toBeCloseTo(0, 12);
    expect(m.signal[59]).toBeCloseTo(0, 12);
    expect(m.histogram[59]).toBeCloseTo(0, 12);
  });

  it("is positive in an uptrend", () => {
    const m = macd(Array.from({ length: 60 }, (_, i) => 100 + i));
    expect(m.macd[59]!).toBeGreaterThan(0);
    expect(m.signal[33]).not.toBeNull();
    expect(m.signal[32]).toBeNull();
  });
});

describe("bollinger", () => {
  it("collapses to the mean for constant prices", () => {
    const b = bollinger(new Array(25).fill(3), 20, 2);
    expect(b.upper[24]).toBe(3);
    expect(b.lower[24]).toBe(3);
  });

  it("uses population standard deviation", () => {
    const b = bollinger([1, 2, 3, 4], 4, 1);
    const sd = Math.sqrt(((1.5 ** 2) * 2 + (0.5 ** 2) * 2) / 4);
    expect(b.upper[3]).toBeCloseTo(2.5 + sd, 10);
  });
});

describe("atr", () => {
  it("averages true range", () => {
    const candles = Array.from({ length: 20 }, () => ({ high: 11, low: 9, close: 10 }));
    expect(atr(candles, 14)[19]).toBeCloseTo(2, 10);
  });
});

describe("volatility and levels", () => {
  it("logReturnStdDev is zero for geometric growth", () => {
    expect(logReturnStdDev([1, 2, 4, 8, 16])).toBeCloseTo(0, 12);
    expect(logReturnStdDev([1])).toBeNull();
  });

  it("finds swing support and resistance around price", () => {
    const series = [5, 6, 7, 8, 7, 6, 5, 4, 5, 6, 7, 6, 5, 4, 3, 4, 5, 6, 7, 8, 9];
    const candles = series.map((c) => ({ high: c + 0.5, low: c - 0.5, close: c }));
    const lv = swingLevels(candles, 6);
    expect(lv.resistance[0]).toBe(7.5);
    expect(lv.support[0]).toBe(3.5);
  });
});

describe("summarizeIndicators", () => {
  const day = 86_400_000;
  const start = Date.now() - 260 * day;
  const klines: Kline[] = Array.from({ length: 250 }, (_, i) => {
    const close = 100 + i * 0.5 + Math.sin(i / 5) * 3;
    return {
      openTime: start + i * day,
      open: close - 1,
      high: close + 2,
      low: close - 2,
      close,
      volume: 1000 + (i % 7) * 100,
      closeTime: start + (i + 1) * day - 1,
      quoteVolume: 0,
      trades: 10,
    };
  });

  it("computes a full summary on closed candles only", () => {
    const formingCandle: Kline = { ...klines[249]!, openTime: Date.now() - 1000, closeTime: Date.now() + day };
    const s = summarizeIndicators([...klines, formingCandle], "1d");
    expect(s.candles).toBe(250);
    expect(s.ema200).not.toBeNull();
    expect(s.warnings).toEqual([]);
    expect(s.signals.find((x) => x.name === "EMA 50 vs 200")?.reading).toBe("bullish");
    expect(s.returns["7d"]).not.toBeNull();
  });

  it("warns when history is short", () => {
    const s = summarizeIndicators(klines.slice(0, 40), "1d");
    expect(s.ema200).toBeNull();
    expect(s.warnings.some((w) => w.includes("EMA(200)"))).toBe(true);
  });
});
