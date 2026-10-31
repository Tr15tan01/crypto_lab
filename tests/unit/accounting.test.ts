import { describe, expect, it } from "vitest";
import { EMPTY_POSITION, computeBuy, computeSell, previewBuy } from "@/services/portfolio/accounting";

describe("computeBuy (average cost basis)", () => {
  it("buys with fees capitalised into cost basis", () => {
    const r = computeBuy(EMPTY_POSITION, { quoteAmount: 100, price: 50, feeRatePercent: 0.1 });
    expect(r.grossAmount).toBe(100);
    expect(r.fee).toBe(0.1);
    expect(r.total).toBe(100.1);
    expect(r.quantity).toBe(2);
    expect(r.position.quantity).toBe(2);
    expect(r.position.investedValue).toBe(100.1);
    expect(r.position.averageCost).toBeCloseTo(50.05, 10);
  });

  it("averages multiple purchases", () => {
    const a = computeBuy(EMPTY_POSITION, { quoteAmount: 100, price: 100, feeRatePercent: 0 });
    const b = computeBuy(a.position, { quoteAmount: 100, price: 50, feeRatePercent: 0 });
    expect(b.position.quantity).toBe(3);
    expect(b.position.investedValue).toBe(200);
    expect(b.position.averageCost).toBeCloseTo(66.6666666667, 8);
    expect(b.averageCostBefore).toBe(100);
  });

  it("rejects invalid input", () => {
    expect(() => computeBuy(EMPTY_POSITION, { quoteAmount: 0, price: 1, feeRatePercent: 0 })).toThrow();
    expect(() => computeBuy(EMPTY_POSITION, { quoteAmount: 0.5, price: 1, feeRatePercent: 0 })).toThrow(/minimum/);
    expect(() => computeBuy(EMPTY_POSITION, { quoteAmount: 10, price: NaN, feeRatePercent: 0 })).toThrow();
    expect(() => computeBuy(EMPTY_POSITION, { quoteAmount: 10, price: 1, feeRatePercent: 10 })).toThrow(/Fee/);
  });

  it("handles very small prices without losing quantity", () => {
    const r = computeBuy(EMPTY_POSITION, { quoteAmount: 10, price: 0.00001234, feeRatePercent: 0.1 });
    expect(r.quantity).toBeCloseTo(810372.771474878, 4);
  });
});

describe("computeSell", () => {
  const bought = computeBuy(EMPTY_POSITION, { quoteAmount: 1000, price: 100, feeRatePercent: 0.1 }).position;
  // 10 units, invested 1001, avg 100.1

  it("realises profit on a partial sale and keeps average cost", () => {
    const r = computeSell(bought, { quantity: 4, price: 120, feeRatePercent: 0.1 });
    expect(r.grossAmount).toBe(480);
    expect(r.fee).toBe(0.48);
    expect(r.total).toBe(479.52);
    expect(r.costBasisSold).toBeCloseTo(400.4, 8);
    expect(r.realizedPnL).toBeCloseTo(79.12, 8);
    expect(r.position.quantity).toBe(6);
    expect(r.position.averageCost).toBe(bought.averageCost);
    expect(r.position.investedValue).toBeCloseTo(600.6, 8);
    expect(r.returnPercent).toBeCloseTo((79.12 / 400.4) * 100, 6);
  });

  it("closes the full position with sellAll and leaves no residue", () => {
    const r = computeSell(bought, { sellAll: true, price: 90, feeRatePercent: 0.1 });
    expect(r.quantity).toBe(10);
    expect(r.costBasisSold).toBe(1001);
    expect(r.realizedPnL).toBeCloseTo(900 - 0.9 - 1001, 8);
    expect(r.position).toMatchObject({ quantity: 0, investedValue: 0, averageCost: 0 });
  });

  it("treats a sale leaving only dust as closing the position", () => {
    const r = computeSell(bought, { quantity: 10 - 1e-12, price: 100, feeRatePercent: 0 });
    expect(r.position.quantity).toBe(0);
    expect(r.costBasisSold).toBe(1001);
  });

  it("rejects overselling and selling without a position", () => {
    expect(() => computeSell(bought, { quantity: 11, price: 100, feeRatePercent: 0 })).toThrow(/more than you hold/);
    expect(() => computeSell(EMPTY_POSITION, { quantity: 1, price: 100, feeRatePercent: 0 })).toThrow(/no open position/);
  });

  it("accumulates realised PnL across sales", () => {
    const s1 = computeSell(bought, { quantity: 5, price: 110, feeRatePercent: 0 });
    const s2 = computeSell(s1.position, { sellAll: true, price: 90, feeRatePercent: 0 });
    expect(s2.position.realizedPnL).toBeCloseTo(s1.realizedPnL + s2.realizedPnL, 8);
    expect(s1.realizedPnL + s2.realizedPnL).toBeCloseTo(550 + 450 - 1001, 8);
  });
});

describe("previewBuy", () => {
  it("matches computeBuy", () => {
    const p = previewBuy(250, 12.5, 0.1);
    const c = computeBuy(EMPTY_POSITION, { quoteAmount: 250, price: 12.5, feeRatePercent: 0.1 });
    expect(p).toEqual({ quantity: c.quantity, fee: c.fee, total: c.total });
  });
});
