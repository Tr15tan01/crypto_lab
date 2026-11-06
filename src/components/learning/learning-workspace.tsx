"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, Brain, CalendarClock, CheckCircle2, GraduationCap, History, RefreshCw, Sparkles, TriangleAlert, XCircle } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { Badge, Button, EmptyState, Notice, Panel, PanelBody, PanelHeader, Skeleton } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/radix";
import { CHART, SERIES } from "@/components/charts/chart-theme";
import { AccuracyGauge } from "./accuracy-gauge";
import { cn, formatDate, formatDateTime, formatPercent, formatRelative } from "@/lib/utils/format";

interface Metrics { samples: number; baseRate: number; accuracy: number; auc: number; brier: number; logLoss: number }
interface Lesson { key: string; label: string; group: string; weight: number; importance: number; text: string }
interface Change { key: string; label: string; from: number; to: number; kind: "flipped" | "stronger" | "weaker"; text: string }
interface PickRow { symbol: string; probability: number; drivers: Array<{ label: string; contribution: number }> }

interface Run {
  _id: string;
  createdAt: string;
  trigger: "scheduled" | "manual" | "auto";
  durationMs: number;
  data: { pairs: number; samples: number; from: string | null; to: string | null; horizonDays: number; strideDays: number };
  split: { cutoff: string; trainSamples: number; testSamples: number };
  test: {
    metrics: Metrics;
    calibration?: Array<{ from: number; to: number; count: number; predicted: number; actual: number }>;
    deciles?: Array<{ decile: number; count: number; avgProbability: number; avgExcessPercent: number; hitRate: number }>;
    spreadPercent: number;
  };
  train: { metrics: Metrics };
  trust: number;
  lessons: Lesson[];
  changes: Change[];
  picks: { top: PickRow[]; bottom?: PickRow[] };
}

interface Payload {
  latest: Run | null;
  runs: Run[];
  calibration: Array<{ source: "chat" | "autopilot"; bucket: string; decided: number; statedAvg: number | null; hitRate: number | null }>;
  due: boolean;
  training: boolean;
  nextRunAt: string | null;
  features: Array<{ key: string; label: string; group: string }>;
}

const TRIGGER: Record<Run["trigger"], string> = { scheduled: "daily schedule", manual: "you, manually", auto: "first use" };

