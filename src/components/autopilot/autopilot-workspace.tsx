"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronDown, Eye, FlaskConical, Gauge, GraduationCap, LineChart, RefreshCw, ShieldAlert, Users } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { Badge, Button, EmptyState, Notice, Panel, PanelBody, PanelHeader, Skeleton } from "@/components/ui/primitives";
import { Segmented, Tooltip } from "@/components/ui/radix";
import { Freshness } from "@/components/market/indicators";
import { TradeDialog, type TradeContext } from "@/components/portfolio/trade-dialog";
import { AskAIButton } from "@/components/research/ask-ai-button";
import { LevelAlertsButton } from "@/components/alerts/level-alerts-button";
import { ModelProbability, type ModelView } from "@/components/learning/model-view-card";
import { AccuracyGauge } from "@/components/learning/accuracy-gauge";
import { OutcomeBadge, type Prediction } from "@/components/chat/verdict-card";
import { SIGNAL_INFO, type DiscoverySignal } from "@/services/discovery/signals";
import { cn, formatPercent, formatPrice, formatRelative, formatUsd } from "@/lib/utils/format";

type Action = "BUY" | "ADD" | "HOLD" | "TRIM" | "SELL" | "WATCH" | "NEUTRAL" | "AVOID";

interface Rec {
  symbol: string;
  baseAsset: string;
  name: string | null;
  price: number;
  action: Action;
  score: number;
  confidence: number;
  timing: "now" | "wait_for_pullback" | "on_breakout" | "exit_now" | "on_bounce" | "none";
  timingNote: string;
  entry: { low: number; high: number } | null;
  target: number | null;
  stop: number | null;
  riskReward: number | null;
  suggestedAmount: number | null;
  suggestedAllocationPercent: number | null;
  sellPercent: number | null;
  factors: Array<{ name: string; score: number; weight: number; note: string }>;
  reasonsFor: string[];
  reasonsAgainst: string[];
  signals: DiscoverySignal[];
  cautions: string[];
  holding: { quantity: number; averageCost: number; marketValue: number; pnlPercent: number } | null;
  btcCorrelation?: number | null;
  exitPlan?: { trendLine: number | null; trendBroken: boolean; hardStop: number | null; hardStopHit: boolean; cushionPercent: number | null } | null;
  model?: ModelView | null;
  rawConfidence?: number;
}

interface Plan {
  generatedAt: string;
  scanFetchedAt: string;
  stale: boolean;
  regime: { mode: "risk_on" | "neutral" | "risk_off"; sizeMultiplier: number; score: number; notes: string[] };
  fearGreed: { value: number; label: string; weekAgo: number | null } | null;
  smartMoney: { window: string; tradersSampled: number; entries: Array<{ symbol: string; longs: number; shorts: number; traders: number }> } | null;
  sizing: { portfolioValue: number; cash: number; riskPerTradePercent: number; maxPositionPercent: number; cashAfterBuys: number };
  universe: { scanned: number; analysed: number };
  risk: {
    lossAtStops: number;
    lossAtStopsPercent: number;
    unprotected: string[];
    largestPosition: { symbol: string; percent: number } | null;
    top3Percent: number;
    cashPercent: number;
    btcCorrelation: number | null;
    warnings: string[];
  };
  signalLabAvailable: boolean;
  learning: { trainedAt: string; testAuc: number; trust: number; baseRate: number } | null;
  recommendations: Rec[];
  tradeContexts: Record<string, TradeContext>;
  trackRecord: { summary: { total: number; pending: number; correct: number; incorrect: number; inconclusive: number; hitRatePercent: number | null; avgConfidence: number | null }; recent: Prediction[] } | null;
}

