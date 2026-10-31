import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const EM_DASH = "—";

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Price with precision that adapts to magnitude (crypto ranges from 1e-8 to 1e5). */
export function formatPrice(value: number | null | undefined, opts: { currency?: boolean } = {}): string {
  if (!isNum(value)) return EM_DASH;
  const abs = Math.abs(value);
  let digits: number;
  if (abs >= 1000) digits = 2;
  else if (abs >= 1) digits = 4;
  else if (abs >= 0.01) digits = 5;
  else if (abs === 0) digits = 2;
  else digits = Math.min(10, Math.max(6, Math.ceil(-Math.log10(abs)) + 3));
  const s = value.toLocaleString("en-US", { minimumFractionDigits: Math.min(digits, 2), maximumFractionDigits: digits });
  return opts.currency ? `$${s}` : s;
}

export function formatUsd(value: number | null | undefined, opts: { sign?: boolean; compact?: boolean } = {}): string {
  if (!isNum(value)) return EM_DASH;
  const sign = opts.sign && value > 0 ? "+" : value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const body = opts.compact && abs >= 10_000
    ? abs.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 })
    : abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}$${body}`;
}

export function formatPercent(value: number | null | undefined, opts: { sign?: boolean; digits?: number } = {}): string {
  if (!isNum(value)) return EM_DASH;
  const digits = opts.digits ?? 2;
  const sign = opts.sign !== false && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatCompact(value: number | null | undefined): string {
  if (!isNum(value)) return EM_DASH;
  return value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 });
}

export function formatQuantity(value: number | null | undefined): string {
  if (!isNum(value)) return EM_DASH;
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 8;
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function formatDateTime(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined) return EM_DASH;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return EM_DASH;
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined) return EM_DASH;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return EM_DASH;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
}

export function formatRelative(value: Date | string | number | null | undefined, now = Date.now()): string {
  if (value === null || value === undefined) return EM_DASH;
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return EM_DASH;
  const diff = Math.round((now - t) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function changeTone(value: number | null | undefined): "up" | "down" | "flat" {
  if (!isNum(value) || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}
