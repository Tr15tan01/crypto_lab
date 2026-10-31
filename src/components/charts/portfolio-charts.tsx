"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { EmptyState } from "@/components/ui/primitives";
import { CHART, SERIES, formatAxisTime } from "./chart-theme";
import { formatDate, formatDateTime, formatPercent, formatUsd } from "@/lib/utils/format";

interface TipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown; name?: unknown; value?: unknown; color?: string; dataKey?: unknown }>;
  label?: unknown;
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border-strong bg-surface-2/95 px-3 py-2 text-xs shadow-xl shadow-black/50">{children}</div>
  );
}

function Swatch({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <span
      className="inline-block h-0.5 w-3 rounded-full align-middle"
      style={dashed ? { borderTop: `2px dashed ${color}`, height: 0 } : { background: color }}
      aria-hidden
    />
  );
}

const axisProps = { tick: CHART.tick, axisLine: false, tickLine: false } as const;

/* ───────── 1 & 2. Portfolio value over time vs starting balance ───────── */

export function PortfolioValueChart({
  points,
  initialBalance,
  height = 260,
}: {
  points: Array<{ t: number; v: number }>;
  initialBalance: number;
  height?: number;
}) {
  if (points.length < 2) {
    return (
      <EmptyState
        className="py-12"
        title="Not enough history yet"
        description="The value line is built from stored snapshots (hourly while the app or the scheduled job runs, and after every trade). It is never back-filled with today's prices."
      />
    );
  }
  const span = points[points.length - 1]!.t - points[0]!.t;
  const last = points[points.length - 1]!.v;
  return (
    <div role="img" aria-label={`Portfolio value over time, currently ${formatUsd(last)} versus starting balance ${formatUsd(initialBalance)}`}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={points} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(v: number) => formatAxisTime(v, span)} minTickGap={50} {...axisProps} axisLine={{ stroke: CHART.baseline }} />
          <YAxis orientation="right" domain={["auto", "auto"]} tickFormatter={(v: number) => formatUsd(v, { compact: true })} width={70} {...axisProps} />
          <ReferenceLine y={initialBalance} stroke={CHART.axisText} strokeDasharray="4 4" />
          <Tooltip
            cursor={{ stroke: CHART.axis, strokeDasharray: "3 3" }}
            isAnimationActive={false}
            content={({ active, payload }: TipProps) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as { t: number; v: number };
              const diff = p.v - initialBalance;
              return (
                <Tip>
                  <p className="text-muted">{formatDateTime(p.t)}</p>
                  <p className="num mt-1 text-sm">{formatUsd(p.v)}</p>
                  <p className="num text-muted">
                    vs start {diff >= 0 ? "▲" : "▼"} {formatUsd(diff, { sign: true })} ({formatPercent((diff / initialBalance) * 100)})
                  </p>
                </Tip>
              );
            }}
          />
          <Line dataKey="v" name="Portfolio value" stroke={SERIES[0]} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: CHART.surface, strokeWidth: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <p className="flex items-center gap-3 px-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5"><Swatch color={SERIES[0]} /> Portfolio value</span>
        <span className="flex items-center gap-1.5"><Swatch color={CHART.axisText} dashed /> Starting balance {formatUsd(initialBalance)}</span>
      </p>
    </div>
  );
}

/* ───────── 3. Asset allocation ───────── */