const ACTION_STYLE: Record<Action, { label: string; tone: "up" | "down" | "accent" | "warn" | "neutral" | "info" }> = {
  BUY: { label: "Buy", tone: "up" },
  ADD: { label: "Add", tone: "up" },
  HOLD: { label: "Hold", tone: "neutral" },
  TRIM: { label: "Trim", tone: "warn" },
  SELL: { label: "Sell", tone: "down" },
  WATCH: { label: "Watch", tone: "info" },
  NEUTRAL: { label: "No edge", tone: "neutral" },
  AVOID: { label: "Avoid", tone: "down" },
};

const TIMING_LABEL: Record<Rec["timing"], string> = {
  now: "Act now",
  wait_for_pullback: "Wait for pullback",
  on_breakout: "On breakout",
  exit_now: "Exit now",
  on_bounce: "Into the bounce",
  none: "",
};

const REGIME = {
  risk_on: { label: "Risk-on", tone: "up" as const, text: "Market backdrop supports buying; full position sizes." },
  neutral: { label: "Neutral", tone: "neutral" as const, text: "Mixed backdrop; buy sizes reduced to 75%." },
  risk_off: { label: "Risk-off", tone: "down" as const, text: "Weak backdrop; new buys paused, sizes cut to 40% for adds. Protect capital." },
};

function ScoreBar({ score }: { score: number }) {
  const pos = score >= 0;
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-28 overflow-hidden rounded-full bg-surface-3" role="meter" aria-valuemin={-100} aria-valuemax={100} aria-valuenow={score} aria-label="Score">
        <div className="absolute inset-y-0 left-1/2 w-px bg-border-strong" />
        <div
          className={cn("absolute inset-y-0 rounded-full", pos ? "left-1/2 bg-up" : "right-1/2 bg-down")}
          style={{ width: `${Math.min(50, Math.abs(score) / 2)}%` }}
        />
      </div>
      <span className={cn("num w-9 text-xs", pos ? "text-up" : "text-down")}>{score > 0 ? "+" : ""}{score}</span>
    </div>
  );
}

function Level({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "up" | "down" }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.625rem] uppercase tracking-wide text-faint">{label}</p>
      <p className={cn("num truncate text-[0.78125rem]", tone === "up" && "text-up", tone === "down" && "text-down")}>
        {value}
        {sub ? <span className="ml-1 text-[0.65625rem] text-muted">{sub}</span> : null}
      </p>
    </div>
  );
}

