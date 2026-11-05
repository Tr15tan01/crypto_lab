import { ArrowDownRight, ArrowUpRight, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { cn, formatDateTime, formatPercent, formatRelative, formatUsd } from "@/lib/utils/format";

/** Signed change with an arrow, so direction never relies on colour alone. */
export function ChangeText({
  value,
  className,
  format = "percent",
  showIcon = true,
}: {
  value: number | null | undefined;
  className?: string;
  format?: "percent" | "usd";
  showIcon?: boolean;
}) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className={cn("num text-faint", className)}>—</span>;
  }
  const up = value > 0;
  const down = value < 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("num inline-flex items-center gap-0.5", up && "text-up", down && "text-down", !up && !down && "text-muted", className)}>
      {showIcon && (up || down) ? <Icon className="size-3 shrink-0" aria-hidden /> : null}
      {format === "usd" ? formatUsd(value, { sign: true }) : formatPercent(value)}
    </span>
  );
}

/** Tells the user whether market data is live, and when it was last refreshed. */
export function Freshness({
  fetchedAt,
  stale,
  className,
}: {
  fetchedAt: string | number | null | undefined;
  stale: boolean | undefined;
  className?: string;
}) {
  if (!fetchedAt) {
    return (
      <Badge tone="down" className={className}>
        <TriangleAlert className="size-3" /> No market data
      </Badge>
    );
  }
  if (stale) {
    return (
      <Badge tone="warn" className={className} title={`Last successful update ${formatDateTime(fetchedAt)}`}>
        <TriangleAlert className="size-3" /> Stale · {formatRelative(fetchedAt)}
      </Badge>
    );
  }
  return (
    <span className={cn("text-[0.6875rem] text-faint", className)} title={formatDateTime(fetchedAt)}>
      Binance · updated {new Date(fetchedAt).toLocaleTimeString("en-US", { hour12: false })}
    </span>
  );
}

export function ListingBadge({ listing }: { listing: "tradable" | "not_tradable" | "not_listed" | "unknown" | boolean | null }) {
  if (listing === "tradable" || listing === true) return <Badge tone="up">Tradable on Binance</Badge>;
  if (listing === "not_tradable" || listing === false) return <Badge tone="down">Not tradable on Binance</Badge>;
  if (listing === "not_listed") return <Badge tone="down">Not listed on Binance Spot</Badge>;
  return <Badge>Status unknown</Badge>;
}

export function Stat({
  label,
  value,
  sub,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="label-caps">{label}</p>
      <div className="num mt-1.5 truncate text-lg font-medium tracking-tight text-fg">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}