function Tip({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-border-strong bg-surface-2/95 px-3 py-2 text-xs shadow-xl shadow-shadow/50">{children}</div>;
}

function skillVerdict(auc: number, spread: number) {
  if (auc >= 0.56 && spread > 1) return { label: "Real, modest skill", tone: "up" as const, icon: CheckCircle2, text: "On a period it never saw, its top-ranked coins clearly beat its bottom-ranked ones." };
  if (auc >= 0.52 && spread > 0) return { label: "Weak skill", tone: "accent" as const, icon: CheckCircle2, text: "Slightly better than chance out of sample. Used with a small weight." };
  return { label: "No reliable skill", tone: "down" as const, icon: XCircle, text: "Not better than chance on unseen data, so Autopilot ignores it until a later run does better." };
}

/** Bar with only the data end rounded (top for gains, bottom for losses). */
function RoundedEndBar(props: unknown) {
  const { x, y, width, height, value } = props as { x: number; y: number; width: number; height: number; value: number };
  const r = Math.min(4, Math.abs(height), width / 2);
  const fill = value >= 0 ? CHART.up : CHART.down;
  const top = Math.min(y, y + height);
  const h = Math.abs(height);
  if (h < 0.5) return null;
  const d =
    value >= 0
      ? `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${top + h} Z`
      : `M${x},${top} V${top + h - r} Q${x},${top + h} ${x + r},${top + h} H${x + width - r} Q${x + width},${top + h} ${x + width},${top + h - r} V${top} Z`;
  return <path d={d} fill={fill} />;
}

function DecileChart({ deciles }: { deciles: NonNullable<Run["test"]["deciles"]> }) {
  return (
    <div role="img" aria-label="Average result vs BTC by model decile, out of sample">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={deciles} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={4}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="decile" tick={CHART.tick} tickLine={false} axisLine={{ stroke: CHART.baseline }} tickFormatter={(v: number) => (v === 1 ? "1 low" : v === 10 ? "10 high" : String(v))} />
          <YAxis tick={CHART.tick} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${v}%`} />
          <ReferenceLine y={0} stroke={CHART.baseline} />
          <ChartTooltip
            cursor={{ fill: CHART.hover }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]!.payload as NonNullable<Run["test"]["deciles"]>[number];
              return (
                <Tip>
                  <p className="text-muted">Decile {d.decile} · {d.count} coin-weeks</p>
                  <p className="num mt-1 text-sm">{d.avgExcessPercent >= 0 ? "▲" : "▼"} {formatPercent(d.avgExcessPercent)} vs BTC</p>
                  <p className="num text-muted">model said {(d.avgProbability * 100).toFixed(0)}% · actually beat BTC {(d.hitRate * 100).toFixed(0)}%</p>
                </Tip>
              );
            }}
          />
          <Bar dataKey="avgExcessPercent" shape={RoundedEndBar} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CalibrationChart({ buckets }: { buckets: NonNullable<Run["test"]["calibration"]> }) {
  const data = buckets.map((b) => ({ x: b.predicted * 100, y: b.actual * 100, n: b.count }));
  const lo = Math.max(0, Math.floor(Math.min(...data.map((d) => Math.min(d.x, d.y))) / 10) * 10 - 5);
  const hi = Math.min(100, Math.ceil(Math.max(...data.map((d) => Math.max(d.x, d.y))) / 10) * 10 + 5);
  return (
    <div role="img" aria-label="Predicted probability versus actual frequency, out of sample">
      <ResponsiveContainer width="100%" height={220}>
        <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
          <CartesianGrid stroke={CHART.grid} />
          <XAxis type="number" dataKey="x" domain={[lo, hi]} tick={CHART.tick} tickLine={false} axisLine={{ stroke: CHART.baseline }} tickFormatter={(v: number) => `${v}%`} name="Predicted" />
          <YAxis type="number" dataKey="y" domain={[lo, hi]} tick={CHART.tick} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${v}%`} name="Actual" />
          <ZAxis dataKey="n" range={[80, 320]} />
          <ReferenceLine segment={[{ x: lo, y: lo }, { x: hi, y: hi }]} stroke={CHART.axisText} strokeDasharray="4 4" />
          <ChartTooltip
            isAnimationActive={false}
            cursor={false}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]!.payload as { x: number; y: number; n: number };
              return (
                <Tip>
                  <p className="text-muted">{d.n} coin-weeks</p>
                  <p className="num mt-1">model said {d.x.toFixed(0)}% → happened {d.y.toFixed(0)}%</p>
                </Tip>
              );
            }}
          />
          <Scatter data={data} fill={SERIES[0]} stroke={CHART.surface} strokeWidth={2} isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
      <p className="px-1 text-[0.6875rem] text-muted">Dots on the dashed line = perfectly calibrated. Above it = the model was too cautious; below = too confident.</p>
    </div>
  );
}

