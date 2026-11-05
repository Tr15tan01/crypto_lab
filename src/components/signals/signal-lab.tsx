"use client";

import Link from "next/link";
import { useState } from "react";
import { FlaskConical, TriangleAlert } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { Badge, EmptyState, Notice, Panel, PanelHeader, Skeleton } from "@/components/ui/primitives";
import { Segmented, Tooltip } from "@/components/ui/radix";
import { ChangeText, Freshness } from "@/components/market/indicators";
import { SIGNAL_INFO, type DiscoverySignal } from "@/services/discovery/signals";
import { cn, formatDate, formatPercent } from "@/lib/utils/format";

interface Stats {
  horizonDays: number;
  events: number;
  winRatePercent: number;
  medianReturnPercent: number;
  meanReturnPercent: number;
  meanVsBtcPercent: number;
  tStat: number;
  p10ReturnPercent: number;
  p90ReturnPercent: number;
}

interface Payload {
  pairs: number;
  universe: number;
  from: number | null;
  to: number | null;
  results: Array<{ key: string; stats: Stats[] }>;
  firing: Record<string, Array<{ symbol: string; baseAsset: string; change24h: number }>>;
  fetchedAt: string;
  stale: boolean;
}

const LABELS: Record<string, string> = {
  two_plus: "Two or more signals",
  baseline: "Baseline: any liquid coin, any day",
};

function verdict(s: Stats | undefined, baseline: Stats | undefined) {
  if (!s || s.events < 30) return { label: "Too few events", tone: "neutral" as const };
  const beatsBase = baseline ? s.winRatePercent - baseline.winRatePercent : 0;
  if (s.tStat >= 2 && s.meanVsBtcPercent > 0) return { label: "Proven edge", tone: "up" as const };
  if (s.tStat <= -2 && s.meanVsBtcPercent < 0) return { label: "Historically harmful", tone: "down" as const };
  if (s.tStat >= 1.5 || beatsBase >= 3) return { label: "Weak edge", tone: "accent" as const };
  if (s.tStat <= -1.5 || beatsBase <= -3) return { label: "Weak negative", tone: "warn" as const };
  return { label: "No edge", tone: "neutral" as const };
}

function EdgeBar({ value, max }: { value: number; max: number }) {
  const w = max > 0 ? Math.min(50, (Math.abs(value) / max) * 50) : 0;
  return (
    <div className="relative h-1.5 w-24 overflow-hidden rounded-full bg-surface-3" aria-hidden>
      <div className="absolute inset-y-0 left-1/2 w-px bg-border-strong" />
      <div className={cn("absolute inset-y-0 rounded-full", value >= 0 ? "left-1/2 bg-up" : "right-1/2 bg-down")} style={{ width: `${w}%` }} />
    </div>
  );
}

const th = "px-3 py-2 text-left text-[0.6875rem] font-medium text-muted whitespace-nowrap";
const td = "px-3 py-2 whitespace-nowrap";

