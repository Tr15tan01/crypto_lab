"use client";

import { useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, Gauge as GaugeIcon } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { Panel, PanelBody, PanelHeader, Skeleton } from "@/components/ui/primitives";
import { Segmented } from "@/components/ui/radix";
import { CHART, SERIES } from "@/components/charts/chart-theme";
import { cn, formatDate, formatPercent } from "@/lib/utils/format";

type Source = "autopilot" | "chat" | "model";
type Horizon = "24h" | "7d" | "30d";

interface Payload {
  source: Source;
  horizon: Horizon;
  rule: string;
  accuracy: {
    total: number;
    correct: number;
    incorrect: number;
    inconclusive: number;
    pending: number;
    hitRatePercent: number | null;
    recentHitRatePercent: number | null;
    avgResultPercent: number | null;
    series: Array<{ t: number; cumulative: number; week: number; decided: number }>;
  };
}

const SOURCE_LABEL: Record<Source, string> = { autopilot: "Autopilot calls", chat: "AI chat calls", model: "Model picks" };
const SOURCE_SHORT: Record<Source, string> = { autopilot: "Autopilot", chat: "AI chat", model: "Model" };
const MIN_DECIDED = 10;

function verdict(rate: number | null, decided: number) {
  if (rate === null || decided < MIN_DECIDED) return { label: decided ? `Needs ${MIN_DECIDED - decided} more scored` : "Nothing scored yet", tone: "none" as const };
  if (rate >= 55) return { label: "Better than chance", tone: "up" as const };
  if (rate <= 45) return { label: "Worse than chance", tone: "down" as const };
  return { label: "About a coin flip", tone: "flat" as const };
}

/** Semicircle dial, 0 … 100%, with a tick at 50% (chance). */
function Dial({ value, tone }: { value: number | null; tone: "up" | "down" | "flat" | "none" }) {
  const r = 70;
  const cx = 90;
  const cy = 86;
  const v = value === null ? 0 : Math.max(0, Math.min(100, value));
  const angle = Math.PI * (1 - v / 100);
  const end = { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) };
  const track = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const fill = v > 0 ? `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}` : "";
  const color = tone === "up" ? "var(--color-up)" : tone === "down" ? "var(--color-down)" : tone === "flat" ? "var(--color-accent)" : "var(--color-faint)";
  return (
    <svg viewBox="0 0 180 100" className="w-full max-w-56" role="img" aria-label={value === null ? "No accuracy yet" : `Hit rate ${value.toFixed(0)} percent`}>
      <path d={track} fill="none" stroke="var(--color-surface-3)" strokeWidth={12} strokeLinecap="round" />
      {fill ? <path d={fill} fill="none" stroke={color} strokeWidth={12} strokeLinecap="round" /> : null}
      {/* 50% = chance */}
      <line x1={cx} y1={cy - r - 9} x2={cx} y2={cy - r + 9} stroke="var(--color-fg)" strokeWidth={2} strokeLinecap="round" opacity={0.55} />
      <text x={cx} y={cy - r - 12} textAnchor="middle" fontSize="8" fill="var(--color-muted)">50%</text>
      <text x={cx - r} y={cy + 13} textAnchor="middle" fontSize="8" fill="var(--color-faint)">0</text>
      <text x={cx + r} y={cy + 13} textAnchor="middle" fontSize="8" fill="var(--color-faint)">100</text>
      <text x={cx} y={cy - 8} textAnchor="middle" fontSize="26" fontWeight="600" fill="var(--color-fg)" style={{ fontFamily: "var(--font-mono)" }}>
        {value === null ? "—" : `${Math.round(value)}%`}
      </text>
    </svg>
  );
}

