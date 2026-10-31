/** Round half away from zero to `dp` decimal places, avoiding binary float artefacts. */
export function round(value: number, dp: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** dp;
  const shifted = Math.abs(value) * factor;
  const r = Math.round(Number(shifted.toPrecision(15))) / factor;
  return value < 0 ? -r : r;
}

export const QUOTE_DP = 8;
export const QTY_DP = 10;

export function roundQuote(v: number) {
  return round(v, QUOTE_DP);
}

export function roundQty(v: number) {
  return round(v, QTY_DP);
}

export function pctChange(from: number, to: number): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return ((to - from) / from) * 100;
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