function RecCard({ r, ctx }: { r: Rec; ctx: TradeContext | undefined }) {
  const [open, setOpen] = useState(false);
  const style = ACTION_STYLE[r.action];
  const pct = (v: number | null) => (v === null ? undefined : formatPercent(((v - r.price) / r.price) * 100, { digits: 1 }));
  const isSell = r.action === "SELL" || r.action === "TRIM";
  const canTrade = ctx && (r.action === "BUY" || r.action === "ADD" || isSell);

  return (
    <div className={cn("rounded-lg border bg-surface p-3", r.action === "BUY" || r.action === "ADD" ? "border-up/30" : isSell ? "border-down/30" : "border-border")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone={style.tone} className="text-xs">
            {r.action === "BUY" || r.action === "ADD" ? <ArrowUpRight className="size-3" /> : isSell ? <ArrowDownRight className="size-3" /> : null}
            {style.label}
          </Badge>
          <Link href={`/crypto/${r.symbol}`} className="text-[0.8125rem] font-semibold hover:text-accent">{r.baseAsset}</Link>
          <span className="max-w-32 truncate text-xs text-muted">{r.name}</span>
        </div>
        <div className="flex items-center gap-3">
          <ScoreBar score={r.score} />
          {r.model ? <ModelProbability view={r.model} compact /> : null}
          <Tooltip
            content={
              <span>
                Probability-style confidence that the direction is right over ~7 days. Calls are scored automatically.
                {r.rawConfidence !== undefined && r.rawConfidence !== r.confidence
                  ? ` Calibrated from ${r.rawConfidence}% using how similar past Autopilot calls actually did.`
                  : ""}
              </span>
            }
          >
            <span className="num cursor-help text-xs text-muted">
              {r.confidence}%{r.rawConfidence !== undefined && r.rawConfidence !== r.confidence ? "*" : ""}
            </span>
          </Tooltip>
        </div>
      </div>

      {r.timingNote ? (
        <p className="mt-2 text-xs">
          {TIMING_LABEL[r.timing] ? <span className="mr-1.5 font-medium text-accent">{TIMING_LABEL[r.timing]}:</span> : null}
          <span className="text-fg/85">{r.timingNote}</span>
        </p>
      ) : null}

      <div className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-6">
        <Level label="Price" value={formatPrice(r.price)} />
        {r.holding ? (
          <Level label="Your P&L" value={formatPercent(r.holding.pnlPercent, { digits: 1 })} tone={r.holding.pnlPercent >= 0 ? "up" : "down"} sub={formatUsd(r.holding.marketValue, { compact: true })} />
        ) : (
          <Level label="Entry zone" value={r.entry ? `${formatPrice(r.entry.low)}–${formatPrice(r.entry.high)}` : "—"} />
        )}
        <Level label={r.holding ? "Next resistance" : "Target"} value={formatPrice(r.target)} sub={pct(r.target)} tone="up" />
        <Level label={r.holding ? "Exit below" : "Safety stop"} value={formatPrice(r.stop)} sub={pct(r.stop)} tone="down" />
        <Level label="Reward/risk" value={r.riskReward !== null ? `${r.riskReward.toFixed(1)} : 1` : "—"} />
        <Level
          label={isSell ? "Sell" : "Size"}
          value={
            isSell
              ? `${r.sellPercent ?? 0}% · ${formatUsd(r.suggestedAmount, { compact: true })}`
              : r.suggestedAmount !== null
                ? formatUsd(r.suggestedAmount, { compact: true })
                : "—"
          }
          sub={!isSell && r.suggestedAllocationPercent !== null ? `${r.suggestedAllocationPercent.toFixed(1)}%` : undefined}
        />
      </div>

      {r.exitPlan && r.exitPlan.trendLine !== null && (r.holding || r.action === "BUY") ? (
        <p className="mt-2 rounded-md border border-border bg-surface-2/50 px-2 py-1.5 text-[0.6875rem]">
          <span className="font-medium text-fg">Exit plan:</span>{" "}
          <span className="text-muted">
            sell on a daily close below the 20-day average{" "}
            <span className={cn("num", r.exitPlan.trendBroken ? "text-down" : "text-fg")}>{formatPrice(r.exitPlan.trendLine)}</span>
            {r.exitPlan.cushionPercent !== null ? ` (${r.exitPlan.cushionPercent >= 0 ? `${r.exitPlan.cushionPercent.toFixed(1)}% below the price` : "already below it"})` : ""}
            {r.exitPlan.hardStop !== null ? (
              <>
                {" "}· safety stop <span className="num text-fg">{formatPrice(r.exitPlan.hardStop)}</span>
              </>
            ) : null}
            . No fixed profit target: let winners run.{" "}
            <Link href="/signals" className="underline">Why</Link>
          </span>
        </p>
      ) : null}

      {r.btcCorrelation != null && r.baseAsset !== "BTC" ? (
        <p className="mt-1.5 text-[0.65625rem] text-faint">
          Moves with BTC: {r.btcCorrelation >= 0.75 ? "strongly" : r.btcCorrelation >= 0.45 ? "moderately" : "weakly"} (90-day correlation {r.btcCorrelation.toFixed(2)})
        </p>
      ) : null}

      {r.signals.length || r.cautions.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {r.signals.map((s) => <Badge key={s} tone="accent" title={SIGNAL_INFO[s].description}>{SIGNAL_INFO[s].label}</Badge>)}
          {r.cautions.length ? <Badge tone="warn" title={r.cautions.join(" ")}><ShieldAlert className="size-3" /> {r.cautions.length} risk flag{r.cautions.length > 1 ? "s" : ""}</Badge> : null}
        </div>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {canTrade ? (
          <TradeDialog
            side={isSell ? "sell" : "buy"}
            ctx={ctx!}
            trigger={
              <Button size="sm" variant={isSell ? "secondary" : "primary"}>
                Paper {isSell ? "sell" : "buy"}
              </Button>
            }
          />
        ) : null}
        {r.action === "BUY" || r.action === "ADD" || r.action === "HOLD" || r.action === "WATCH" ? (
          <LevelAlertsButton symbol={r.symbol} price={r.price} stop={r.stop} target={r.target} source="Autopilot" />
        ) : null}
        <AskAIButton symbol={r.symbol} label="Ask AI" />
        <Link href={`/crypto/${r.symbol}`} className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg"><LineChart className="size-3.5" /> Chart</Link>
        <button type="button" onClick={() => setOpen((o) => !o)} className="ml-auto inline-flex items-center gap-1 text-xs text-muted hover:text-fg" aria-expanded={open}>
          Why <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open ? (
        <div className="mt-2.5 grid gap-3 border-t border-border pt-2.5 text-xs sm:grid-cols-2">
          <div>
            <p className="mb-1 font-medium text-up">For</p>
            {r.reasonsFor.length ? <ul className="space-y-1 text-fg/85">{r.reasonsFor.map((x) => <li key={x}>• {x}</li>)}</ul> : <p className="text-faint">Nothing notable.</p>}
          </div>
          <div>
            <p className="mb-1 font-medium text-down">Against</p>
            {r.reasonsAgainst.length ? <ul className="space-y-1 text-fg/85">{r.reasonsAgainst.map((x) => <li key={x}>• {x}</li>)}</ul> : <p className="text-faint">Nothing notable.</p>}
          </div>
          <div className="sm:col-span-2">
            <p className="mb-1 text-muted">Factor scores (−2 … +2, weight)</p>
            <div className="flex flex-wrap gap-1.5">
              {r.factors.map((f) => (
                <span key={f.name} className={cn("rounded-sm border px-1.5 py-0.5 font-mono text-[0.65625rem]", f.score > 0 ? "border-up/30 text-up" : f.score < 0 ? "border-down/30 text-down" : "border-border text-muted")}>
                  {f.name} {f.score > 0 ? "+" : ""}{f.score.toFixed(1)} ×{f.weight}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, description, recs, ctx, empty }: { title: string; description: string; recs: Rec[]; ctx: Plan["tradeContexts"]; empty: string }) {
  return (
    <Panel>
      <PanelHeader title={`${title} (${recs.length})`} description={description} />
      <PanelBody className="grid gap-3 lg:grid-cols-2">
        {recs.length ? recs.map((r) => <RecCard key={r.symbol} r={r} ctx={ctx[r.symbol]} />) : <p className="text-xs text-muted">{empty}</p>}
      </PanelBody>
    </Panel>
  );
}

export function AutopilotWorkspace() {
  const [risk, setRisk] = useState("1");
  const [maxPos, setMaxPos] = useState("15");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const url = `/api/autopilot?risk=${risk}&maxPosition=${maxPos}`;
  // The plan is rebuilt server-side every 5 minutes; pick the new one up without a reload.
  const { data, error, loading, setData } = useApi<Plan>(url, { refreshInterval: 5 * 60_000 });

  const forceRefresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      setData(await apiFetch<Plan>(`${url}&refresh=1`));
    } catch (err) {
      setRefreshError(err instanceof ApiClientError ? err.message : "Could not re-run the plan.");
    } finally {
      setRefreshing(false);
    }
  };

  const recs = data?.recommendations ?? [];
  const positions = recs.filter((r) => r.holding);
  const buys = recs.filter((r) => !r.holding && r.action === "BUY");
  const watch = recs.filter((r) => !r.holding && r.action === "WATCH");
  const avoid = recs.filter((r) => !r.holding && (r.action === "AVOID" || r.action === "NEUTRAL"));
  const tr = data?.trackRecord?.summary;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[0.6875rem] text-muted">
          <Tooltip content="How much of the portfolio you lose if a stop is hit. Position sizes are derived from this and the stop distance.">
            <span className="cursor-help underline decoration-dotted underline-offset-2">Risk per trade</span>
          </Tooltip>
          <Segmented label="Risk per trade" value={risk} onChange={setRisk} options={[{ value: "0.5", label: "0.5%" }, { value: "1", label: "1%" }, { value: "2", label: "2%" }]} />
        </label>
        <label className="flex items-center gap-2 text-[0.6875rem] text-muted">
          Max per position
          <Segmented label="Max per position" value={maxPos} onChange={setMaxPos} options={[{ value: "10", label: "10%" }, { value: "15", label: "15%" }, { value: "25", label: "25%" }]} />
        </label>
        <div className="ml-auto flex items-center gap-2">
          {data ? <Freshness fetchedAt={data.scanFetchedAt} stale={data.stale} /> : null}
          {data ? <span className="text-[0.6875rem] text-faint">plan {formatRelative(data.generatedAt)}</span> : null}
          <Button size="sm" variant="secondary" loading={refreshing} onClick={() => void forceRefresh()}>
            <RefreshCw className="size-3.5" /> Re-run
          </Button>
        </div>
      </div>

      {error || refreshError ? <Notice tone="down" title="Autopilot could not build a plan">{refreshError ?? error?.message}</Notice> : null}

      {loading ? (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-xs text-muted"><Gauge className="size-3.5 animate-pulse-soft" /> Scanning the market, futures positioning, order books and top traders… (first run can take up to a minute)</p>
          {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : data ? (
        <>
          <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr_1fr]">
            <Panel>
              <PanelHeader title={<span className="flex items-center gap-2">Market regime <Badge tone={REGIME[data.regime.mode].tone}>{REGIME[data.regime.mode].label}</Badge></span>} description={REGIME[data.regime.mode].text} />
              <PanelBody>
                <ul className="space-y-1 text-xs text-fg/85">{data.regime.notes.map((n) => <li key={n}>• {n}</li>)}</ul>
              </PanelBody>
            </Panel>
            <Panel>
              <PanelHeader title="Plan" description={`${data.universe.analysed} pairs analysed in depth out of ${data.universe.scanned} scanned.`} />
              <PanelBody className="grid grid-cols-2 gap-2 text-xs">
                <div><p className="label-caps">Portfolio</p><p className="num text-sm">{formatUsd(data.sizing.portfolioValue)}</p></div>
                <div><p className="label-caps">Cash</p><p className="num text-sm">{formatUsd(data.sizing.cash)}</p></div>
                <div><p className="label-caps">Buy ideas</p><p className="num text-sm text-up">{buys.length}</p></div>
                <div><p className="label-caps">Sell / trim</p><p className="num text-sm text-down">{positions.filter((p) => p.action === "SELL" || p.action === "TRIM").length}</p></div>
                <div className="col-span-2"><p className="label-caps">Cash after suggested buys</p><p className="num text-sm">{formatUsd(data.sizing.cashAfterBuys)}</p></div>
              </PanelBody>
            </Panel>
            <Panel>
              <PanelHeader title="Autopilot track record" description="Every BUY and strong SELL/AVOID call is scored after 7 days." />
              <PanelBody className="text-xs">
                {tr && tr.total ? (
                  <>
                    <p className="flex items-baseline gap-2">
                      <span className={cn("num text-lg font-semibold", tr.hitRatePercent === null ? "text-faint" : tr.hitRatePercent >= 55 ? "text-up" : tr.hitRatePercent < 45 ? "text-down" : "")}>
                        {tr.hitRatePercent === null ? "—" : `${tr.hitRatePercent.toFixed(0)}%`}
                      </span>
                      <span className="text-muted">{tr.correct + tr.incorrect ? `${tr.correct} of ${tr.correct + tr.incorrect} right` : "nothing scored yet"}</span>
                    </p>
                    <p className="text-faint">{tr.pending} pending · {tr.inconclusive} inconclusive</p>
                    <ul className="mt-2 space-y-0.5">
                      {data.trackRecord!.recent.slice(0, 5).map((p) => (
                        <li key={p._id} className="flex items-center justify-between gap-2 text-[0.6875rem]">
                          <span className="truncate"><span className={p.bias === "bullish" ? "text-up" : "text-down"}>{p.bias === "bullish" ? "▲" : "▼"}</span> {p.symbol.replace(/USDT$/, "")} <span className="text-faint">{p.confidence}% · {formatRelative(p.timestamp)}</span></span>
                          <OutcomeBadge p={p} compact />
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-muted">Calls from this page are recorded and scored automatically; results appear here after 7 days.</p>
                )}
              </PanelBody>
            </Panel>
          </div>

          <AccuracyGauge sources={["autopilot"]} title="How often is Autopilot right?" />

          {positions.length ? (
            <Panel>
              <PanelHeader
                title={<span className="flex items-center gap-2"><ShieldAlert className="size-3.5 text-muted" /> Portfolio risk</span>}
                description="What the suggested stops protect, and how concentrated the portfolio is."
              />
              <PanelBody className="grid gap-3 text-xs sm:grid-cols-5">
                <div>
                  <p className="label-caps">Loss if all stops hit</p>
                  <p className={cn("num text-sm", data.risk.lossAtStopsPercent > 10 ? "text-down" : "")}>
                    {formatUsd(-data.risk.lossAtStops)} <span className="text-muted">({formatPercent(-data.risk.lossAtStopsPercent, { digits: 1 })})</span>
                  </p>
                  {data.risk.unprotected.length ? <p className="text-[0.65625rem] text-faint">no stop: {data.risk.unprotected.map((s) => s.replace(/USDT$/, "")).join(", ")}</p> : null}
                </div>
                <div>
                  <p className="label-caps">Largest position</p>
                  <p className="num text-sm">{data.risk.largestPosition ? `${data.risk.largestPosition.symbol.replace(/USDT$/, "")} ${data.risk.largestPosition.percent.toFixed(0)}%` : "—"}</p>
                </div>
                <div><p className="label-caps">Top 3 positions</p><p className="num text-sm">{data.risk.top3Percent.toFixed(0)}%</p></div>
                <div><p className="label-caps">Cash</p><p className="num text-sm">{data.risk.cashPercent.toFixed(0)}%</p></div>
                <div>
                  <p className="label-caps">Correlation with BTC</p>
                  <p className="num text-sm">{data.risk.btcCorrelation !== null ? data.risk.btcCorrelation.toFixed(2) : "—"}</p>
                </div>
                {data.risk.warnings.length ? (
                  <ul className="space-y-0.5 text-warn sm:col-span-5">{data.risk.warnings.map((w) => <li key={w}>• {w}</li>)}</ul>
                ) : null}
              </PanelBody>
            </Panel>
          ) : null}

          {data.learning ? (
            <p className="flex flex-wrap items-center gap-1.5 text-[0.6875rem] text-muted">
              <GraduationCap className="size-3.5" />
              Learned model trained {formatRelative(data.learning.trainedAt)} · out-of-sample AUC {data.learning.testAuc.toFixed(3)} · weight in scores{" "}
              {(data.learning.trust * 100).toFixed(0)}% of maximum.{" "}
              <Link href="/learning" className="underline">See what it learned</Link>
            </p>
          ) : (
            <Notice tone="info">
              <span className="flex items-center gap-1.5">
                <GraduationCap className="size-3.5" /> The learning model is training for the first time; the next plan will include its view.{" "}
                <Link href="/learning" className="underline">Learning</Link>
              </span>
            </Notice>
          )}

          {!data.signalLabAvailable ? (
            <Notice tone="info">
              <span className="flex items-center gap-1.5">
                <FlaskConical className="size-3.5" /> Signals are counted as simply bullish until the{" "}
                <Link href="/signals" className="underline">Signal Lab</Link> backtest has run once; after that Autopilot weights each signal by its real track record.
              </span>
            </Notice>
          ) : null}

          {data.fearGreed || data.smartMoney ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-xs">
              {data.fearGreed ? (
                <span className="flex items-center gap-1.5">
                  <Gauge className="size-3.5 text-muted" /> Fear & Greed
                  <span className={cn("num font-semibold", data.fearGreed.value <= 25 ? "text-down" : data.fearGreed.value >= 75 ? "text-up" : "")}>{data.fearGreed.value}</span>
                  <span className="text-muted">{data.fearGreed.label}{data.fearGreed.weekAgo !== null ? ` (week ago ${data.fearGreed.weekAgo})` : ""}</span>
                </span>
              ) : null}
              {data.smartMoney?.entries.length ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  <Users className="size-3.5 text-muted" />
                  <Tooltip content={<span>Positions opened in the last {data.smartMoney.window} by {data.smartMoney.tradersSampled} top Binance futures lead traders. <Link href="/traders" className="underline">See traders</Link>.</span>}>
                    <span className="cursor-help underline decoration-dotted underline-offset-2">Top traders opened</span>
                  </Tooltip>
                  {data.smartMoney.entries.slice(0, 8).map((e) => (
                    <Link key={e.symbol} href={`/crypto/${e.symbol}`} className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[0.65625rem] hover:border-accent/50">
                      {e.symbol.replace(/USDT$/, "")} <span className="text-up">{e.longs}L</span>/<span className="text-down">{e.shorts}S</span>
                    </Link>
                  ))}
                </span>
              ) : null}
            </div>
          ) : null}

          {positions.length ? (
            <Section title="Your positions" description="Hold, add, trim or sell, with the stop to watch." recs={positions} ctx={data.tradeContexts} empty="" />
          ) : null}
          <Section
            title="Buy ideas"
            description={data.regime.mode === "risk_off" ? "New buys are paused while the market is risk-off." : "Ranked by score. Sizes risk your chosen % of the portfolio if the stop is hit."}
            recs={buys}
            ctx={data.tradeContexts}
            empty={data.regime.mode === "risk_off" ? "Risk-off market: no new buys suggested. Watch the list below for when conditions improve." : "No setup currently passes the buy rules. That is a valid answer; cash is a position."}
          />
          {watch.length ? (
            <Section title="Watch" description="Promising but not confirmed, or the reward/risk is poor right now." recs={watch} ctx={data.tradeContexts} empty="" />
          ) : null}
          {avoid.length ? (
            <details className="rounded-lg border border-border bg-surface">
              <summary className="cursor-pointer px-4 py-3 text-[0.8125rem] font-semibold"><Eye className="mr-1.5 inline size-3.5 text-muted" />No edge / avoid ({avoid.length})</summary>
              <div className="grid gap-3 px-4 pb-4 lg:grid-cols-2">{avoid.map((r) => <RecCard key={r.symbol} r={r} ctx={data.tradeContexts[r.symbol]} />)}</div>
            </details>
          ) : null}

          <p className="text-[0.6875rem] leading-relaxed text-faint">
            Autopilot is a rules engine over Binance data: trend, momentum, strength vs BTC, discovery signals, historical base rates, futures positioning,
            order-book depth, top copy traders and the market regime. It never trades: buttons open the simulated trade dialog. Not financial advice:
            the scores are probabilities, many calls will be wrong, and the track record above shows how often. Use stops.
          </p>
        </>
      ) : (
        <EmptyState title="No plan yet" />
      )}
    </div>
  );
}
