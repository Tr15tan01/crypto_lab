"use client";

import Link from "@/components/ui/link";
import { useState } from "react";
import { ListChecks, TriangleAlert } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { Badge, Notice, Panel, PanelBody, PanelHeader, Select, Skeleton } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/radix";
import { Freshness } from "@/components/market/indicators";
import { cn, formatDate, formatPercent } from "@/lib/utils/format";

interface Stats {
  trades: number;
  winRatePercent: number;
  avgReturnPercent: number;
  medianReturnPercent: number;
  avgHoldDays: number;
  profitFactor: number | null;
  p10ReturnPercent: number;
  worstReturnPercent: number;
}
type Regime = "up" | "sideways" | "down";

interface Strategy {
  key: string;
  name: string;
  idea: string;
  entry: string;
  exit: string;
  overall: Stats | null;
  avgVsBtcPercent: number | null;
  byRegime: Record<Regime, Stats | null>;
  firingNow: string[];
  verdict: "worked" | "mixed" | "lost" | "few";
}

interface Payload {
  pairs: number;
  from: number | null;
  to: number | null;
  strategies: Strategy[];
  market: { score: number; zoneLabel: string; regime: Regime | null } | null;
  bestNow: string[];
  fetchedAt: string;
  stale: boolean;
}

const VERDICT = {
  worked: { label: "Worked", tone: "up" },
  mixed: { label: "Mixed", tone: "accent" },
  lost: { label: "Lost money", tone: "down" },
  few: { label: "Too few trades", tone: "neutral" },
} as const;
const REGIME_LABEL: Record<Regime, string> = { up: "Up markets", sideways: "Sideways", down: "Down markets" };

function Cell({ label, children, tone }: { label: string; children: React.ReactNode; tone?: "up" | "down" }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.625rem] uppercase tracking-wide text-faint">{label}</p>
      <p className={cn("num truncate text-[0.8125rem]", tone === "up" && "text-up", tone === "down" && "text-down")}>{children}</p>
    </div>
  );
}

function pfTone(pf: number | null | undefined) {
  return pf == null ? undefined : pf >= 1 ? ("up" as const) : ("down" as const);
}

