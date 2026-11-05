"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ExternalLink, Plus, RefreshCw, TriangleAlert, UserPlus } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { Badge, Button, EmptyState, Field, Input, Notice, Panel, PanelHeader, Select, Skeleton, Textarea } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogTrigger, Segmented, Tabs, TabsContent, TabsList, TabsTrigger, Tooltip } from "@/components/ui/radix";
import { ChangeText, Freshness } from "@/components/market/indicators";
import { cn, formatCompact, formatPercent, formatRelative, formatUsd } from "@/lib/utils/format";
import { Sparkline, StrategyBadge, formatHours, initials } from "./shared";

interface LeaderRow {
  portfolioId: string;
  name: string;
  profileUrl: string;
  roiPercent: number | null;
  pnl: number | null;
  maxDrawdownPercent: number | null;
  winRatePercent: number | null;
  aum: number | null;
  copierPnl: number | null;
  copiers: number | null;
  roiSeries: Array<{ t: number; roi: number }>;
  weeklyReturnPercent: number | null;
  dailyReturnPercent: number | null;
  trackedId: string | null;
}

interface Leaderboard {
  rows: LeaderRow[];
  fetchedAt: string;
  stale: boolean;
}

interface TrackedRow {
  trader: {
    _id: string;
    source: "binance_copy" | "manual";
    name: string;
    profileUrl: string | null;
    startingValue: number | null;
    startingValueSource: "user" | "implied" | null;
    lastSyncedAt: string | null;
    lastSyncError: string | null;
  };
  returns: {
    dailyReturnPercent: number | null;
    weeklyReturnPercent: number | null;
    monthlyRoiPercent: number | null;
    maxDrawdownPercent: number | null;
    winRatePercent: number | null;
  };
  stats: { trades: number; open: number; avgHoldingHours: number | null; topCoins: string[] };
  strategy: { status: "changing" | "stable" | "insufficient_data"; score: number };
}

type Range = "7D" | "30D" | "90D";
type Sort = "ROI" | "PNL";

const th = "px-3 py-2 text-left text-[0.6875rem] font-medium text-muted whitespace-nowrap";
const td = "px-3 py-2 whitespace-nowrap";

function Avatar({ name }: { name: string }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface-3 font-mono text-[0.625rem] font-semibold text-muted">
      {initials(name)}
    </span>
  );
}

/* ───────────── Add a manual trader ───────────── */