function AucHistory({ runs }: { runs: Run[] }) {
  const data = [...runs].reverse().map((r) => ({ t: new Date(r.createdAt).getTime(), auc: r.test.metrics.auc, spread: r.test.spreadPercent }));
  if (data.length < 2) return <p className="text-xs text-muted">The skill history appears after the second training run.</p>;
  return (
    <div role="img" aria-label="Out-of-sample AUC per training run">
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tick={CHART.tick} tickLine={false} axisLine={{ stroke: CHART.baseline }} tickFormatter={(v: number) => formatDate(v)} minTickGap={40} />
          <YAxis domain={[0.45, "auto"]} tick={CHART.tick} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => v.toFixed(2)} />
          <ReferenceLine y={0.5} stroke={CHART.axisText} strokeDasharray="4 4" label={{ value: "chance", fill: CHART.axisText, fontSize: "0.625rem", position: "insideBottomRight" }} />
          <ChartTooltip
            cursor={{ stroke: CHART.axis, strokeDasharray: "3 3" }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]!.payload as { t: number; auc: number; spread: number };
              return (
                <Tip>
                  <p className="text-muted">{formatDateTime(d.t)}</p>
                  <p className="num mt-1">AUC {d.auc.toFixed(3)} · top-vs-bottom {formatPercent(d.spread)}</p>
                </Tip>
              );
            }}
          />
          <Line dataKey="auc" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 4, stroke: CHART.surface, strokeWidth: 2, fill: SERIES[0] }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function WeightBar({ weight, max }: { weight: number; max: number }) {
  const w = max > 0 ? Math.min(50, (Math.abs(weight) / max) * 50) : 0;
  return (
    <div className="relative h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-surface-3" aria-hidden>
      <div className="absolute inset-y-0 left-1/2 w-px bg-border-strong" />
      <div className={cn("absolute inset-y-0 rounded-full", weight >= 0 ? "left-1/2 bg-up" : "right-1/2 bg-down")} style={{ width: `${w}%` }} />
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "up" | "down" }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
      <p className="label-caps">{label}</p>
      <p className={cn("num mt-1 text-base", tone === "up" && "text-up", tone === "down" && "text-down")}>{value}</p>
      {sub ? <p className="mt-0.5 text-[0.65625rem] text-faint">{sub}</p> : null}
    </div>
  );
}

