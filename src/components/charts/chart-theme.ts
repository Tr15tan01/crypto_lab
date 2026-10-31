/** Chart tokens (validated categorical order — see globals.css). Text never wears series colours. */
export const SERIES = [
  "var(--color-series-1)",
  "var(--color-series-2)",
  "var(--color-series-3)",
  "var(--color-series-4)",
  "var(--color-series-5)",
  "var(--color-series-6)",
  "var(--color-series-7)",
  "var(--color-series-8)",
] as const;

export const CHART = {
  grid: "#1c2027",
  axis: "#5d646e",
  axisText: "#8b929c",
  up: "var(--color-up)",
  down: "var(--color-down)",
  neutral: "#5d646e",
  baseline: "#3a404a",
  surface: "#101216",
  tick: { fill: "#8b929c", fontSize: 11, fontFamily: "var(--font-mono)" },
} as const;

export function formatAxisTime(ms: number, spanMs: number): string {
  const d = new Date(ms);
  if (spanMs <= 2 * 86_400_000) return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (spanMs <= 120 * 86_400_000) return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export function compactNumber(v: number): string {
  return Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 }) : v.toLocaleString("en-US", { maximumSignificantDigits: 4 });
}
