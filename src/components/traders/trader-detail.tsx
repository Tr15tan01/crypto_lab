"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { ChevronLeft, ExternalLink, FileUp, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { Badge, Button, EmptyState, Field, Input, Notice, Panel, PanelBody, PanelHeader, Select, Skeleton, Textarea } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogTrigger, Tooltip } from "@/components/ui/radix";
import { ChangeText } from "@/components/market/indicators";
import { CHART, SERIES, formatAxisTime } from "@/components/charts/chart-theme";
import { cn, formatDate, formatDateTime, formatPercent, formatPrice, formatQuantity, formatRelative, formatUsd } from "@/lib/utils/format";
import { StrategyBadge, formatHours, spotSymbol } from "./shared";

interface Trade {
  _id: string;
  symbol: string;
  side: "long" | "short";
  leverage: number | null;
  quantity: number | null;
  entryPrice: number;
  exitPrice: number | null;
  openedAt: string;
  closedAt: string | null;
  pnl: number | null;
  status: "open" | "partial" | "closed";
  source: string;
}

interface Detail {
  trader: {
    _id: string;
    source: "binance_copy" | "manual";
    externalId: string | null;
    name: string;
    profileUrl: string | null;
    startingValue: number | null;
    startingValueSource: "user" | "implied" | null;
    quoteAsset: string;
    notes?: string;
    createdAt: string;
    lastSyncedAt: string | null;
    lastSyncError: string | null;
    remote: {
      status: string | null;
      description: string | null;
      tags: string[];
      startedAt: string | null;
      marginBalance: number | null;
      copiers: number | null;
      performance: Array<{ range: string; roiPercent: number | null; pnl: number | null; maxDrawdownPercent: number | null; winRatePercent: number | null; totalOrders: number | null }>;
      coinMix: Array<{ asset: string; sharePercent: number }>;
    } | null;
  };
  trades: Trade[];
  metrics: {
    equity: Array<{ t: number; v: number }>;
    returns: {
      dailyReturnPercent: number | null;
      weeklyReturnPercent: number | null;
      monthlyRoiPercent: number | null;
      maxDrawdownPercent: number | null;
      totalReturnPercent: number | null;
      upDaysPercent: number | null;
      winRatePercent: number | null;
    };
    stats: {
      trades: number;
      closed: number;
      open: number;
      avgHoldingHours: number | null;
      medianHoldingHours: number | null;
      avgLeverage: number | null;
      longSharePercent: number | null;
      coins: Array<{ symbol: string; trades: number; longs: number; shorts: number; open: number; pnl: number | null; winRatePercent: number | null; avgHoldingHours: number | null }>;
    };
    strategy: {
      status: "changing" | "stable" | "insufficient_data";
      score: number;
      changes: string[];
      window: { recentDays: number; recentTrades: number; baselineTrades: number };
    };
  };
  syncError: string | null;
  /** Server time the metrics were computed at; open positions are measured to it. */
  asOf: number;
}

const th = "px-3 py-2 text-left text-[11px] font-medium text-muted whitespace-nowrap";
const td = "px-3 py-2 whitespace-nowrap";

function Stat({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
      <p className="label-caps">{label}</p>
      <div className="num mt-1 text-base">{children}</div>
      {hint ? <p className="mt-0.5 text-[10.5px] text-faint">{hint}</p> : null}
    </div>
  );
}