export function SignalLab() {
  const [h, setH] = useState<"7" | "30">("7");
  const { data, error, loading } = useApi<Payload>("/api/backtest");
  const horizon = Number(h);

  if (loading) {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-xs text-muted"><FlaskConical className="size-3.5 animate-pulse-soft" /> Loading ~2.5 years of daily candles for 100 pairs and replaying every signal… (first run up to a minute, then cached for 12 hours)</p>
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
      </div>
    );
  }
  if (error || !data) return <Notice tone="down" title="Backtest unavailable">{error?.message}</Notice>;

  const statOf = (key: string) => data.results.find((r) => r.key === key)?.stats.find((s) => s.horizonDays === horizon);
  const baseline = statOf("baseline");
  const ordered = data.results
    .filter((r) => r.key !== "baseline")
    .sort((a, b) => (statOf(b.key)?.meanVsBtcPercent ?? -99) - (statOf(a.key)?.meanVsBtcPercent ?? -99));
  const maxEdge = Math.max(1, ...data.results.map((r) => Math.abs(statOf(r.key)?.meanVsBtcPercent ?? 0)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Holding period" value={h} onChange={setH} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }]} />
        <span className="text-[0.6875rem] text-muted">
          {data.pairs} pairs · {data.from ? formatDate(data.from) : "—"} → {data.to ? formatDate(data.to) : "—"}
        </span>
        <div className="ml-auto"><Freshness fetchedAt={data.fetchedAt} stale={data.stale} /></div>
      </div>

      <Panel>
        <PanelHeader
          title={`What happened ${horizon} days after each signal fired`}
          description="Entry at the daily close on the first day a signal fires (re-fires within 5 days are not counted again). Sorted by average result vs BTC."
        />
        <div className="overflow-x-auto">
          <table className="w-full text-[0.8125rem]">
            <thead className="border-b border-border bg-surface-2/50">
              <tr>
                <th className={th}>Signal</th>
                <th className={cn(th, "text-right")}>Events</th>
                <th className={cn(th, "text-right")}>Win rate</th>
                <th className={cn(th, "text-right")}>Median</th>
                <th className={cn(th, "text-right")}>Range (10–90%)</th>
                <th className={cn(th, "text-right")}>
                  <Tooltip content="Average return minus BTC's return over the same days. Positive = the signal picked coins that beat simply holding BTC.">
                    <span className="cursor-help underline decoration-dotted underline-offset-2">vs BTC</span>
                  </Tooltip>
                </th>
                <th className={th} />
                <th className={cn(th, "text-right")}>
                  <Tooltip content="t-statistic of the vs-BTC result. Around ±2 or beyond is unlikely to be luck; near 0 means noise.">
                    <span className="cursor-help underline decoration-dotted underline-offset-2">Confidence (t)</span>
                  </Tooltip>
                </th>
                <th className={th}>Verdict</th>
                <th className={th}>Firing now</th>
              </tr>
            </thead>
            <tbody>
              {[...ordered, ...data.results.filter((r) => r.key === "baseline")].map((r) => {
                const s = statOf(r.key);
                const v = r.key === "baseline" ? { label: "Reference", tone: "info" as const } : verdict(s, baseline);
                const info = SIGNAL_INFO[r.key as DiscoverySignal];
                const now = data.firing[r.key] ?? [];
                return (
                  <tr key={r.key} className={cn("border-b border-border last:border-0", r.key === "baseline" && "bg-surface-2/40")}>
                    <td className={td}>
                      <span className="font-medium" title={info?.description}>{info?.label ?? LABELS[r.key] ?? r.key}</span>
                    </td>
                    <td className={cn(td, "num text-right")}>{s?.events ?? 0}</td>
                    <td className={cn(td, "num text-right", baseline && s && s.winRatePercent > baseline.winRatePercent + 2 ? "text-up" : baseline && s && s.winRatePercent < baseline.winRatePercent - 2 ? "text-down" : "")}>
                      {formatPercent(s?.winRatePercent, { sign: false, digits: 0 })}
                    </td>
                    <td className={cn(td, "text-right")}><ChangeText value={s?.medianReturnPercent} showIcon={false} /></td>
                    <td className={cn(td, "num text-right text-xs text-muted")}>
                      {s ? `${formatPercent(s.p10ReturnPercent, { digits: 0 })} … ${formatPercent(s.p90ReturnPercent, { digits: 0 })}` : "—"}
                    </td>
                    <td className={cn(td, "text-right")}><ChangeText value={s?.meanVsBtcPercent} showIcon={false} /></td>
                    <td className={td}><EdgeBar value={s?.meanVsBtcPercent ?? 0} max={maxEdge} /></td>
                    <td className={cn(td, "num text-right", Math.abs(s?.tStat ?? 0) >= 2 ? "font-semibold" : "text-muted")}>{s ? s.tStat.toFixed(1) : "—"}</td>
                    <td className={td}><Badge tone={v.tone}>{v.label}</Badge></td>
                    <td className={cn(td, "text-xs")}>
                      {now.length ? (
                        <span className="flex flex-wrap gap-1">
                          {now.slice(0, 5).map((c) => (
                            <Link key={c.symbol} href={`/crypto/${c.symbol}`} className="rounded-sm border border-border px-1 py-px font-mono text-[0.65625rem] hover:border-accent/50">
                              {c.baseAsset}
                            </Link>
                          ))}
                          {now.length > 5 ? <Link href="/discover" className="text-[0.65625rem] text-muted hover:text-fg">+{now.length - 5}</Link> : null}
                        </span>
                      ) : (
                        <span className="text-faint">{r.key in data.firing ? "none" : ""}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!data.results.length ? <EmptyState title="No results" /> : null}
      </Panel>

      <Notice tone="warn" title="How to read this">
        <span className="flex items-start gap-1.5">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Compare every row with the baseline: in a falling market even good signals can have negative returns, so &ldquo;vs BTC&rdquo; and the
            win rate relative to baseline matter most. Biases: only coins listed today are tested (delisted losers are missing), no fees or slippage,
            and signals on many coins the same day are not independent. Autopilot uses the 7-day vs-BTC results to weight signals: proven ones
            raise a score, harmful ones lower it.
          </span>
        </span>
      </Notice>
    </div>
  );
}
