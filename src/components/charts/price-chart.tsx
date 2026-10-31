"use client";

import { useMemo, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RefreshCw } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { Segmented } from "@/components/ui/radix";
import { Button, EmptyState, Skeleton } from "@/components/ui/primitives";
import { Freshness } from "@/components/market/indicators";
import { bollinger, ema } from "@/services/indicators/core";
import {
  ALLOWED_INTERVALS,
  DEFAULT_INTERVAL,
  PERIODS,
  PERIOD_LABEL,
  type ChartPeriod,
  type KlineInterval,
} from "@/services/binance/intervals";
import { CHART, SERIES, compactNumber, formatAxisTime } from "./chart-theme";
import { cn, formatDateTime, formatPercent, formatPrice } from "@/lib/utils/format";

type Candle = [number, number, number, number, number, number, number];

interface KlinePayload {
  candles: Candle[];
  fetchedAt: string;
  stale: boolean;
}

interface Row {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  range: [number, number];
  up: boolean;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  bbUpper: number | null;
  bbLower: number | null;
}

type Overlay = "ema20" | "ema50" | "ema200" | "bb";

const OVERLAYS: Array<{ key: Overlay; label: string; color: string }> = [
  { key: "ema20", label: "EMA 20", color: SERIES[0] },
  { key: "ema50", label: "EMA 50", color: SERIES[1] },
  { key: "ema200", label: "EMA 200", color: SERIES[2] },
  { key: "bb", label: "Bollinger 20,2", color: "#6b7280" },
];

/** Candle body + wick. Up candles are hollow, down candles filled — direction is not colour-only. */
function CandleShape(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: Row;
}) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
  if (!payload) return null;
  const { open, close, high, low, up } = payload;
  const span = high - low;
  const toY = (v: number) => (span === 0 ? y : y + ((high - v) / span) * height);
  const bodyTop = toY(Math.max(open, close));
  const bodyBottom = toY(Math.min(open, close));
  const cx = x + width / 2;
  const bodyW = Math.max(1, Math.min(width * 0.7, 12));
  const color = up ? CHART.up : CHART.down;
  return (
    <g>
      <line x1={cx} x2={cx} y1={y} y2={y + height} stroke={color} strokeWidth={1} />
      <rect
        x={cx - bodyW / 2}
        y={bodyTop}
        width={bodyW}
        height={Math.max(1, bodyBottom - bodyTop)}
        fill={up ? CHART.surface : color}
        stroke={color}
        strokeWidth={1}
      />
    </g>
  );
}

export interface TipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
}

function PriceTooltip({ active, payload }: TipProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload as Row;
  const change = row.open ? ((row.close - row.open) / row.open) * 100 : null;
  return (
    <div className="rounded-md border border-border-strong bg-surface-2/95 px-3 py-2 text-xs shadow-xl shadow-black/50">
      <p className="mb-1.5 text-muted">{formatDateTime(row.t)}</p>
      <dl className="num grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
        <dt className="text-muted">Open</dt>
        <dd className="text-right">{formatPrice(row.open)}</dd>
        <dt className="text-muted">High</dt>
        <dd className="text-right">{formatPrice(row.high)}</dd>
        <dt className="text-muted">Low</dt>
        <dd className="text-right">{formatPrice(row.low)}</dd>
        <dt className="text-muted">Close</dt>
        <dd className="text-right">{formatPrice(row.close)}</dd>
        <dt className="text-muted">Change</dt>
        <dd className="text-right">{change === null ? "—" : `${change >= 0 ? "▲" : "▼"} ${formatPercent(change)}`}</dd>
        <dt className="text-muted">Volume</dt>
        <dd className="text-right">{compactNumber(row.volume)}</dd>
      </dl>
    </div>
  );
}

function VolumeTooltip({ active, payload }: TipProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload as Row;
  return (
    <div className="rounded-md border border-border-strong bg-surface-2/95 px-2.5 py-1.5 text-xs">
      <span className="text-muted">Volume </span>
      <span className="num">{compactNumber(row.volume)}</span>
    </div>
  );
}

