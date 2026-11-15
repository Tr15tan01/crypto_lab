"use client";

import Link from "@/components/ui/link";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowUp, Compass, Minus, TriangleAlert } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { Badge, Notice, Panel, PanelBody, PanelHeader, Skeleton } from "@/components/ui/primitives";
import { Freshness } from "@/components/market/indicators";
import { CHART, SERIES } from "@/components/charts/chart-theme";
import { cn, formatDate, formatPercent, formatPrice } from "@/lib/utils/format";

type Zone = "strong_up" | "up" | "sideways" | "down" | "strong_down";
interface Fwd { upPercent: number; medianPercent: number }

interface Payload {
  direction: {
    asOf: number;
    includesToday: boolean;
    score: number;
    zone: Zone;
    zoneLabel: string;
    regime: "up" | "sideways" | "down";
    scoreWeekAgo: number | null;
    daysInZone: number;
    components: Array<{ key: string; label: string; weight: number; score: number; note: string }>;
    history: Array<{ zone: Zone; days: number; btc7: Fwd | null; btc30: Fwd | null; alt7: Fwd | null; alt30: Fwd | null }>;
    series: Array<{ t: number; score: number; btc: number }>;
    coins: number;
  };
  zones: Array<{ key: Zone; label: string }>;
  timeframes: Array<{
    symbol: string;
    price: number | null;
    trends: Array<{ interval: "4h" | "1d" | "1w"; score: number; direction: "up" | "down" | "flat" }>;
    aligned: "up" | "down" | null;
  }>;
  fetchedAt: string;
  stale: boolean;
}

export const zoneTone = (z: Zone) => (z === "strong_up" || z === "up" ? "up" : z === "sideways" ? "neutral" : "down");
const toneText = { up: "text-up", down: "text-down", neutral: "text-fg" } as const;

/** −100 … +100 bar with zone boundaries and a marker at the current score. */
export function DirectionBar({ score, className }: { score: number; className?: string }) {
  const pos = ((Math.max(-100, Math.min(100, score)) + 100) / 200) * 100;
  return (
    <div className={cn("relative h-2 rounded-full bg-surface-3", className)} role="meter" aria-valuemin={-100} aria-valuemax={100} aria-valuenow={score} aria-label="Market direction score">
      {[-50, -15, 15, 50].map((b) => (
        <span key={b} className="absolute inset-y-0 w-px bg-border-strong" style={{ left: `${((b + 100) / 200) * 100}%` }} />
      ))}
      <span
        className={cn("absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface", score >= 15 ? "bg-up" : score <= -15 ? "bg-down" : "bg-accent")}
        style={{ left: `${pos}%` }}
      />
    </div>
  );
}

function Arrow({ d }: { d: "up" | "down" | "flat" }) {
  return d === "up" ? (
    <span className="inline-flex items-center gap-0.5 text-up"><ArrowUp className="size-3.5" /> Up</span>
  ) : d === "down" ? (
    <span className="inline-flex items-center gap-0.5 text-down"><ArrowDown className="size-3.5" /> Down</span>
  ) : (
    <span className="inline-flex items-center gap-0.5 text-muted"><Minus className="size-3.5" /> Flat</span>
  );
}

function FwdCell({ f }: { f: Fwd | null }) {
  if (!f) return <span className="text-faint">—</span>;
  return (
    <span className="num">
      <span className={f.medianPercent >= 0 ? "text-up" : "text-down"}>{formatPercent(f.medianPercent, { digits: 1 })}</span>
      <span className="ml-1 text-[0.6875rem] text-muted">up {f.upPercent.toFixed(0)}%</span>
    </span>
  );
}

const th = "px-3 py-2 text-left text-[0.6875rem] font-medium text-muted whitespace-nowrap";
const td = "px-3 py-2 whitespace-nowrap";

const ADVICE: Record<Payload["direction"]["regime"], string> = {
  up: "Conditions favour buying strength. Breakouts and volume surges have worked best in markets like this; keep the trend exit on every position.",
  sideways: "No clear lean. Be selective, take smaller positions, and prefer setups that worked in sideways markets (see Strategies).",
  down: "Most coins are falling. New buys have had poor odds in markets like this: protect capital, respect exits, and wait for the score to turn up before adding risk.",
};

