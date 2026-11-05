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

/** Theme-aware: every value is a CSS variable, so charts follow the light/dark switch. */
export const CHART = {
  grid: "var(--color-chart-grid)",
  axis: "var(--color-faint)",
  axisText: "var(--color-muted)",
  up: "var(--color-up)",
  down: "var(--color-down)",
  neutral: "var(--color-faint)",
  baseline: "var(--color-chart-baseline)",
  surface: "var(--color-surface)",
  label: "var(--color-chart-label)",
  muted: "var(--color-chart-muted)",
  cash: "var(--color-chart-cash)",
  hover: "var(--color-hover-overlay)",
  tick: { fill: "var(--color-muted)", fontSize: "0.6875rem", fontFamily: "var(--font-mono)" },
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
