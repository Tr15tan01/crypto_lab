"use client";

import { useState } from "react";
import { ChevronDown, Gauge } from "lucide-react";
import { Tooltip } from "@/components/ui/radix";
import { cn, formatCompact, formatPercent, formatPrice } from "@/lib/utils/format";

export interface MarketContextData {
  capturedAt: string;
  fearGreed: { value: number; label: string } | null;
  btc: { price: number; change24hPercent: number | null; change7dPercent: number | null; aboveSma50: boolean | null; aboveSma200: boolean | null } | null;
  coin: {
    price: number;
    change24hPercent: number | null;
    change7dPercent: number | null;
    change30dPercent: number | null;
    rsi14: number | null;
    volumeVsAverage: number | null;
    vsEma50Percent: number | null;
    vsEma200Percent: number | null;
    atrPercent: number | null;
    rangePosition90dPercent: number | null;
    quoteVolume24h: number;
  } | null;
  scorecard: { composite: number; label: string } | null;
  model: { probability: number; trust: number } | null;
  futures: { fundingRatePercent: number | null; longAccountsPercent: number | null } | null;
}

function moodTone(v: number) {
  return v <= 25 ? "text-down" : v >= 75 ? "text-up" : v < 45 ? "text-warn" : "text-fg";
}

function Chip({ label, children, tip }: { label: string; children: React.ReactNode; tip?: string }) {
  const body = (
    <span className="inline-flex items-center gap-1 rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-[0.6875rem]">
      <span className="text-faint">{label}</span>
      <span className="num">{children}</span>
    </span>
  );
  return tip ? <Tooltip content={tip}><span className="cursor-help">{body}</span></Tooltip> : body;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-muted">{label}</span>
      <span className="num text-right">{value}</span>
    </div>
  );
}

const pct = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? "—" : formatPercent(v, { digits }));

/**
 * Market conditions captured at a decision or watchlist addition: a row of key chips with an
 * expandable full view. `title` names the moment ("At decision", "When added").
 */
export function MarketContextView({ ctx, title = "Market at the time", defaultOpen = false }: { ctx: MarketContextData; title?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const c = ctx.coin;
  return (
    <div className="rounded-md border border-border bg-surface-2/40 px-2.5 py-2">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1.5 text-left" aria-expanded={open}>
        <Gauge className="size-3.5 shrink-0 text-muted" />
        <span className="text-[0.6875rem] font-medium text-muted">{title}</span>
        <span className="flex flex-1 flex-wrap items-center gap-1">
          {ctx.fearGreed ? (
            <Chip label="Fear & Greed" tip={ctx.fearGreed.label}>
              <span className={moodTone(ctx.fearGreed.value)}>{ctx.fearGreed.value}</span>
            </Chip>
          ) : null}
          {ctx.btc ? (
            <Chip label="BTC 24h">
              <span className={(ctx.btc.change24hPercent ?? 0) >= 0 ? "text-up" : "text-down"}>{pct(ctx.btc.change24hPercent)}</span>
            </Chip>
          ) : null}
          {c?.rsi14 != null ? <Chip label="RSI">{c.rsi14.toFixed(0)}</Chip> : null}
          {ctx.scorecard ? (
            <Chip label="Score" tip={ctx.scorecard.label}>
              <span className={ctx.scorecard.composite >= 0 ? "text-up" : "text-down"}>
                {ctx.scorecard.composite > 0 ? "+" : ""}
                {ctx.scorecard.composite}
              </span>
            </Chip>
          ) : null}
          {ctx.model ? <Chip label="Model" tip="Chance to beat BTC over 7 days">{Math.round(ctx.model.probability * 100)}%</Chip> : null}
        </span>
        <ChevronDown className={cn("size-3.5 shrink-0 text-faint transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="mt-2 grid gap-x-6 gap-y-1 border-t border-border pt-2 text-[0.6875rem] sm:grid-cols-3">
          <div>
            <p className="label-caps mb-0.5">Market</p>
            <Row label="Fear & Greed" value={ctx.fearGreed ? <span className={moodTone(ctx.fearGreed.value)}>{ctx.fearGreed.value} · {ctx.fearGreed.label}</span> : "—"} />
            <Row label="BTC price" value={ctx.btc ? formatPrice(ctx.btc.price) : "—"} />
            <Row label="BTC 24h / 7d" value={ctx.btc ? `${pct(ctx.btc.change24hPercent)} / ${pct(ctx.btc.change7dPercent)}` : "—"} />
            <Row
              label="BTC trend"
              value={
                ctx.btc?.aboveSma200 == null
                  ? "—"
                  : `${ctx.btc.aboveSma200 ? "above" : "below"} 200d${ctx.btc.aboveSma50 != null ? `, ${ctx.btc.aboveSma50 ? "above" : "below"} 50d` : ""}`
              }
            />
          </div>
          <div>
            <p className="label-caps mb-0.5">The coin</p>
            <Row label="Price" value={c ? formatPrice(c.price) : "—"} />
            <Row label="24h / 7d / 30d" value={c ? `${pct(c.change24hPercent)} / ${pct(c.change7dPercent)} / ${pct(c.change30dPercent)}` : "—"} />
            <Row label="RSI(14)" value={c?.rsi14 ?? "—"} />
            <Row label="vs 50 / 200-day avg" value={c ? `${pct(c.vsEma50Percent)} / ${pct(c.vsEma200Percent)}` : "—"} />
            <Row label="In 90-day range" value={c?.rangePosition90dPercent != null ? `${c.rangePosition90dPercent}%` : "—"} />
          </div>
          <div>
            <p className="label-caps mb-0.5">Activity & signals</p>
            <Row label="Volume vs usual" value={c?.volumeVsAverage != null ? `${c.volumeVsAverage.toFixed(2)}×` : "—"} />
            <Row label="24h volume" value={c ? formatCompact(c.quoteVolume24h) : "—"} />
            <Row label="Volatility (ATR)" value={c?.atrPercent != null ? `${c.atrPercent.toFixed(1)}%/day` : "—"} />
            <Row label="Scorecard" value={ctx.scorecard ? `${ctx.scorecard.composite > 0 ? "+" : ""}${ctx.scorecard.composite} ${ctx.scorecard.label}` : "—"} />
            <Row label="Model (beat BTC 7d)" value={ctx.model ? `${Math.round(ctx.model.probability * 100)}% · trust ${Math.round(ctx.model.trust * 100)}%` : "—"} />
            <Row
              label="Funding / longs"
              value={ctx.futures ? `${ctx.futures.fundingRatePercent != null ? `${ctx.futures.fundingRatePercent.toFixed(3)}%` : "—"} / ${ctx.futures.longAccountsPercent != null ? `${ctx.futures.longAccountsPercent.toFixed(0)}%` : "—"}` : "—"}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