export function DirectionWorkspace() {
  const { data, error, loading } = useApi<Payload>("/api/direction", { refreshInterval: 5 * 60_000 });

  if (loading) {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-xs text-muted"><Compass className="size-3.5 animate-pulse-soft" /> Reading the market: BTC trend, breadth across ~100 coins, mood… (first load can take up to a minute)</p>
        {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-28 w-full" />)}
      </div>
    );
  }
  if (error || !data) return <Notice tone="down" title="Market direction unavailable">{error?.message}</Notice>;

  const d = data.direction;
  const tone = zoneTone(d.zone);
  const change = d.scoreWeekAgo !== null ? d.score - d.scoreWeekAgo : null;
  const now = d.history.find((h) => h.zone === d.zone);
  const span = d.series.length > 1 ? d.series[d.series.length - 1]!.t - d.series[0]!.t : 0;

  return (
    <div className="space-y-4">
      <Panel>
        <PanelBody className="grid items-center gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div>
            <p className="label-caps">The market is in a</p>
            <p className={cn("mt-1 text-2xl font-semibold tracking-tight", toneText[tone])}>{d.zoneLabel}</p>
            <p className="num mt-1 text-sm text-muted">
              Score <span className={cn("font-semibold", toneText[tone])}>{d.score > 0 ? "+" : ""}{d.score}</span> of ±100
              {change !== null ? (
                <span className={cn("ml-2", change >= 0 ? "text-up" : "text-down")}>
                  {change >= 0 ? "▲" : "▼"} {Math.abs(change)} vs a week ago
                </span>
              ) : null}
            </p>
            <p className="mt-0.5 text-[0.6875rem] text-faint">
              In this zone for {d.daysInZone} day{d.daysInZone === 1 ? "" : "s"} · {d.coins} coins · {d.includesToday ? "includes today so far" : "last completed day"}
            </p>
          </div>
          <div>
            <DirectionBar score={d.score} />
            <div className="mt-1.5 flex justify-between text-[0.625rem] text-faint">
              <span>Strong down</span><span>Down</span><span>Sideways</span><span>Up</span><span>Strong up</span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-fg/85">{ADVICE[d.regime]}</p>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem]">
              <Link href="/strategies" className="text-accent hover:underline">Strategies that fit this market →</Link>
              <Link href="/autopilot" className="text-accent hover:underline">Autopilot plan →</Link>
              <Freshness fetchedAt={data.fetchedAt} stale={data.stale} />
            </p>
          </div>
        </PanelBody>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="What the score is made of" description="Six readings, each from −1 (bearish) to +1 (bullish), weighted into the score." />
          <ul className="divide-y divide-border">
            {d.components.map((c) => (
              <li key={c.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:flex-nowrap">
                <div className="relative h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                  <div className="absolute inset-y-0 left-1/2 w-px bg-border-strong" />
                  <div className={cn("absolute inset-y-0 rounded-full", c.score >= 0 ? "left-1/2 bg-up" : "right-1/2 bg-down")} style={{ width: `${Math.min(50, Math.abs(c.score) * 50)}%` }} />
                </div>
                <span className={cn("num ml-auto w-10 shrink-0 text-right text-xs sm:order-last sm:ml-0", c.score >= 0 ? "text-up" : "text-down")}>{c.score > 0 ? "+" : ""}{c.score.toFixed(2)}</span>
                <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
                  <p className="text-xs"><span className="font-medium">{c.label}</span> <span className="text-faint">· {Math.round(c.weight * 100)}% of the score</span></p>
                  <p className="text-[0.6875rem] text-muted">{c.note}</p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel>
          <PanelHeader title="Score over the last six months" description="Above +15 the market leans up, below −15 it leans down." />
          <PanelBody className="px-2">
            <div role="img" aria-label="Market direction score over time">
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={d.series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <ReferenceArea y1={15} y2={100} fill="var(--color-up)" fillOpacity={0.05} />
                  <ReferenceArea y1={-100} y2={-15} fill="var(--color-down)" fillOpacity={0.05} />
                  <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tick={CHART.tick} tickLine={false} axisLine={{ stroke: CHART.baseline }} minTickGap={50} tickFormatter={(v: number) => new Date(v).toLocaleDateString("en-US", span > 120 * 86_400_000 ? { month: "short" } : { month: "short", day: "numeric" })} />
                  <YAxis domain={[-100, 100]} ticks={[-100, -50, 0, 50, 100]} tick={CHART.tick} tickLine={false} axisLine={false} width={36} />
                  <ReferenceLine y={0} stroke={CHART.baseline} />
                  <ChartTooltip
                    isAnimationActive={false}
                    cursor={{ stroke: CHART.axis, strokeDasharray: "3 3" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0]!.payload as Payload["direction"]["series"][number];
                      return (
                        <div className="rounded-md border border-border-strong bg-surface-2/95 px-3 py-2 text-xs shadow-xl shadow-shadow/50">
                          <p className="text-muted">{formatDate(p.t)}</p>
                          <p className="num mt-1 text-sm">Score {p.score > 0 ? "+" : ""}{p.score}</p>
                          <p className="num text-muted">BTC {formatPrice(p.btc)}</p>
                        </div>
                      );
                    }}
                  />
                  <Line dataKey="score" stroke={SERIES[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="What happened after readings like this"
          description="For every past day in each zone: the typical result over the next 7 and 30 days, and how often it was positive."
        />
        <div className="overflow-x-auto">
          <table className="w-full text-[0.8125rem]">
            <thead className="border-b border-border bg-surface-2/50">
              <tr>
                <th className={th}>Zone</th>
                <th className={cn(th, "text-right")}>Days</th>
                <th className={cn(th, "text-right")}>BTC, next 7 days</th>
                <th className={cn(th, "text-right")}>BTC, next 30 days</th>
                <th className={cn(th, "text-right")}>Typical coin, 7 days</th>
                <th className={cn(th, "text-right")}>Typical coin, 30 days</th>
              </tr>
            </thead>
            <tbody>
              {d.history.map((h) => (
                <tr key={h.zone} className={cn("border-b border-border last:border-0", h.zone === d.zone && "bg-accent/5")}>
                  <td className={td}>
                    <span className={cn("font-medium", toneText[zoneTone(h.zone)])}>{data.zones.find((z) => z.key === h.zone)?.label}</span>
                    {h.zone === d.zone ? <Badge tone="accent" className="ml-2">now</Badge> : null}
                  </td>
                  <td className={cn(td, "num text-right")}>{h.days}</td>
                  <td className={cn(td, "text-right")}><FwdCell f={h.btc7} /></td>
                  <td className={cn(td, "text-right")}><FwdCell f={h.btc30} /></td>
                  <td className={cn(td, "text-right")}><FwdCell f={h.alt7} /></td>
                  <td className={cn(td, "text-right")}><FwdCell f={h.alt30} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {now?.alt30 ? (
          <p className="border-t border-border px-4 py-2.5 text-xs text-fg/85">
            After past <span className={cn("font-medium", toneText[tone])}>{d.zoneLabel.toLowerCase()}</span> readings, the typical coin was{" "}
            {formatPercent(now.alt30.medianPercent, { digits: 1 })} a month later and higher only {now.alt30.upPercent.toFixed(0)}% of the time
            {now.btc30 ? `; BTC was ${formatPercent(now.btc30.medianPercent, { digits: 1 })} and higher ${now.btc30.upPercent.toFixed(0)}% of the time` : ""}.
          </p>
        ) : null}
      </Panel>

      <Panel>
        <PanelHeader title="Trend by timeframe" description="4-hour, daily and weekly charts for the majors, your holdings and your watchlist. A coin is strongest when all three agree." />
        <div className="overflow-x-auto">
          <table className="w-full text-[0.8125rem]">
            <thead className="border-b border-border bg-surface-2/50">
              <tr>
                <th className={th}>Coin</th>
                <th className={cn(th, "text-right")}>Price</th>
                <th className={th}>4 hours</th>
                <th className={th}>Daily</th>
                <th className={th}>Weekly</th>
                <th className={th}>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {data.timeframes.map((c) => {
                const t = (i: string) => c.trends.find((x) => x.interval === i);
                return (
                  <tr key={c.symbol} className="border-b border-border last:border-0">
                    <td className={td}><Link href={`/crypto/${c.symbol}`} className="font-medium hover:text-accent">{c.symbol.replace(/USDT$/, "")}</Link></td>
                    <td className={cn(td, "num text-right")}>{formatPrice(c.price)}</td>
                    {(["4h", "1d", "1w"] as const).map((i) => (
                      <td key={i} className={cn(td, "text-xs")}>{t(i) ? <Arrow d={t(i)!.direction} /> : <span className="text-faint">—</span>}</td>
                    ))}
                    <td className={td}>
                      {c.aligned === "up" ? <Badge tone="up">All up</Badge> : c.aligned === "down" ? <Badge tone="down">All down</Badge> : <Badge tone="neutral">Mixed</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border px-4 py-2.5 text-[0.6875rem] text-muted">
          Each timeframe: price vs its 20-period average, the 20 vs the 50, and MACD direction. Up or Down needs at least two of the three to agree.
        </p>
      </Panel>

      <Notice tone="warn" title="How to use this">
        <span className="flex items-start gap-1.5">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            The score tells you which way the market is leaning now; it is not a forecast. The table above is its honest record: in this data,
            BTC was up about half the time a week after every kind of reading, and strong uptrends were often followed by weak altcoin returns.
            Use it to choose how much risk to take and which strategies fit, not to predict next week. Days in a zone overlap, so the sample is
            smaller than the day counts suggest.
          </span>
        </span>
      </Notice>
    </div>
  );
}