function HistoryChart({ series }: { series: Payload["accuracy"]["series"] }) {
  if (series.length < 2) {
    return <p className="flex h-full min-h-32 items-center justify-center text-center text-xs text-muted">The line over time appears once calls from two different weeks are scored.</p>;
  }
  const lo = Math.max(0, Math.floor(Math.min(...series.map((p) => p.cumulative), 50) / 10) * 10 - 10);
  const hi = Math.min(100, Math.ceil(Math.max(...series.map((p) => p.cumulative), 50) / 10) * 10 + 10);
  return (
    <div role="img" aria-label="Cumulative hit rate by week">
      <ResponsiveContainer width="100%" height={170}>
        <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tick={CHART.tick} tickLine={false} axisLine={{ stroke: CHART.baseline }} tickFormatter={(v: number) => formatDate(v)} minTickGap={40} />
          <YAxis domain={[lo, hi]} tick={CHART.tick} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => `${v}%`} />
          <ReferenceLine y={50} stroke={CHART.axisText} strokeDasharray="4 4" label={{ value: "coin flip", fill: CHART.axisText, fontSize: "0.625rem", position: "insideBottomRight" }} />
          <ChartTooltip
            cursor={{ stroke: CHART.axis, strokeDasharray: "3 3" }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as Payload["accuracy"]["series"][number];
              return (
                <div className="rounded-md border border-border-strong bg-surface-2/95 px-3 py-2 text-xs shadow-xl shadow-shadow/50">
                  <p className="text-muted">Week of {formatDate(p.t)}</p>
                  <p className="num mt-1 text-sm">{p.cumulative.toFixed(0)}% overall so far</p>
                  <p className="num text-muted">{p.week.toFixed(0)}% that week · {p.decided} scored</p>
                </div>
              );
            }}
          />
          <Line dataKey="cumulative" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 4, stroke: CHART.surface, strokeWidth: 2, fill: SERIES[0] }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * How often the app's calls turned out right, at a horizon you choose (7 days by default),
 * with the trend over time.
 */
export function AccuracyGauge({ sources, title = "How often is it right?" }: { sources: Source[]; title?: string }) {
  const [source, setSource] = useState<Source>(sources[0]!);
  const [horizon, setHorizon] = useState<Horizon>("7d");
  const { data, loading } = useApi<Payload>(`/api/accuracy?source=${source}&horizon=${horizon}`);
  const a = data?.accuracy;
  const decided = a ? a.correct + a.incorrect : 0;
  const v = verdict(a?.hitRatePercent ?? null, decided);
  const trend = a && a.recentHitRatePercent !== null && a.hitRatePercent !== null ? a.recentHitRatePercent - a.hitRatePercent : null;

  return (
    <Panel>
      <PanelHeader
        title={<span className="flex items-center gap-1.5"><GaugeIcon className="size-3.5 text-muted" /> {title}</span>}
        description={`Share of ${SOURCE_LABEL[source].toLowerCase()} that were right after ${horizon === "24h" ? "24 hours" : horizon === "7d" ? "7 days" : "30 days"}.`}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {sources.length > 1 ? (
              <Segmented label="Whose calls" value={source} onChange={setSource} options={sources.map((s) => ({ value: s, label: SOURCE_SHORT[s] }))} />
            ) : null}
            <Segmented label="Horizon" value={horizon} onChange={setHorizon} options={[{ value: "24h", label: "24h" }, { value: "7d", label: "7d" }, { value: "30d", label: "30d" }]} />
          </div>
        }
      />
      <PanelBody>
        {loading && !data ? (
          <Skeleton className="h-40 w-full" />
        ) : a ? (
          <div className="grid items-center gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
            <div className="flex flex-col items-center text-center">
              <Dial value={decided ? a.hitRatePercent : null} tone={v.tone} />
              <p
                className={cn(
                  "mt-1 text-xs font-medium",
                  v.tone === "up" ? "text-up" : v.tone === "down" ? "text-down" : v.tone === "flat" ? "text-accent" : "text-muted",
                )}
              >
                {v.label}
              </p>
              <p className="mt-1 text-[0.6875rem] text-muted">
                {a.correct} right · {a.incorrect} wrong{a.inconclusive ? ` · ${a.inconclusive} inconclusive` : ""}
                {a.pending ? ` · ${a.pending} waiting` : ""}
              </p>
              <div className="mt-1 flex flex-wrap justify-center gap-x-3 text-[0.6875rem]">
                {trend !== null && decided >= MIN_DECIDED ? (
                  <span className={cn("inline-flex items-center gap-0.5", trend >= 0 ? "text-up" : "text-down")}>
                    {trend >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                    last 4 weeks {a.recentHitRatePercent!.toFixed(0)}%
                  </span>
                ) : null}
                {a.avgResultPercent !== null ? (
                  <span className="text-muted">avg result {formatPercent(a.avgResultPercent, { digits: 1 })}{source === "model" ? " vs the opposite picks" : ""}</span>
                ) : null}
              </div>
            </div>
            <HistoryChart series={a.series} />
          </div>
        ) : null}
        {data ? <p className="mt-3 text-[0.65625rem] text-faint">{data.rule} The dial needs {MIN_DECIDED}+ scored calls before it gives a verdict.</p> : null}
      </PanelBody>
    </Panel>
  );
}