function Picks({ title, rows, tone }: { title: string; rows: PickRow[]; tone: "up" | "down" }) {
  return (
    <div>
      <p className={cn("mb-1.5 flex items-center gap-1 text-xs font-medium", tone === "up" ? "text-up" : "text-down")}>
        {tone === "up" ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />} {title}
      </p>
      <ul className="space-y-1">
        {rows.map((p) => (
          <li key={p.symbol} className="flex items-center gap-2 text-xs">
            <Link href={`/crypto/${p.symbol}`} className="w-20 shrink-0 font-mono font-semibold hover:text-accent">{p.symbol.replace(/USDT$/, "")}</Link>
            <span className={cn("num w-10 shrink-0", tone === "up" ? "text-up" : "text-down")}>{Math.round(p.probability * 100)}%</span>
            <span className="truncate text-[0.6875rem] text-muted">{p.drivers.map((d) => `${d.contribution >= 0 ? "+" : "−"}${d.label}`).join(" · ")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LearningWorkspace() {
  const { data, error, loading, refresh } = useApi<Payload>("/api/learning");
  const [training, setTraining] = useState(false);
  const [trainError, setTrainError] = useState<string | null>(null);

  // While a first run is in progress, check back every 8 seconds.
  useEffect(() => {
    if (!data?.training || data.latest) return;
    const id = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(id);
  }, [data?.training, data?.latest, refresh]);

  const retrain = async () => {
    setTraining(true);
    setTrainError(null);
    try {
      await apiFetch("/api/learning/train", { method: "POST" });
      await refresh();
    } catch (err) {
      setTrainError(err instanceof ApiClientError ? err.message : "Training failed.");
    } finally {
      setTraining(false);
    }
  };

  if (loading) return <div className="space-y-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28 w-full" />)}</div>;
  if (error || !data) return <Notice tone="down" title="Learning data unavailable">{error?.message}</Notice>;

  const run = data.latest;
  if (!run) {
    return (
      <Panel>
        <EmptyState
          icon={<Brain className="size-6 animate-pulse-soft" />}
          title="The first training run is in progress"
          description="Loading ~2.5 years of daily candles for the 100 most liquid pairs, building ~20,000 labelled examples and validating the model. This takes about a minute; the page updates by itself."
        />
      </Panel>
    );
  }

  const m = run.test.metrics;
  const verdict = skillVerdict(m.auc, run.test.spreadPercent);
  const VIcon = verdict.icon;
  const maxW = Math.max(...run.lessons.map((l) => Math.abs(l.weight)), 0.01);
  const calib = data.calibration.filter((c) => c.decided > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-xs">
        <span className="flex items-center gap-1.5"><History className="size-3.5 text-muted" /> Last trained <strong className="font-medium">{formatRelative(run.createdAt)}</strong> <span className="text-faint">({formatDateTime(run.createdAt)}, by {TRIGGER[run.trigger]}, {(run.durationMs / 1000).toFixed(0)}s)</span></span>
        {data.nextRunAt ? <span className="flex items-center gap-1.5 text-muted"><CalendarClock className="size-3.5" /> Next scheduled run {formatDateTime(data.nextRunAt)}</span> : null}
        <span className="text-muted">{run.data.pairs} pairs · {run.data.samples.toLocaleString("en-US")} examples · {run.data.from ? formatDate(run.data.from) : "—"} → {run.data.to ? formatDate(run.data.to) : "—"}</span>
        <Button size="sm" variant="secondary" className="ml-auto" loading={training} onClick={() => void retrain()}>
          <RefreshCw className="size-3.5" /> Retrain now
        </Button>
      </div>
      {trainError ? <Notice tone="down">{trainError}</Notice> : null}

      <AccuracyGauge sources={["model", "autopilot", "chat"]} title="How often is it right in real life?" />

      <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        <Panel>
          <PanelHeader
            title={<span className="flex items-center gap-2">Did it learn anything? <Badge tone={verdict.tone}><VIcon className="size-3" /> {verdict.label}</Badge></span>}
            description={`Trained on data up to ${formatDate(run.split.cutoff)}, then tested on the ${run.split.testSamples.toLocaleString("en-US")} examples after it, which it never saw.`}
          />
          <PanelBody className="space-y-3">
            <p className="text-xs text-fg/85">{verdict.text}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat
                label="AUC (unseen data)"
                value={m.auc.toFixed(3)}
                sub="0.50 = coin flip"
                tone={m.auc >= 0.52 ? "up" : "down"}
              />
              <Stat label="Accuracy" value={formatPercent(m.accuracy * 100, { sign: false, digits: 1 })} sub={`always-“no” would get ${formatPercent((1 - m.baseRate) * 100, { sign: false, digits: 1 })}`} />
              <Stat label="Top vs bottom 10%" value={formatPercent(run.test.spreadPercent, { digits: 1 })} sub="weekly result vs BTC" tone={run.test.spreadPercent > 0 ? "up" : "down"} />
              <Stat label="Trust in Autopilot" value={`${Math.round(run.trust * 100)}%`} sub="from the AUC; 0% below 0.51" />
            </div>
            <p className="text-[0.6875rem] text-faint">
              In-sample AUC {run.train.metrics.auc.toFixed(3)} vs out-of-sample {m.auc.toFixed(3)}: a small gap means it is not just memorising the past.
              Brier score {m.brier.toFixed(4)} (lower is better).
            </p>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Does a higher score mean a better coin?" description="Unseen period, coins sorted into 10 groups by the model's probability. Bars: average 7-day result vs BTC." />
          <PanelBody className="px-2">{run.test.deciles?.length ? <DecileChart deciles={run.test.deciles} /> : null}</PanelBody>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Panel>
          <PanelHeader title={<span className="flex items-center gap-1.5"><GraduationCap className="size-3.5 text-muted" /> What it has learned</span>} description="Each factor's weight in the model, strongest first. Green helps a coin beat BTC, red hurts — all other factors held equal." />
          <ul className="divide-y divide-border">
            {run.lessons.map((l) => (
              <li key={l.key} className="flex items-start gap-3 px-4 py-2">
                <WeightBar weight={l.weight} max={maxW} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs">
                    <span className="font-medium">{l.label}</span> <span className="text-faint">· {l.group} · {l.importance}% of the model</span>
                  </p>
                  <p className="text-[0.6875rem] text-muted">{l.text}</p>
                </div>
                <span className={cn("num w-12 shrink-0 text-right text-xs", l.weight >= 0 ? "text-up" : "text-down")}>{l.weight > 0 ? "+" : ""}{l.weight.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="space-y-4">
          <Panel>
            <PanelHeader title="Is it honest about its odds?" description="Calibration on the unseen period." />
            <PanelBody className="px-2">{run.test.calibration?.length ? <CalibrationChart buckets={run.test.calibration} /> : null}</PanelBody>
          </Panel>
          <Panel>
            <PanelHeader title="How its views changed" description="Compared with the previous training run." />
            <PanelBody>
              {run.changes.length ? (
                <ul className="space-y-1.5 text-xs">
                  {run.changes.map((c) => (
                    <li key={c.key} className="flex gap-1.5">
                      <Badge tone={c.kind === "flipped" ? "warn" : c.kind === "stronger" ? "accent" : "neutral"}>{c.kind}</Badge>
                      <span className="text-fg/85">{c.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted">{data.runs.length > 1 ? "No meaningful change: the same lessons held up on the newest data." : "This is the first run; changes appear from the next one."}</p>
              )}
            </PanelBody>
          </Panel>
        </div>
      </div>

      <Panel>
        <PanelHeader
          title={<span className="flex items-center gap-1.5"><Sparkles className="size-3.5 text-muted" /> What it thinks now</span>}
          description={`Chance to beat BTC over the next 7 days, from the latest closed daily candle (${formatRelative(run.createdAt)}). Typical: ${(m.baseRate * 100).toFixed(0)}%. Reasons are the strongest factors for each coin.`}
        />
        <PanelBody className="grid gap-6 lg:grid-cols-2">
          <Picks title="Most likely to beat BTC" rows={run.picks.top} tone="up" />
          {run.picks.bottom?.length ? <Picks title="Least likely" rows={run.picks.bottom} tone="down" /> : null}
        </PanelBody>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Learning from its own calls" description="Stated confidence of scored chat and Autopilot calls vs how often they were right. Autopilot pulls its confidence toward these results once a bucket has 10+ scored calls." />
          {calib.length ? (
            <table className="w-full text-[0.8125rem]">
              <thead className="border-b border-border bg-surface-2/50">
                <tr className="text-[0.6875rem] text-muted">
                  <th className="px-3 py-2 text-left font-medium">Source</th>
                  <th className="px-3 py-2 text-left font-medium">Said</th>
                  <th className="px-3 py-2 text-right font-medium">Scored calls</th>
                  <th className="px-3 py-2 text-right font-medium">Avg stated</th>
                  <th className="px-3 py-2 text-right font-medium">Actually right</th>
                  <th className="px-3 py-2 text-left font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {calib.map((c) => {
                  const gap = c.hitRate !== null && c.statedAvg !== null ? c.hitRate - c.statedAvg : null;
                  return (
                    <tr key={`${c.source}${c.bucket}`} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 capitalize">{c.source}</td>
                      <td className="px-3 py-2">{c.bucket}</td>
                      <td className="num px-3 py-2 text-right">{c.decided}</td>
                      <td className="num px-3 py-2 text-right">{c.statedAvg ?? "—"}%</td>
                      <td className="num px-3 py-2 text-right">{c.hitRate !== null ? `${c.hitRate.toFixed(0)}%` : "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        {c.decided < 10 ? <span className="text-faint">needs {10 - c.decided} more</span> : gap !== null && gap < -10 ? <span className="text-down">overconfident</span> : gap !== null && gap > 10 ? <span className="text-info">underconfident</span> : <span className="text-up">calibrated</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <PanelBody><p className="text-xs text-muted">No scored calls yet. Chat verdicts and Autopilot calls are scored after their horizon; results appear here.</p></PanelBody>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Skill over time" description="Out-of-sample AUC of every training run. Steady above the dashed line = the lessons keep holding." />
          <PanelBody className="px-2"><AucHistory runs={data.runs} /></PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Training history" description="Every run is kept." />
        <div className="overflow-x-auto">
          <table className="w-full text-[0.8125rem]">
            <thead className="border-b border-border bg-surface-2/50">
              <tr className="text-[0.6875rem] text-muted">
                <th className="px-3 py-2 text-left font-medium">When</th>
                <th className="px-3 py-2 text-left font-medium">Trigger</th>
                <th className="px-3 py-2 text-right font-medium">Examples</th>
                <th className="px-3 py-2 text-right font-medium">AUC</th>
                <th className="px-3 py-2 text-right font-medium">Top vs bottom</th>
                <th className="px-3 py-2 text-right font-medium">Trust</th>
                <th className="px-3 py-2 text-left font-medium">Strongest lesson</th>
                <th className="px-3 py-2 text-left font-medium">Top pick</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((r) => (
                <tr key={r._id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 text-xs text-muted">{formatDateTime(r.createdAt)}</td>
                  <td className="px-3 py-2 text-xs">{TRIGGER[r.trigger]}</td>
                  <td className="num px-3 py-2 text-right">{r.data.samples.toLocaleString("en-US")}</td>
                  <td className={cn("num px-3 py-2 text-right", r.test.metrics.auc >= 0.52 ? "text-up" : "text-down")}>{r.test.metrics.auc.toFixed(3)}</td>
                  <td className="num px-3 py-2 text-right">{formatPercent(r.test.spreadPercent, { digits: 1 })}</td>
                  <td className="num px-3 py-2 text-right">{Math.round(r.trust * 100)}%</td>
                  <td className="max-w-72 truncate px-3 py-2 text-xs text-muted" title={r.lessons[0]?.text}>{r.lessons[0] ? `${r.lessons[0].weight > 0 ? "+" : "−"} ${r.lessons[0].label}` : "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.picks.top[0]?.symbol.replace(/USDT$/, "") ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="How it learns" />
        <PanelBody className="grid gap-4 text-xs leading-relaxed text-fg/85 lg:grid-cols-3">
          <div>
            <p className="mb-1 font-medium text-fg">1. What it studies</p>
            <p>
              Every 3rd day of the last ~2.5 years, for the 100 most liquid Binance pairs, it records {data.features.length} facts known at that
              day&apos;s close ({[...new Set(data.features.map((f) => f.group))].join(", ").toLowerCase()}) and what happened next: did the coin
              beat BTC over the following {run.data.horizonDays} days?
            </p>
          </div>
          <div>
            <p className="mb-1 font-medium text-fg">2. How it is checked</p>
            <p>
              It learns from the older 75% of history and is graded on the newest 25%, with a {run.data.horizonDays}-day gap between them so no
              answer leaks. The model is a regularised logistic regression: simple enough that every weight above is shown and explained.
            </p>
          </div>
          <div>
            <p className="mb-1 font-medium text-fg">3. How it is used</p>
            <p>
              It retrains daily at 06:00 UTC on all data. Autopilot adds it as a factor weighted by its trust, every{" "}
              <Link href="/market" className="underline">coin page</Link> shows its view, the AI chat sees it, and Autopilot&apos;s stated
              confidence is calibrated against its own scored calls.
            </p>
          </div>
          <Notice tone="warn" className="lg:col-span-3">
            <span className="flex items-start gap-1.5">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              An AUC of 0.55–0.60 is typical of real, usable skill in markets; anything far higher on daily crypto data would be a red flag for a
              bug, not genius. It ranks coins against BTC; it does not know news, unlocks or listings. Only coins listed today are in the data, and
              patterns can stop working: that is why it retrains, re-tests and shows its record every day.
            </span>
          </Notice>
        </PanelBody>
      </Panel>
      <p className="text-[0.6875rem] text-faint">
        <Tooltip content="Training runs are global (market-wide); calibration uses your own scored calls.">
          <span className="cursor-help underline decoration-dotted underline-offset-2">About the data</span>
        </Tooltip>{" "}
        · Retraining is limited to once per 10 minutes; the daily run happens with the scheduled job.
      </p>
    </div>
  );
}