function EquityChart({ points, asRoi, start }: { points: Array<{ t: number; v: number }>; asRoi: boolean; start: number | null }) {
  if (points.length < 2) {
    return <EmptyState className="py-10" title="No equity curve yet" description={asRoi ? "Binance has not returned a daily ROI series for this trader." : "Add closed trades with quantity or P&L to build the curve."} />;
  }
  const data = points.map((p) => ({ t: p.t, y: asRoi ? (p.v - 1) * 100 : p.v }));
  const span = data[data.length - 1]!.t - data[0]!.t;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={CHART.grid} vertical={false} />
        <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(v: number) => formatAxisTime(v, span)} minTickGap={50} tick={CHART.tick} tickLine={false} axisLine={{ stroke: CHART.baseline }} />
        <YAxis orientation="right" domain={["auto", "auto"]} tick={CHART.tick} tickLine={false} axisLine={false} width={70} tickFormatter={(v: number) => (asRoi ? `${v.toFixed(0)}%` : formatUsd(v, { compact: true }))} />
        <ReferenceLine y={asRoi ? 0 : (start ?? 0)} stroke={CHART.axisText} strokeDasharray="4 4" />
        <ChartTooltip
          isAnimationActive={false}
          cursor={{ stroke: CHART.axis, strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0]!.payload as { t: number; y: number };
            return (
              <div className="rounded-md border border-border-strong bg-surface-2/95 px-3 py-2 text-xs shadow-xl shadow-shadow/50">
                <p className="text-muted">{formatDate(p.t)}</p>
                <p className="num mt-1 text-sm">{asRoi ? formatPercent(p.y) : formatUsd(p.y)}</p>
              </div>
            );
          }}
        />
        <Line dataKey="y" stroke={SERIES[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function toMs(v: string): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function AddTradeDialog({ traderId, onSaved }: { traderId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ symbol: "", side: "long", entry: "", exit: "", qty: "", lev: "", opened: "", closed: "", pnl: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const n = (v: string) => (v.trim() ? Number(v) : null);

  const save = async () => {
    const trade = {
      symbol: f.symbol.trim().toUpperCase(),
      side: f.side,
      entryPrice: Number(f.entry),
      exitPrice: n(f.exit),
      quantity: n(f.qty),
      leverage: n(f.lev),
      openedAt: toMs(f.opened),
      closedAt: toMs(f.closed),
      pnl: n(f.pnl),
    };
    if (!trade.symbol || !(trade.entryPrice > 0) || !trade.openedAt || Number.isNaN(trade.openedAt) || Number.isNaN(trade.closedAt as number)) {
      return setError("Symbol, entry price and open time are required; numbers and dates must be valid.");
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/traders/${traderId}/trades`, { method: "POST", json: { trade } });
      setOpen(false);
      setF({ symbol: "", side: "long", entry: "", exit: "", qty: "", lev: "", opened: "", closed: "", pnl: "" });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save the trade.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary"><Plus className="size-3.5" /> Add trade</Button>
      </DialogTrigger>
      <DialogContent title="Add a trade" description="Leave exit and close time empty for a position that is still open." wide>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Pair" htmlFor="tr-sym"><Input id="tr-sym" value={f.symbol} onChange={set("symbol")} placeholder="SOLUSDT" /></Field>
          <Field label="Side" htmlFor="tr-side">
            <Select id="tr-side" value={f.side} onChange={set("side")}>
              <option value="long">Buy / long</option>
              <option value="short">Sell / short</option>
            </Select>
          </Field>
          <Field label="Leverage" htmlFor="tr-lev" hint="Empty for spot."><Input id="tr-lev" inputMode="decimal" value={f.lev} onChange={set("lev")} /></Field>
          <Field label="Entry price" htmlFor="tr-entry"><Input id="tr-entry" inputMode="decimal" value={f.entry} onChange={set("entry")} /></Field>
          <Field label="Exit price" htmlFor="tr-exit"><Input id="tr-exit" inputMode="decimal" value={f.exit} onChange={set("exit")} /></Field>
          <Field label="Quantity" htmlFor="tr-qty" hint="Base units; needed for P&L."><Input id="tr-qty" inputMode="decimal" value={f.qty} onChange={set("qty")} /></Field>
          <Field label="Opened" htmlFor="tr-open"><Input id="tr-open" type="datetime-local" value={f.opened} onChange={set("opened")} /></Field>
          <Field label="Closed" htmlFor="tr-close"><Input id="tr-close" type="datetime-local" value={f.closed} onChange={set("closed")} /></Field>
          <Field label="P&L (optional)" htmlFor="tr-pnl" hint="Overrides the computed value."><Input id="tr-pnl" inputMode="decimal" value={f.pnl} onChange={set("pnl")} /></Field>
        </div>
        {error ? <Notice tone="down" className="mt-3">{error}</Notice> : null}
        <div className="mt-4 flex justify-end">
          <Button variant="primary" loading={saving} onClick={() => void save()}>Save trade</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ImportCsvDialog({ traderId, onSaved }: { traderId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<{ added: number; errors: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await apiFetch<{ added: number; errors: string[] }>(`/api/traders/${traderId}/trades`, { method: "POST", json: { csv } });
      setResult(r);
      onSaved();
    } catch (err) {
      const lines = err instanceof ApiClientError ? ((err.details as { lines?: string[] } | undefined)?.lines ?? []) : [];
      setError(`${err instanceof ApiClientError ? err.message : "Import failed."}${lines.length > 1 ? ` ${lines.slice(1, 4).join(" ")}` : ""}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setResult(null); setError(null); } }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary"><FileUp className="size-3.5" /> Import CSV</Button>
      </DialogTrigger>
      <DialogContent title="Import trades from CSV" description="Paste rows with a header. Required: symbol, side, entry, opened. Optional: exit, quantity, leverage, closed, pnl." wide>
        <Textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={9}
          className="font-mono text-xs"
          placeholder={"symbol,side,entry,exit,quantity,leverage,opened,closed\nSOLUSDT,buy,142.5,158.2,10,,2026-09-01 10:00,2026-09-09 16:30\nETHUSDT,short,2650,2580,2,5,2026-09-12,2026-09-13"}
        />
        {error ? <Notice tone="down" className="mt-3">{error}</Notice> : null}
        {result ? (
          <Notice tone={result.errors.length ? "warn" : "up"} className="mt-3">
            Added {result.added} trade{result.added === 1 ? "" : "s"}.{result.errors.length ? ` Skipped: ${result.errors.slice(0, 5).join(" ")}` : ""}
          </Notice>
        ) : null}
        <div className="mt-4 flex justify-end">
          <Button variant="primary" loading={saving} disabled={!csv.trim()} onClick={() => void save()}>Import</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StartValueDialog({ traderId, current, onSaved }: { traderId: string; current: number | null; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current ? String(Math.round(current)) : "");
  const [error, setError] = useState<string | null>(null);
  const save = async (v: number | null) => {
    try {
      await apiFetch(`/api/traders/${traderId}`, { method: "PATCH", json: { startingValue: v } });
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save.");
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="ml-1 text-faint hover:text-fg" aria-label="Edit starting value"><Pencil className="inline size-3" /></button>
      </DialogTrigger>
      <DialogContent title="Starting portfolio value" description="Override the implied value if you know the real starting capital.">
        <Field label="Starting value (USDT)" htmlFor="sv"><Input id="sv" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        {error ? <Notice tone="down" className="mt-3">{error}</Notice> : null}
        <div className="mt-4 flex justify-between">
          <Button variant="ghost" onClick={() => void save(null)}>Reset</Button>
          <Button variant="primary" onClick={() => { const n = Number(value); if (n > 0) void save(n); else setError("Enter a positive number."); }}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TraderDetail({ id }: { id: string }) {
  const router = useRouter();
  const { data, error, loading, refresh } = useApi<Detail>(`/api/traders/${id}`);
  const [syncing, setSyncing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const sync = async () => {
    setSyncing(true);
    setActionError(null);
    try {
      await apiFetch(`/api/traders/${id}/sync`, { method: "POST" });
      await refresh();
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Stop tracking this trader and delete their stored trades?")) return;
    try {
      await apiFetch(`/api/traders/${id}`, { method: "DELETE" });
      router.push("/traders");
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : "Could not delete.");
    }
  };

  const removeTrade = async (tradeId: string) => {
    try {
      await apiFetch(`/api/traders/${id}/trades/${tradeId}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : "Could not delete the trade.");
    }
  };

  if (loading) return <div className="space-y-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  if (error || !data) return <Notice tone="down" title="Could not load this trader">{error?.message}</Notice>;

  const { trader, trades, metrics: m } = data;
  const binance = trader.source === "binance_copy";
  const r = m.returns;
  const shown = showAll ? trades : trades.slice(0, 50);
  const perf = (range: string) => trader.remote?.performance.find((p) => p.range === range);

  return (
    <div className="space-y-4">
      <Link href="/traders" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
        <ChevronLeft className="size-3.5" /> Top Traders
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
            {trader.name}
            <Badge tone={binance ? "info" : "neutral"}>{binance ? "Binance copy trader" : "Manual"}</Badge>
            {trader.remote?.status && trader.remote.status !== "ACTIVE" ? <Badge tone="warn">{trader.remote.status}</Badge> : null}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            {trader.profileUrl ? (
              <a href={trader.profileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-info hover:underline">
                Profile <ExternalLink className="size-3" />
              </a>
            ) : null}
            {trader.remote?.startedAt ? <span>Trading since {formatDate(trader.remote.startedAt)}</span> : null}
            {trader.remote?.copiers !== null && trader.remote?.copiers !== undefined ? <span>{trader.remote.copiers} copiers</span> : null}
            {binance ? <span>{trader.lastSyncedAt ? `Synced ${formatRelative(trader.lastSyncedAt)}` : "Not synced yet"}</span> : null}
          </p>
          {trader.remote?.tags.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1">{trader.remote.tags.map((t) => <Badge key={t} tone="neutral">{t}</Badge>)}</div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {binance ? (
            <Button size="sm" variant="secondary" loading={syncing} onClick={() => void sync()}><RefreshCw className="size-3.5" /> Sync now</Button>
          ) : (
            <>
              <AddTradeDialog traderId={id} onSaved={() => void refresh()} />
              <ImportCsvDialog traderId={id} onSaved={() => void refresh()} />
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => void remove()} aria-label="Stop tracking"><Trash2 className="size-3.5" /></Button>
        </div>
      </div>

      {data.syncError || trader.lastSyncError || actionError ? (
        <Notice tone="warn">{actionError ?? data.syncError ?? trader.lastSyncError} Showing the last stored data.</Notice>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        <Stat label="Starting value" hint={trader.startingValueSource === "implied" ? "implied: 90d P&L ÷ ROI" : trader.startingValueSource === "user" ? "entered by you" : undefined}>
          {formatUsd(trader.startingValue, { compact: true })}
          <StartValueDialog traderId={id} current={trader.startingValue} onSaved={() => void refresh()} />
        </Stat>
        <Stat label="Daily return"><ChangeText value={r.dailyReturnPercent} /></Stat>
        <Stat label="Weekly return"><ChangeText value={r.weeklyReturnPercent} /></Stat>
        <Stat label="Monthly ROI" hint={binance ? "Binance 30D" : "last 30 days"}><ChangeText value={r.monthlyRoiPercent} /></Stat>
        <Stat label="Max drawdown" hint={binance ? "Binance 90D" : "peak to trough"}>
          <span className="text-down">{r.maxDrawdownPercent !== null ? `−${r.maxDrawdownPercent.toFixed(1)}%` : "—"}</span>
        </Stat>
        <Stat label="Win rate">{formatPercent(r.winRatePercent, { sign: false, digits: 0 })}</Stat>
        <Stat label="Avg holding" hint={`median ${formatHours(m.stats.medianHoldingHours)}`}>{formatHours(m.stats.avgHoldingHours)}</Stat>
        <Stat label="Positions" hint={m.stats.avgLeverage ? `avg ${m.stats.avgLeverage.toFixed(1)}× · ${m.stats.longSharePercent?.toFixed(0)}% long` : undefined}>
          {m.stats.trades}<span className="text-xs text-faint"> · {m.stats.open} open</span>
        </Stat>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Panel>
          <PanelHeader title={binance ? "Cumulative ROI (90 days)" : "Equity from closed trades"} description={binance ? "Daily ROI reported by Binance." : "Starting value plus realised P&L by close day; open trades are not marked to market."} />
          <PanelBody className="px-2"><EquityChart points={m.equity} asRoi={binance} start={trader.startingValue} /></PanelBody>
        </Panel>
        <Panel>
          <PanelHeader
            title={<span className="flex items-center gap-2">Is the strategy changing? <StrategyBadge status={m.strategy.status} score={m.strategy.score} /></span>}
            description={`Last ${m.strategy.window.recentDays} days (${m.strategy.window.recentTrades} trades) vs the 14–90 days before (${m.strategy.window.baselineTrades} trades).`}
          />
          <PanelBody>
            {m.strategy.status === "insufficient_data" ? (
              <p className="text-xs text-muted">Not enough trades in one of the two windows to compare.</p>
            ) : m.strategy.changes.length ? (
              <ul className="space-y-1.5 text-xs">{m.strategy.changes.map((c) => <li key={c} className="flex gap-1.5"><span className="text-warn">•</span>{c}</li>)}</ul>
            ) : (
              <p className="text-xs text-muted">Holding time, leverage, direction mix, trading frequency and coin selection are all in line with before.</p>
            )}
            <p className="mt-3 text-[10.5px] text-faint">Change score {m.strategy.score}/100. A changing style after a big win (or loss) often precedes worse results.</p>
            {binance && trader.remote ? (
              <table className="mt-4 w-full text-xs">
                <thead><tr className="text-muted"><th className="py-1 text-left font-medium">Range</th><th className="py-1 text-right font-medium">ROI</th><th className="py-1 text-right font-medium">P&L</th><th className="py-1 text-right font-medium">Max DD</th><th className="py-1 text-right font-medium">Win</th></tr></thead>
                <tbody>
                  {["7D", "30D", "90D"].map((rg) => {
                    const p = perf(rg);
                    return (
                      <tr key={rg} className="border-t border-border">
                        <td className="py-1">{rg}</td>
                        <td className="py-1 text-right"><ChangeText value={p?.roiPercent} showIcon={false} /></td>
                        <td className="num py-1 text-right">{formatUsd(p?.pnl, { compact: true, sign: true })}</td>
                        <td className="num py-1 text-right text-down">{p?.maxDrawdownPercent != null ? `−${p.maxDrawdownPercent.toFixed(1)}%` : "—"}</td>
                        <td className="num py-1 text-right">{formatPercent(p?.winRatePercent, { sign: false, digits: 0 })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : null}
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="Coins bought and sold"
          description={binance && trader.remote?.coinMix.length ? `30-day volume share: ${trader.remote.coinMix.slice(0, 6).map((c) => `${c.asset} ${c.sharePercent.toFixed(0)}%`).join(" · ")}` : "Per coin, from the stored positions."}
        />
        {m.stats.coins.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b border-border bg-surface-2/50">
                <tr>
                  <th className={th}>Coin</th>
                  <th className={cn(th, "text-right")}>Positions</th>
                  <th className={cn(th, "text-right")}>Bought / long</th>
                  <th className={cn(th, "text-right")}>Sold / short</th>
                  <th className={cn(th, "text-right")}>Open</th>
                  <th className={cn(th, "text-right")}>P&L</th>
                  <th className={cn(th, "text-right")}>Win rate</th>
                  <th className={cn(th, "text-right")}>Avg hold</th>
                </tr>
              </thead>
              <tbody>
                {m.stats.coins.slice(0, 30).map((c) => (
                  <tr key={c.symbol} className="border-b border-border last:border-0">
                    <td className={td}><Link href={`/crypto/${spotSymbol(c.symbol)}`} className="font-medium hover:text-accent">{c.symbol}</Link></td>
                    <td className={cn(td, "num text-right")}>{c.trades}</td>
                    <td className={cn(td, "num text-right text-up")}>{c.longs}</td>
                    <td className={cn(td, "num text-right text-down")}>{c.shorts}</td>
                    <td className={cn(td, "num text-right")}>{c.open || "—"}</td>
                    <td className={cn(td, "num text-right", (c.pnl ?? 0) >= 0 ? "text-up" : "text-down")}>{formatUsd(c.pnl, { sign: true })}</td>
                    <td className={cn(td, "num text-right")}>{formatPercent(c.winRatePercent, { sign: false, digits: 0 })}</td>
                    <td className={cn(td, "num text-right")}>{formatHours(c.avgHoldingHours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No positions yet" description={binance ? "Binance has not returned any position history for this trader (some hide it)." : "Add trades or import a CSV."} />
        )}
      </Panel>

      <Panel>
        <PanelHeader title="Positions" description="Entry and exit prices, holding time and result, newest first." />
        {trades.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b border-border bg-surface-2/50">
                <tr>
                  <th className={th}>Pair</th>
                  <th className={th}>Side</th>
                  <th className={th}>Opened</th>
                  <th className={th}>Closed</th>
                  <th className={cn(th, "text-right")}>Held</th>
                  <th className={cn(th, "text-right")}>Entry</th>
                  <th className={cn(th, "text-right")}>Exit</th>
                  <th className={cn(th, "text-right")}>
                    <Tooltip content="Price move in the position's direction, times leverage when known."><span className="cursor-help underline decoration-dotted underline-offset-2">Return</span></Tooltip>
                  </th>
                  <th className={cn(th, "text-right")}>Size</th>
                  <th className={cn(th, "text-right")}>P&L</th>
                  {!binance ? <th className={th} /> : null}
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => {
                  const dir = t.side === "long" ? 1 : -1;
                  const ret = t.exitPrice ? ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100 * dir * (t.leverage ?? 1) : null;
                  const held = ((t.closedAt ? new Date(t.closedAt).getTime() : data.asOf) - new Date(t.openedAt).getTime()) / 3_600_000;
                  return (
                    <tr key={t._id} className="border-b border-border last:border-0">
                      <td className={td}><Link href={`/crypto/${spotSymbol(t.symbol)}`} className="font-medium hover:text-accent">{t.symbol}</Link></td>
                      <td className={td}>
                        <Badge tone={t.side === "long" ? "up" : "down"}>{t.side === "long" ? "Long" : "Short"}{t.leverage ? ` ${t.leverage}×` : ""}</Badge>
                        {t.status !== "closed" ? <Badge tone="accent" className="ml-1">{t.status === "partial" ? "Partly closed" : "Open"}</Badge> : null}
                      </td>
                      <td className={cn(td, "text-xs text-muted")}>{formatDateTime(t.openedAt)}</td>
                      <td className={cn(td, "text-xs text-muted")}>{t.closedAt ? formatDateTime(t.closedAt) : "—"}</td>
                      <td className={cn(td, "num text-right")}>{formatHours(held)}</td>
                      <td className={cn(td, "num text-right")}>{formatPrice(t.entryPrice)}</td>
                      <td className={cn(td, "num text-right")}>{formatPrice(t.exitPrice)}</td>
                      <td className={cn(td, "text-right")}><ChangeText value={ret} showIcon={false} /></td>
                      <td className={cn(td, "num text-right text-muted")}>{formatQuantity(t.quantity)}</td>
                      <td className={cn(td, "num text-right", (t.pnl ?? 0) >= 0 ? "text-up" : "text-down")}>{formatUsd(t.pnl, { sign: true })}</td>
                      {!binance ? (
                        <td className={td}>
                          <button type="button" onClick={() => void removeTrade(t._id)} className="p-1 text-faint hover:text-down" aria-label={`Delete ${t.symbol} trade`}><Trash2 className="size-3.5" /></button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {trades.length > 50 ? (
              <div className="p-3 text-center">
                <Button size="sm" variant="ghost" onClick={() => setShowAll((s) => !s)}>{showAll ? "Show fewer" : `Show all ${trades.length}`}</Button>
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState title="No positions stored" />
        )}
      </Panel>
      {trader.notes ? <p className="text-xs text-muted">Notes: {trader.notes}</p> : null}
    </div>
  );
}