function AddManualTrader({ onAdded }: { onAdded: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [start, setStart] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const startingValue = Number(start);
    if (!name.trim()) return setError("Enter a name.");
    if (!Number.isFinite(startingValue) || startingValue <= 0) return setError("Starting value must be a positive number.");
    setSaving(true);
    setError(null);
    try {
      const doc = await apiFetch<{ _id: string }>("/api/traders", {
        method: "POST",
        json: { source: "manual", name: name.trim(), profileUrl: url.trim() || null, startingValue, notes: notes.trim() || undefined },
      });
      setOpen(false);
      onAdded(doc._id);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not add the trader.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <UserPlus className="size-3.5" /> Add trader manually
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Track a trader manually"
        description="For traders outside Binance copy trading (X, Telegram, another exchange). You log their trades or paste a CSV; the app computes the metrics."
      >
        <div className="space-y-3">
          <Field label="Name" htmlFor="t-name">
            <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Profile link" htmlFor="t-url" hint="Optional, e.g. their X or exchange profile.">
            <Input id="t-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          </Field>
          <Field label="Starting portfolio value (USDT)" htmlFor="t-start" hint="Returns and drawdown are measured from this.">
            <Input id="t-start" inputMode="decimal" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Notes" htmlFor="t-notes">
            <Textarea id="t-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} />
          </Field>
          {error ? <Notice tone="down">{error}</Notice> : null}
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => void save()} loading={saving}>
              Add trader
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────── Tracked ───────────── */

function TrackedTab() {
  const router = useRouter();
  const { data, error, loading } = useApi<TrackedRow[]>("/api/traders");

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3">
        <p className="text-xs text-muted">Traders you follow. Binance traders re-sync hourly; manual traders update when you add trades.</p>
        <AddManualTrader onAdded={(id) => router.push(`/traders/${id}`)} />
      </div>
      {error ? <Notice tone="down" className="mx-4 mb-3">{error.message}</Notice> : null}
      {loading ? (
        <div className="space-y-2 p-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
      ) : !data?.length ? (
        <EmptyState
          title="No traders tracked yet"
          description="Open the Discover tab to track a top Binance copy trader, or add one manually."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[0.8125rem]">
            <thead className="border-y border-border bg-surface-2/50">
              <tr>
                <th className={th}>Trader</th>
                <th className={th}>Start value</th>
                <th className={cn(th, "text-right")}>Day</th>
                <th className={cn(th, "text-right")}>Week</th>
                <th className={cn(th, "text-right")}>Month ROI</th>
                <th className={cn(th, "text-right")}>Max DD</th>
                <th className={cn(th, "text-right")}>Win rate</th>
                <th className={cn(th, "text-right")}>Trades</th>
                <th className={cn(th, "text-right")}>Avg hold</th>
                <th className={th}>Top coins</th>
                <th className={th}>Strategy</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.trader._id} className="border-b border-border last:border-0 hover:bg-surface-2/50">
                  <td className={td}>
                    <Link href={`/traders/${r.trader._id}`} className="flex items-center gap-2 hover:text-accent">
                      <Avatar name={r.trader.name} />
                      <span className="max-w-44 truncate font-medium">{r.trader.name}</span>
                      <Badge tone={r.trader.source === "manual" ? "neutral" : "info"}>{r.trader.source === "manual" ? "Manual" : "Binance"}</Badge>
                    </Link>
                    {r.trader.lastSyncError ? <p className="mt-0.5 text-[0.65625rem] text-warn">{r.trader.lastSyncError}</p> : null}
                  </td>
                  <td className={cn(td, "num")}>
                    {formatUsd(r.trader.startingValue, { compact: true })}
                    {r.trader.startingValueSource === "implied" ? <span className="ml-1 text-[0.625rem] text-faint">implied</span> : null}
                  </td>
                  <td className={cn(td, "text-right")}><ChangeText value={r.returns.dailyReturnPercent} /></td>
                  <td className={cn(td, "text-right")}><ChangeText value={r.returns.weeklyReturnPercent} /></td>
                  <td className={cn(td, "text-right")}><ChangeText value={r.returns.monthlyRoiPercent} /></td>
                  <td className={cn(td, "num text-right text-down")}>{r.returns.maxDrawdownPercent !== null ? `−${r.returns.maxDrawdownPercent.toFixed(1)}%` : "—"}</td>
                  <td className={cn(td, "num text-right")}>{formatPercent(r.returns.winRatePercent, { sign: false, digits: 0 })}</td>
                  <td className={cn(td, "num text-right")}>{r.stats.trades}{r.stats.open ? <span className="text-faint"> · {r.stats.open} open</span> : null}</td>
                  <td className={cn(td, "num text-right")}>{formatHours(r.stats.avgHoldingHours)}</td>
                  <td className={cn(td, "text-xs text-muted")}>{r.stats.topCoins.map((c) => c.replace(/USDT$/, "")).join(", ") || "—"}</td>
                  <td className={td}><StrategyBadge status={r.strategy.status} score={r.strategy.score} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ───────────── Discover ───────────── */

function DiscoverTab() {
  const router = useRouter();
  const [range, setRange] = useState<Range>("30D");
  const [sort, setSort] = useState<Sort>("PNL");
  const [maxDd, setMaxDd] = useState("50");
  const [minWin, setMinWin] = useState("0");
  const [minStart, setMinStart] = useState("1000");
  const [busy, setBusy] = useState<string | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);
  const { data, error, loading, refresh } = useApi<Leaderboard>(`/api/traders/leaderboard?range=${range}&sort=${sort}`);

  const rows = useMemo(() => {
    const dd = Number(maxDd);
    const win = Number(minWin);
    const start = Number(minStart);
    return (data?.rows ?? []).filter((r) => {
      const implied = r.pnl !== null && r.roiPercent ? r.pnl / (r.roiPercent / 100) : null;
      return (
        (dd >= 100 || (r.maxDrawdownPercent ?? 100) <= dd) &&
        (r.winRatePercent ?? 0) >= win &&
        (start <= 0 || (implied !== null && implied >= start))
      );
    });
  }, [data, maxDd, minWin, minStart]);

  const track = async (portfolioId: string) => {
    setBusy(portfolioId);
    setTrackError(null);
    try {
      const doc = await apiFetch<{ _id: string }>("/api/traders", { method: "POST", json: { source: "binance_copy", portfolioId } });
      router.push(`/traders/${doc._id}`);
    } catch (err) {
      setTrackError(err instanceof ApiClientError ? err.message : "Could not track this trader.");
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 px-4 pb-3">
        <Segmented label="Time range" value={range} onChange={setRange} options={[{ value: "7D", label: "7D" }, { value: "30D", label: "30D" }, { value: "90D", label: "90D" }]} />
        <Segmented label="Sort by" value={sort} onChange={setSort} options={[{ value: "PNL", label: "Profit" }, { value: "ROI", label: "ROI %" }]} />
        <label className="flex items-center gap-1.5 text-[0.6875rem] text-muted">
          Max drawdown
          <Select value={maxDd} onChange={(e) => setMaxDd(e.target.value)} className="h-7 w-24 text-xs">
            <option value="100">any</option>
            <option value="50">≤ 50%</option>
            <option value="30">≤ 30%</option>
            <option value="20">≤ 20%</option>
          </Select>
        </label>
        <label className="flex items-center gap-1.5 text-[0.6875rem] text-muted">
          Win rate
          <Select value={minWin} onChange={(e) => setMinWin(e.target.value)} className="h-7 w-24 text-xs">
            <option value="0">any</option>
            <option value="50">≥ 50%</option>
            <option value="60">≥ 60%</option>
            <option value="70">≥ 70%</option>
          </Select>
        </label>
        <label className="flex items-center gap-1.5 text-[0.6875rem] text-muted">
          <Tooltip content="Capital implied by profit ÷ ROI. Huge ROI on a tiny account is often luck with high leverage.">
            <span className="cursor-help underline decoration-dotted underline-offset-2">Start capital</span>
          </Tooltip>
          <Select value={minStart} onChange={(e) => setMinStart(e.target.value)} className="h-7 w-24 text-xs">
            <option value="0">any</option>
            <option value="1000">≥ 1K</option>
            <option value="10000">≥ 10K</option>
            <option value="100000">≥ 100K</option>
          </Select>
        </label>
        <div className="ml-auto flex items-center gap-2">
          {data ? <Freshness fetchedAt={data.fetchedAt} stale={data.stale} /> : null}
          <Button size="sm" variant="ghost" onClick={() => void refresh()} aria-label="Reload">
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </div>
      {trackError ? <Notice tone="down" className="mx-4 mb-3">{trackError}</Notice> : null}
      {error ? (
        <Notice tone="down" title="Binance copy-trading data is unavailable" className="mx-4 mb-3">
          {error.message} These are unofficial binance.com endpoints and can be blocked or changed. Manual tracking still works.
        </Notice>
      ) : null}
      {loading ? (
        <div className="space-y-2 p-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
      ) : !rows.length ? (
        data ? <EmptyState title="No traders match these filters" description="Loosen the drawdown, win-rate or capital filters." /> : null
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[0.8125rem]">
            <thead className="border-y border-border bg-surface-2/50">
              <tr>
                <th className={th}>#</th>
                <th className={th}>Trader</th>
                <th className={cn(th, "text-right")}>ROI {range}</th>
                <th className={cn(th, "text-right")}>Profit</th>
                <th className={cn(th, "text-right")}>Implied start</th>
                <th className={cn(th, "text-right")}>Week</th>
                <th className={cn(th, "text-right")}>Day</th>
                <th className={cn(th, "text-right")}>Max DD</th>
                <th className={cn(th, "text-right")}>Win rate</th>
                <th className={cn(th, "text-right")}>
                  <Tooltip content="What copiers of this trader actually made. Negative while the trader is up usually means copiers joined late.">
                    <span className="cursor-help underline decoration-dotted underline-offset-2">Copier P&L</span>
                  </Tooltip>
                </th>
                <th className={th}>Curve</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const implied = r.pnl !== null && r.roiPercent ? r.pnl / (r.roiPercent / 100) : null;
                return (
                  <tr key={r.portfolioId} className="border-b border-border last:border-0 hover:bg-surface-2/50">
                    <td className={cn(td, "num text-faint")}>{i + 1}</td>
                    <td className={td}>
                      <div className="flex items-center gap-2">
                        <Avatar name={r.name} />
                        <div className="min-w-0">
                          <a href={r.profileUrl} target="_blank" rel="noopener noreferrer" className="flex max-w-48 items-center gap-1 truncate font-medium hover:text-accent">
                            {r.name} <ExternalLink className="size-3 shrink-0 text-faint" />
                          </a>
                          <p className="text-[0.65625rem] text-faint">{r.copiers ?? 0} copiers · AUM {formatUsd(r.aum, { compact: true })}</p>
                        </div>
                      </div>
                    </td>
                    <td className={cn(td, "text-right")}><ChangeText value={r.roiPercent} /></td>
                    <td className={cn(td, "num text-right")}>{formatUsd(r.pnl, { compact: true, sign: true })}</td>
                    <td className={cn(td, "num text-right text-muted")}>{implied !== null && implied > 0 ? formatUsd(implied, { compact: true }) : "—"}</td>
                    <td className={cn(td, "text-right")}><ChangeText value={r.weeklyReturnPercent} /></td>
                    <td className={cn(td, "text-right")}><ChangeText value={r.dailyReturnPercent} /></td>
                    <td className={cn(td, "num text-right text-down")}>{r.maxDrawdownPercent !== null ? `−${r.maxDrawdownPercent.toFixed(1)}%` : "—"}</td>
                    <td className={cn(td, "num text-right")}>{formatPercent(r.winRatePercent, { sign: false, digits: 0 })}</td>
                    <td className={cn(td, "num text-right", (r.copierPnl ?? 0) >= 0 ? "text-up" : "text-down")}>{formatUsd(r.copierPnl, { compact: true, sign: true })}</td>
                    <td className={td}><Sparkline values={r.roiSeries.map((p) => p.roi)} /></td>
                    <td className={cn(td, "text-right")}>
                      {r.trackedId ? (
                        <Link href={`/traders/${r.trackedId}`} className="text-xs text-accent hover:underline">Open</Link>
                      ) : (
                        <Button size="sm" variant="secondary" loading={busy === r.portfolioId} disabled={busy !== null} onClick={() => void track(r.portfolioId)}>
                          <Plus className="size-3.5" /> Track
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data ? (
        <p className="px-4 py-3 text-[0.6875rem] text-faint">
          Source: Binance Futures copy trading (lead traders), updated {formatRelative(data.fetchedAt)}. These are leveraged futures accounts; past
          ROI is the most survivorship-biased number in trading. Prefer long track records, low drawdown, real capital and positive copier P&L.
          {" "}{formatCompact(data.rows.length)} traders loaded.
        </p>
      ) : null}
    </div>
  );
}

export function TradersWorkspace() {
  const [tab, setTab] = useState("tracked");
  return (
    <div className="space-y-4">
      <Notice tone="warn" title="What this page is">
        <span className="flex items-start gap-1.5">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          Binance trader data comes from unofficial binance.com copy-trading endpoints (best effort, may break). Track traders to study what they buy and
          sell and how their style changes, not to copy blindly: most top ROI streaks do not persist.
        </span>
      </Notice>
      <Panel>
        <PanelHeader title="Traders" description="Discover top Binance copy traders or follow anyone manually." />
        <Tabs value={tab} onValueChange={setTab}>
          <div className="px-4 pt-3 pb-2">
            <TabsList>
              <TabsTrigger value="tracked">Tracked</TabsTrigger>
              <TabsTrigger value="discover">Discover on Binance</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="tracked"><TrackedTab /></TabsContent>
          <TabsContent value="discover"><DiscoverTab /></TabsContent>
        </Tabs>
      </Panel>
    </div>
  );
}
