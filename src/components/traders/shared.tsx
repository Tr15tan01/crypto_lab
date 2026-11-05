import { Badge } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/radix";

/** Tiny inline trend line; colour follows the overall direction. */
export function Sparkline({ values, width = 96, height = 26 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span className="text-xs text-faint">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join(" ");
  const up = values[values.length - 1]! >= values[0]!;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="overflow-visible">
      <path d={d} fill="none" stroke={up ? "var(--color-up)" : "var(--color-down)"} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

export function formatHours(h: number | null | undefined): string {
  if (h === null || h === undefined || !Number.isFinite(h)) return "—";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

/** Futures quote some small-priced coins in multiples: "1000PEPEUSDT" trades as "PEPEUSDT" on spot. */
export function spotSymbol(futures: string) {
  return futures.toUpperCase().replace(/^(1000000|100000|10000|1000|1M)(?=[A-Z])/, "");
}

export function StrategyBadge({ status, score }: { status: "changing" | "stable" | "insufficient_data"; score?: number }) {
  if (status === "insufficient_data") {
    return (
      <Tooltip content="Needs at least 3 trades in the last 14 days and 3 in the 14–90 days before.">
        <span className="cursor-help text-[0.6875rem] text-faint">not enough trades</span>
      </Tooltip>
    );
  }
  return status === "changing" ? (
    <Badge tone="warn" title={`Change score ${score ?? 0}/100`}>Changing</Badge>
  ) : (
    <Badge tone="neutral">Stable</Badge>
  );
}

export function initials(name: string) {
  const clean = name.replace(/[^\p{L}\p{N} ]/gu, "").trim();
  return (clean.split(/\s+/).map((w) => w[0]).join("").slice(0, 2) || name.slice(0, 2)).toUpperCase();
}
