"use client";

import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, Clock, MinusCircle, XCircle } from "lucide-react";
import { Tooltip } from "@/components/ui/radix";
import { cn, formatDateTime, formatPercent, formatPrice } from "@/lib/utils/format";

export interface Prediction {
  _id: string;
  conversationId: string;
  messageId: string;
  symbol: string;
  bias: "bullish" | "neutral" | "bearish";
  confidence: number;
  horizon: "24h" | "7d" | "30d";
  priceAtPrediction: number;
  entry: { low: number; high: number } | null;
  target: number | null;
  stop: number | null;
  compositeScore: number | null;
  timestamp: string;
  dueAt: string;
  evaluation: {
    endPrice: number;
    returnPercent: number;
    maxUpsidePercent: number;
    maxDownsidePercent: number;
    outcome: "correct" | "incorrect" | "inconclusive" | "not_evaluated";
    levelHit: "target" | "stop" | "none" | null;
  } | null;
}

const BIAS = {
  bullish: { label: "Bullish", icon: ArrowUpRight, chip: "bg-up/10 text-up", bar: "bg-up", border: "border-up/30" },
  bearish: { label: "Bearish", icon: ArrowDownRight, chip: "bg-down/10 text-down", bar: "bg-down", border: "border-down/30" },
  neutral: { label: "Neutral", icon: ArrowRight, chip: "bg-surface-3 text-muted", bar: "bg-muted", border: "border-border-strong" },
} as const;

/** "in 3d" / "in 5h" for a future time; formatRelative only handles the past. */
export function timeUntil(value: string, now = Date.now()) {
  const s = Math.round((new Date(value).getTime() - now) / 1000);
  if (s <= 60) return "shortly";
  if (s < 3600) return `in ${Math.ceil(s / 60)}m`;
  if (s < 86400) return `in ${Math.round(s / 3600)}h`;
  return `in ${Math.round(s / 86400)}d`;
}

function pctFrom(price: number, level: number) {
  return ((level - price) / price) * 100;
}

export function riskReward(p: Pick<Prediction, "bias" | "priceAtPrediction" | "target" | "stop">): number | null {
  if (p.target === null || p.stop === null || p.bias === "neutral") return null;
  const reward = Math.abs(p.target - p.priceAtPrediction);
  const risk = Math.abs(p.priceAtPrediction - p.stop);
  return risk > 0 ? reward / risk : null;
}

export function OutcomeBadge({ p, compact = false }: { p: Prediction; compact?: boolean }) {
  const ev = p.evaluation;
  if (!ev) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-faint">
        <Clock className="size-3" /> {compact ? "pending" : `Pending · scored ${timeUntil(p.dueAt)}`}
      </span>
    );
  }
  const map = {
    correct: { icon: CheckCircle2, cls: "text-up", label: "Correct" },
    incorrect: { icon: XCircle, cls: "text-down", label: "Wrong" },
    inconclusive: { icon: MinusCircle, cls: "text-muted", label: "Inconclusive" },
    not_evaluated: { icon: MinusCircle, cls: "text-muted", label: "Not scored" },
  }[ev.outcome];
  const Icon = map.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium", map.cls)}>
      <Icon className="size-3" /> {map.label}
      {compact ? null : <span className="font-normal text-muted">· {formatPercent(ev.returnPercent)}</span>}
    </span>
  );
}

function Level({ label, value, price, tone }: { label: string; value: string; price?: number | null; tone?: "up" | "down" }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-faint">{label}</p>
      <p className={cn("truncate font-mono text-[12.5px] tabular-nums", tone === "up" && "text-up", tone === "down" && "text-down")}>
        {value}
        {price !== undefined && price !== null ? <span className="ml-1 text-[10.5px] text-muted">{formatPercent(price, { digits: 1 })}</span> : null}
      </p>
    </div>
  );
}

/** The structured call behind an assistant reply: bias, probability, levels and its live score. */
export function VerdictCard({ p }: { p: Prediction }) {
  const b = BIAS[p.bias];
  const Icon = b.icon;
  const rr = riskReward(p);
  const ev = p.evaluation;
  const price = p.priceAtPrediction;
  return (
    <div className={cn("mb-3 rounded-lg border bg-surface-2 p-3", b.border)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold", b.chip)}>
            <Icon className="size-3.5" /> {b.label}
          </span>
          <Link href={`/crypto/${p.symbol}`} className="text-[13px] font-medium hover:text-accent">{p.symbol}</Link>
          <span className="text-xs text-muted">next {p.horizon}</span>
        </div>
        <OutcomeBadge p={p} />
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <span className="w-20 text-[11px] text-muted">Confidence</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3" role="meter" aria-valuemin={50} aria-valuemax={100} aria-valuenow={p.confidence} aria-label="Confidence">
          {/* 50 % is a coin flip, so the bar starts there. */}
          <div className={cn("h-full rounded-full", b.bar)} style={{ width: `${Math.max(4, ((p.confidence - 50) / 50) * 100)}%` }} />
        </div>
        <span className="w-9 text-right font-mono text-xs tabular-nums">{p.confidence}%</span>
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-6">
        <Level label="Price at call" value={formatPrice(price)} />
        <Level label="Entry" value={p.entry ? `${formatPrice(p.entry.low)}–${formatPrice(p.entry.high)}` : "—"} />
        <Level label="Target" value={formatPrice(p.target)} price={p.target !== null ? pctFrom(price, p.target) : null} tone="up" />
        <Level label="Stop" value={formatPrice(p.stop)} price={p.stop !== null ? pctFrom(price, p.stop) : null} tone="down" />
        <Level label="Risk/reward" value={rr !== null ? `${rr.toFixed(1)} : 1` : "—"} />
        <Level label="Scorecard" value={p.compositeScore !== null ? `${p.compositeScore > 0 ? "+" : ""}${p.compositeScore}` : "—"} />
      </div>

      {ev ? (
        <p className="mt-2.5 border-t border-border pt-2 text-[11px] text-muted">
          Closed at {formatPrice(ev.endPrice)} ({formatPercent(ev.returnPercent)}) after {p.horizon}; range in window{" "}
          {formatPercent(ev.maxDownsidePercent, { digits: 1 })} / {formatPercent(ev.maxUpsidePercent, { digits: 1 })}.
          {ev.levelHit === "target" ? " Target was reached first." : ev.levelHit === "stop" ? " Stop was reached first." : ev.levelHit === "none" ? " Neither target nor stop was reached." : ""}
        </p>
      ) : (
        <p className="mt-2.5 border-t border-border pt-2 text-[11px] text-faint">
          <Tooltip content={<span>Scored close-to-close at {formatDateTime(p.dueAt)}. Directional calls need a move beyond the horizon threshold; smaller moves count as inconclusive.</span>}>
            <span className="cursor-help underline decoration-dotted underline-offset-2">Tracked call</span>
          </Tooltip>{" "}
          — scored automatically {timeUntil(p.dueAt)} and added to the AI track record.
        </p>
      )}
    </div>
  );
}