export function AllocationChart({ slices }: { slices: Array<{ label: string; value: number }> }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return <EmptyState className="py-12" title="Nothing allocated yet" />;
  // Fixed categorical order; beyond 7 assets the rest fold into "Other".
  const sorted = [...slices].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, 7);
  const rest = sorted.slice(7).reduce((s, x) => s + x.value, 0);
  const data = rest > 0 ? [...head, { label: "Other", value: rest }] : head;
  const colors = data.map((d, i) => (d.label === "Cash" ? "#4b525c" : d.label === "Other" ? "#6b7280" : SERIES[i % SERIES.length]!));
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="h-48 w-48 shrink-0" role="img" aria-label="Asset allocation">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="100%" paddingAngle={1} stroke={CHART.surface} strokeWidth={2} isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={d.label} fill={colors[i]} />
              ))}
            </Pie>
            <Tooltip
              isAnimationActive={false}
              content={({ active, payload }: TipProps) => {
                if (!active || !payload?.length) return null;
                const p = payload[0]!.payload as { label: string; value: number };
                return (
                  <Tip>
                    <p>{p.label}</p>
                    <p className="num text-muted">
                      {formatUsd(p.value)} · {formatPercent((p.value / total) * 100, { sign: false, digits: 1 })}
                    </p>
                  </Tip>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full space-y-1.5 text-xs">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <span className="size-2.5 rounded-sm" style={{ background: colors[i] }} aria-hidden />
              {d.label}
            </span>
            <span className="num text-muted">
              {formatPercent((d.value / total) * 100, { sign: false, digits: 1 })} · {formatUsd(d.value, { compact: true })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────── 4. Realized vs unrealized, 5. per-asset performance ───────── */

export function AssetPnLChart({ rows }: { rows: Array<{ label: string; realized: number; unrealized: number }> }) {
  if (!rows.length) return <EmptyState className="py-12" title="No positions or closed trades yet" />;
  const height = Math.max(140, rows.length * 34 + 50);
  return (
    <div role="img" aria-label="Realized and unrealized profit and loss by asset">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }} barGap={2} barCategoryGap="28%">
          <CartesianGrid stroke={CHART.grid} horizontal={false} />
          <XAxis type="number" tickFormatter={(v: number) => formatUsd(v, { compact: true })} {...axisProps} />
          <YAxis type="category" dataKey="label" width={64} {...axisProps} tick={{ ...CHART.tick, fill: "#c3c7cd" }} />
          <ReferenceLine x={0} stroke={CHART.baseline} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
            isAnimationActive={false}
            content={({ active, payload }: TipProps) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as { label: string; realized: number; unrealized: number };
              return (
                <Tip>
                  <p className="mb-1">{p.label}</p>
                  <p className="num"><Swatch color={SERIES[0]} /> Realized {formatUsd(p.realized, { sign: true })}</p>
                  <p className="num"><Swatch color={SERIES[1]} /> Unrealized {formatUsd(p.unrealized, { sign: true })}</p>
                  <p className="num mt-1 text-muted">Total {formatUsd(p.realized + p.unrealized, { sign: true })}</p>
                </Tip>
              );
            }}
          />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 11, color: CHART.axisText }} />
          <Bar dataKey="realized" name="Realized" fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={12} isAnimationActive={false} />
          <Bar dataKey="unrealized" name="Unrealized" fill={SERIES[1]} radius={[0, 4, 4, 0]} maxBarSize={12} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ───────── 6. Monthly performance ───────── */

export function MonthlyChart({ months }: { months: Array<{ month: string; returnPercent: number }> }) {
  if (!months.length) {
    return <EmptyState className="py-12" title="No monthly history yet" description="Monthly returns appear once snapshots span at least two points in time." />;
  }
  return (
    <div role="img" aria-label="Monthly portfolio returns">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={months} margin={{ top: 16, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="month" {...axisProps} axisLine={{ stroke: CHART.baseline }} />
          <YAxis tickFormatter={(v: number) => `${v}%`} width={44} {...axisProps} />
          <ReferenceLine y={0} stroke={CHART.baseline} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
            isAnimationActive={false}
            content={({ active, payload }: TipProps) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as { month: string; returnPercent: number };
              return (
                <Tip>
                  <p>{p.month}</p>
                  <p className="num">{p.returnPercent >= 0 ? "▲" : "▼"} {formatPercent(p.returnPercent)}</p>
                </Tip>
              );
            }}
          />
          <Bar
            dataKey="returnPercent"
            maxBarSize={36}
            isAnimationActive={false}
            label={{ position: "top", fill: CHART.axisText, fontSize: 10, formatter: (v: unknown) => formatPercent(Number(v), { digits: 1 }) }}
          >
            {months.map((m) => (
              <Cell key={m.month} fill={m.returnPercent >= 0 ? CHART.up : CHART.down} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ───────── 7. Buy/sell activity timeline ───────── */

export function ActivityTimeline({
  trades,
}: {
  trades: Array<{ t: number; symbol: string; type: "BUY" | "SELL"; total: number; price: number }>;
}) {
  if (!trades.length) return <EmptyState className="py-12" title="No simulated trades yet" />;
  const symbols = [...new Set(trades.map((t) => t.symbol))];
  const rows = trades.map((t) => ({ ...t, y: symbols.indexOf(t.symbol) }));
  const buys = rows.filter((r) => r.type === "BUY");
  const sells = rows.filter((r) => r.type === "SELL");
  const span = Math.max(...rows.map((r) => r.t)) - Math.min(...rows.map((r) => r.t));
  const shape = (up: boolean) =>
    function Marker(props: unknown) {
      const { cx = 0, cy = 0 } = props as { cx?: number; cy?: number };
      const s = 6;
      const path = up ? `M${cx},${cy - s} L${cx + s},${cy + s} L${cx - s},${cy + s} Z` : `M${cx},${cy + s} L${cx + s},${cy - s} L${cx - s},${cy - s} Z`;
      return <path d={path} fill={up ? CHART.up : CHART.down} stroke={CHART.surface} strokeWidth={2} />;
    };
  return (
    <div role="img" aria-label="Timeline of simulated buys and sells">
      <ResponsiveContainer width="100%" height={Math.max(140, symbols.length * 30 + 60)}>
        <ScatterChart margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={CHART.grid} />
          <XAxis dataKey="t" type="number" scale="time" domain={["dataMin - 3600000", "dataMax + 3600000"]} tickFormatter={(v: number) => formatAxisTime(v, Math.max(span, 86_400_000 * 3))} minTickGap={50} {...axisProps} />
          <YAxis dataKey="y" type="number" domain={[-0.5, symbols.length - 0.5]} ticks={symbols.map((_, i) => i)} tickFormatter={(i: number) => symbols[i]?.replace(/USDT$/, "") ?? ""} width={56} {...axisProps} tick={{ ...CHART.tick, fill: "#c3c7cd" }} />
          <ZAxis range={[80, 80]} />
          <Tooltip
            isAnimationActive={false}
            cursor={{ strokeDasharray: "3 3", stroke: CHART.axis }}
            content={({ active, payload }: TipProps) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as (typeof rows)[number];
              return (
                <Tip>
                  <p>{p.type === "BUY" ? "▲ Buy" : "▼ Sell"} {p.symbol}</p>
                  <p className="num text-muted">{formatUsd(p.total)} @ {p.price}</p>
                  <p className="text-faint">{formatDateTime(p.t)}</p>
                </Tip>
              );
            }}
          />
          <Legend iconType="triangle" wrapperStyle={{ fontSize: 11, color: CHART.axisText }} />
          <Scatter name="Buy" data={buys} shape={shape(true)} fill={CHART.up} isAnimationActive={false} />
          <Scatter name="Sell" data={sells} shape={shape(false)} fill={CHART.down} isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ───────── Benchmark comparison ───────── */

export function BenchmarkChart({
  portfolio,
  benchmarks,
}: {
  portfolio: Array<{ t: number; v: number }>;
  benchmarks: Array<{ label: string; series: Array<{ t: number; v: number }> }>;
}) {
  const all = [{ label: "My portfolio", series: portfolio }, ...benchmarks].filter((s) => s.series.length > 1);
  if (all.length < 2 || portfolio.length < 2) {
    return <EmptyState className="py-12" title="Benchmark comparison needs more history" description="It appears once snapshots and benchmark prices cover the same period." />;
  }
  const times = [...new Set(all.flatMap((s) => s.series.map((p) => p.t)))].sort((a, b) => a - b);
  const valueAt = (series: Array<{ t: number; v: number }>, t: number) => {
    let v: number | null = null;
    for (const p of series) {
      if (p.t <= t) v = p.v;
      else break;
    }
    return v;
  };
  const start = portfolio[0]!.t;
  const data = times.filter((t) => t >= start).map((t) => {
    const row: Record<string, number | null> = { t };
    for (const s of all) row[s.label] = valueAt(s.series, t);
    return row;
  });
  const span = times[times.length - 1]! - start;
  return (
    <div role="img" aria-label="Portfolio value compared with holding BTC and ETH">
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(v: number) => formatAxisTime(v, span)} minTickGap={50} {...axisProps} axisLine={{ stroke: CHART.baseline }} />
          <YAxis orientation="right" domain={["auto", "auto"]} tickFormatter={(v: number) => formatUsd(v, { compact: true })} width={70} {...axisProps} />
          <Tooltip
            isAnimationActive={false}
            cursor={{ stroke: CHART.axis, strokeDasharray: "3 3" }}
            content={({ active, payload }: TipProps) => {
              if (!active || !payload?.length) return null;
              const row = payload[0]!.payload as Record<string, number>;
              return (
                <Tip>
                  <p className="mb-1 text-muted">{formatDate(row.t)}</p>
                  {all.map((s, i) => (
                    <p key={s.label} className="num flex items-center gap-2">
                      <Swatch color={SERIES[i]!} /> {s.label}: {row[s.label] !== null && row[s.label] !== undefined ? formatUsd(row[s.label]) : "—"}
                    </p>
                  ))}
                </Tip>
              );
            }}
          />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 11, color: CHART.axisText }} />
          {all.map((s, i) => (
            <Line key={s.label} dataKey={s.label} name={s.label} stroke={SERIES[i]} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