function StrategyCard({ s, regime, best }: { s: Strategy; regime: Regime | null; best: boolean }) {
  const o = s.overall;
  const v = VERDICT[s.verdict];
  return (
    <div className={cn("rounded-lg border bg-surface p-3.5", best ? "border-accent/50" : "border-border")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-[0.8125rem] font-semibold">{s.name}</p>
        <span className="flex flex-wrap items-center gap-1.5">
          {best ? <Badge tone="accent">Best fit now</Badge> : null}
          <Badge tone={v.tone}>{v.label}</Badge>
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">{s.idea}</p>

      {o ? (
        <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-6">
          <Cell label="Profit factor" tone={pfTone(o.profitFactor)}>{o.profitFactor?.toFixed(2) ?? "—"}</Cell>
          <Cell label="Avg per trade" tone={o.avgReturnPercent >= 0 ? "up" : "down"}>{formatPercent(o.avgReturnPercent, { digits: 1 })}</Cell>
          <Cell label="vs holding BTC" tone={(s.avgVsBtcPercent ?? 0) >= 0 ? "up" : "down"}>{formatPercent(s.avgVsBtcPercent, { digits: 1 })}</Cell>
          <Cell label="Win rate">{o.winRatePercent.toFixed(0)}%</Cell>
          <Cell label="Days held">{o.avgHoldDays.toFixed(0)}</Cell>
          <Cell label="Trades">{o.trades}</Cell>
        </div>
      ) : (
        <p className="mt-3 text-xs text-faint">No completed trades in the test period.</p>
      )}

      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {(["up", "sideways", "down"] as const).map((r) => {
          const st = s.byRegime[r];
          return (
            <div key={r} className={cn("rounded-md border px-2 py-1.5", r === regime ? "border-accent/40 bg-accent/5" : "border-border")}>
              <p className="text-[0.625rem] text-faint">{REGIME_LABEL[r]}{r === regime ? " · now" : ""}</p>
              {st ? (
                <p className="num text-xs">
                  <span className={st.profitFactor != null && st.profitFactor >= 1 ? "text-up" : "text-down"}>{st.profitFactor?.toFixed(2) ?? "—"}</span>
                  <span className="ml-1 text-[0.6875rem] text-muted">{formatPercent(st.avgReturnPercent, { digits: 1 })} · {st.trades}</span>
                </p>
              ) : (
                <p className="text-xs text-faint">too few</p>
              )}
            </div>
          );
        })}
      </div>

      <dl className="mt-3 space-y-1 text-xs">
        <div><dt className="inline font-medium text-up">Entry: </dt><dd className="inline text-muted">{s.entry}</dd></div>
        <div><dt className="inline font-medium text-down">Exit: </dt><dd className="inline text-muted">{s.exit}</dd></div>
        {o ? (
          <div>
            <dt className="inline font-medium text-fg">Risk: </dt>
            <dd className="inline text-muted">1 trade in 10 lost more than {Math.abs(o.p10ReturnPercent).toFixed(0)}%; the worst lost {Math.abs(o.worstReturnPercent).toFixed(0)}%.</dd>
          </div>
        ) : null}
      </dl>

      {s.firingNow.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-border pt-2.5 text-[0.6875rem]">
          <span className="text-muted">Entry triggered in the last 2 days:</span>
          {s.firingNow.slice(0, 10).map((sym) => (
            <Link key={sym} href={`/crypto/${sym}`} className="rounded-sm border border-border px-1.5 py-0.5 font-mono hover:border-accent/50">{sym.replace(/USDT$/, "")}</Link>
          ))}
          {s.firingNow.length > 10 ? <span className="text-faint">+{s.firingNow.length - 10}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

type Sort = "pf" | "now" | "avg" | "trades";

export function StrategyLab() {
  const { data, error, loading } = useApi<Payload>("/api/strategies");
  const [sort, setSort] = useState<Sort>("pf");

  if (loading) {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-xs text-muted"><ListChecks className="size-3.5 animate-pulse-soft" /> Replaying every strategy on ~2.5 years of daily data for 100 coins… (first run up to a minute, then cached for 12 hours)</p>
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-40 w-full" />)}
      </div>
    );
  }
  if (error || !data) return <Notice tone="down" title="Strategy results unavailable">{error?.message}</Notice>;

  const regime = data.market?.regime ?? null;
  const baseline = data.strategies.find((s) => s.key === "baseline");
  const pfIn = (s: Strategy) => (regime ? (s.byRegime[regime]?.profitFactor ?? -1) : (s.overall?.profitFactor ?? -1));
  const list = data.strategies
    .filter((s) => s.key !== "baseline")
    .sort((a, b) =>
      sort === "now" ? pfIn(b) - pfIn(a) : sort === "avg" ? (b.overall?.avgReturnPercent ?? -99) - (a.overall?.avgReturnPercent ?? -99) : sort === "trades" ? (b.overall?.trades ?? 0) - (a.overall?.trades ?? 0) : (b.overall?.profitFactor ?? -1) - (a.overall?.profitFactor ?? -1),
    );
  const best = data.strategies.filter((s) => data.bestNow.includes(s.key)).sort((a, b) => pfIn(b) - pfIn(a));
  const anyProfitableNow = best.some((s) => pfIn(s) >= 1);

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              Suggested for the market right now
              {data.market ? (
                <Badge tone={regime === "up" ? "up" : regime === "down" ? "down" : "neutral"}>
                  {data.market.zoneLabel} · {data.market.score > 0 ? "+" : ""}{data.market.score}
                </Badge>
              ) : null}
            </span>
          }
          description={regime ? `The strategies with the best record in ${REGIME_LABEL[regime].toLowerCase()}, judged only by trades that were opened in such markets.` : "Market direction is unavailable, so strategies are ranked by their overall record."}
          actions={<Link href="/direction" className="text-[0.6875rem] text-accent hover:underline">Market direction →</Link>}
        />
        <PanelBody>
          {best.length ? (
            <>
              {!anyProfitableNow ? (
                <Notice tone="warn" className="mb-3">
                  None of the strategies made money on trades opened in markets like this one. The least bad are listed, but the record says to stay
                  mostly in cash until the direction improves.
                </Notice>
              ) : null}
              <ol className="space-y-2">
                {best.map((s, i) => {
                  const st = regime ? s.byRegime[regime] : s.overall;
                  return (
                    <li key={s.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
                      <span className="num text-faint">{i + 1}.</span>
                      <a href={`#${s.key}`} className="font-medium hover:text-accent">{s.name}</a>
                      {st ? (
                        <span className="num text-muted">
                          profit factor <span className={st.profitFactor != null && st.profitFactor >= 1 ? "text-up" : "text-down"}>{st.profitFactor?.toFixed(2)}</span> ·{" "}
                          {formatPercent(st.avgReturnPercent, { digits: 1 })} per trade · {st.trades} trades · won {st.winRatePercent.toFixed(0)}%
                        </span>
                      ) : null}
                      {s.firingNow.length ? <span className="text-accent">{s.firingNow.length} coin{s.firingNow.length > 1 ? "s" : ""} triggered</span> : <span className="text-faint">no coin triggered now</span>}
                    </li>
                  );
                })}
              </ol>
            </>
          ) : (
            <p className="text-xs text-muted">Not enough trades in this kind of market to rank strategies.</p>
          )}
        </PanelBody>
      </Panel>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[0.6875rem] text-muted">
          Sort by
          <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-7 w-52 text-xs" aria-label="Sort strategies">
            <option value="pf">Profit factor (overall)</option>
            <option value="now">Profit factor in today&apos;s market</option>
            <option value="avg">Average result per trade</option>
            <option value="trades">Number of trades</option>
          </Select>
        </label>
        <span className="text-[0.6875rem] text-muted">
          {data.pairs} coins · {data.from ? formatDate(data.from) : "—"} → {data.to ? formatDate(data.to) : "—"}
        </span>
        <span className="ml-auto"><Freshness fetchedAt={data.fetchedAt} stale={data.stale} /></span>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {list.map((s) => (
          <div key={s.key} id={s.key} className="scroll-mt-24">
            <StrategyCard s={s} regime={regime} best={data.bestNow.includes(s.key) && pfIn(s) >= 1} />
          </div>
        ))}
      </div>

      {baseline?.overall ? (
        <Panel>
          <PanelHeader
            title="The yardstick: no strategy at all"
            description="Buying any coin on any day and selling 30 days later. A strategy is only worth the effort if it clearly beats this."
          />
          <PanelBody className="grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-6">
            <Cell label="Profit factor" tone={pfTone(baseline.overall.profitFactor)}>{baseline.overall.profitFactor?.toFixed(2) ?? "—"}</Cell>
            <Cell label="Avg per trade" tone={baseline.overall.avgReturnPercent >= 0 ? "up" : "down"}>{formatPercent(baseline.overall.avgReturnPercent, { digits: 1 })}</Cell>
            <Cell label="vs holding BTC" tone={(baseline.avgVsBtcPercent ?? 0) >= 0 ? "up" : "down"}>{formatPercent(baseline.avgVsBtcPercent, { digits: 1 })}</Cell>
            <Cell label="Win rate">{baseline.overall.winRatePercent.toFixed(0)}%</Cell>
            <Cell label="Bad trade (1 in 10)" tone="down">{formatPercent(baseline.overall.p10ReturnPercent, { digits: 0 })}</Cell>
            <Cell label="Trades">{baseline.overall.trades}</Cell>
          </PanelBody>
        </Panel>
      ) : null}

      <Notice tone="warn" title="How to read this">
        <span className="flex items-start gap-1.5">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <Tooltip content="Total gains divided by total losses across all trades. Above 1 the strategy made money.">
              <span className="cursor-help underline decoration-dotted underline-offset-2">Profit factor</span>
            </Tooltip>{" "}
            matters more than win rate: the best strategies here lose more often than they win, with winners several times the size of their
            losers. Results are from daily closes on coins listed today, with no fees or slippage, over a period when most altcoins fell; a
            strategy that lost here can work in a different market, and the reverse. Test any of them in the paper portfolio first.
          </span>
        </span>
      </Notice>
    </div>
  );
}