export function PriceChart({ symbol, initialPeriod = "30d" }: { symbol: string; initialPeriod?: ChartPeriod }) {
  const [period, setPeriod] = useState<ChartPeriod>(initialPeriod);
  const [interval, setIntervalValue] = useState<KlineInterval>(DEFAULT_INTERVAL[initialPeriod]);
  const [mode, setMode] = useState<"line" | "candles">("line");
  const [overlays, setOverlays] = useState<Set<Overlay>>(new Set(["ema20", "ema50"]));

  const { data, error, loading, refresh } = useApi<KlinePayload>(
    `/api/market/${symbol}/klines?interval=${interval}&period=${period}`,
    { refreshInterval: 60_000 },
  );

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const closes = data.candles.map((c) => c[4]);
    const e20 = ema(closes, 20);
    const e50 = ema(closes, 50);
    const e200 = ema(closes, 200);
    const bb = bollinger(closes, 20, 2);
    return data.candles.map((c, i) => ({
      t: c[0],
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5],
      range: [c[3], c[2]],
      up: c[4] >= c[1],
      ema20: e20[i] ?? null,
      ema50: e50[i] ?? null,
      ema200: e200[i] ?? null,
      bbUpper: bb.upper[i] ?? null,
      bbLower: bb.lower[i] ?? null,
    }));
  }, [data]);

  const span = rows.length > 1 ? rows[rows.length - 1]!.t - rows[0]!.t : 0;
  const tooManyCandles = rows.length > 400;
  const effectiveMode = mode === "candles" && tooManyCandles ? "line" : mode;
  const periodChange =
    rows.length > 1 ? ((rows[rows.length - 1]!.close - rows[0]!.open) / rows[0]!.open) * 100 : null;
  const insufficient200 = overlays.has("ema200") && rows.length < 200;

  const selectPeriod = (p: ChartPeriod) => {
    setPeriod(p);
    if (!ALLOWED_INTERVALS[p].includes(interval)) setIntervalValue(DEFAULT_INTERVAL[p]);
  };

  const toggleOverlay = (o: Overlay) =>
    setOverlays((prev) => {
      const next = new Set(prev);
      if (next.has(o)) next.delete(o);
      else next.add(o);
      return next;
    });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <Segmented<ChartPeriod>
          label="Chart period"
          value={period}
          onChange={selectPeriod}
          options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))}
        />
        <Segmented<KlineInterval>
          label="Candle interval"
          value={interval}
          onChange={setIntervalValue}
          options={ALLOWED_INTERVALS[period].map((i) => ({ value: i, label: i }))}
        />
        <Segmented<"line" | "candles">
          label="Chart type"
          value={effectiveMode}
          onChange={setMode}
          options={[
            { value: "line", label: "Line" },
            { value: "candles", label: "Candles", disabled: tooManyCandles },
          ]}
        />
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Overlays">
          {OVERLAYS.map((o) => (
            <button
              key={o.key}
              type="button"
              aria-pressed={overlays.has(o.key)}
              onClick={() => toggleOverlay(o.key)}
              className={cn(
                "flex h-6 items-center gap-1.5 rounded-sm border px-2 text-[11px] transition-colors",
                overlays.has(o.key) ? "border-border-strong bg-surface-3 text-fg" : "border-transparent text-faint hover:text-muted",
              )}
            >
              <span className="h-0.5 w-3 rounded-full" style={{ background: o.color }} aria-hidden />
              {o.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {periodChange !== null ? (
            <span className="text-xs text-muted">
              {PERIOD_LABEL[period]} change{" "}
              <span className={cn("num", periodChange >= 0 ? "text-up" : "text-down")}>
                {periodChange >= 0 ? "▲" : "▼"} {formatPercent(periodChange)}
              </span>
            </span>
          ) : null}
          {data ? <Freshness fetchedAt={data.fetchedAt} stale={data.stale} /> : null}
          <Button size="icon" variant="ghost" onClick={() => void refresh()} aria-label="Refresh chart">
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {error && !data ? (
        <EmptyState
          className="h-[380px]"
          title="Chart data is unavailable"
          description={error.message}
          action={
            <Button size="sm" onClick={() => void refresh()}>
              Retry
            </Button>
          }
        />
      ) : !data || (loading && rows.length === 0) ? (
        <div className="p-4">
          <Skeleton className="h-[340px] w-full" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState className="h-[380px]" title="No trading history for this range" />
      ) : (
        <div className="px-1 pb-2 pt-3" aria-label={`${symbol} price chart`} role="img">
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={rows} syncId={`price-${symbol}`} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v: number) => formatAxisTime(v, span)}
                tick={CHART.tick}
                axisLine={false}
                tickLine={false}
                minTickGap={40}
                hide
              />
              <YAxis
                orientation="right"
                domain={["auto", "auto"]}
                tickFormatter={(v: number) => formatPrice(v)}
                tick={CHART.tick}
                axisLine={false}
                tickLine={false}
                width={72}
              />
              <Tooltip
                content={(p) => <PriceTooltip active={p.active} payload={p.payload} />}
                cursor={{ stroke: CHART.axis, strokeDasharray: "3 3" }}
                isAnimationActive={false}
              />
              {overlays.has("bb") ? (
                <>
                  <Line dataKey="bbUpper" stroke="#6b7280" strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls={false} />
                  <Line dataKey="bbLower" stroke="#6b7280" strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls={false} />
                </>
              ) : null}
              {effectiveMode === "candles" ? (
                <Bar dataKey="range" shape={(p: unknown) => <CandleShape {...(p as object)} />} isAnimationActive={false} />
              ) : (
                <Area
                  dataKey="close"
                  stroke={SERIES[0]}
                  strokeWidth={2}
                  fill={SERIES[0]}
                  fillOpacity={0.06}
                  dot={false}
                  activeDot={{ r: 4, stroke: CHART.surface, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              )}
              {(["ema20", "ema50", "ema200"] as const).map((k, i) =>
                overlays.has(k) ? (
                  <Line key={k} dataKey={k} stroke={SERIES[i]} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                ) : null,
              )}
            </ComposedChart>
          </ResponsiveContainer>
          <ResponsiveContainer width="100%" height={84}>
            <ComposedChart data={rows} syncId={`price-${symbol}`} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v: number) => formatAxisTime(v, span)}
                tick={CHART.tick}
                axisLine={{ stroke: CHART.baseline }}
                tickLine={false}
                minTickGap={48}
              />
              <YAxis orientation="right" tick={CHART.tick} tickFormatter={compactNumber} axisLine={false} tickLine={false} width={72} tickCount={2} />
              <Tooltip content={(p) => <VolumeTooltip active={p.active} payload={p.payload} />} cursor={{ fill: "rgba(255,255,255,0.04)" }} isAnimationActive={false} />
              <Bar dataKey="volume" fill={CHART.neutral} fillOpacity={0.55} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="px-3 pt-1 text-[11px] text-faint">
            Volume (base asset) · overlays are calculated on the candles shown
            {insufficient200 ? " · EMA 200 needs 200 candles and is incomplete for this range" : ""}
          </p>
        </div>
      )}
    </div>
  );
}
