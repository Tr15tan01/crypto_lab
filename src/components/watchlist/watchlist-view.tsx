"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { ChevronDown, Pencil, Star } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { Badge, Button, EmptyState, Notice, Panel, PanelHeader, Select, Skeleton } from "@/components/ui/primitives";
import { ChangeText, Freshness } from "@/components/market/indicators";
import { RemoveFromWatchlistButton, WatchlistDialog } from "./watch-dialogs";
import { cn, formatDate, formatPrice } from "@/lib/utils/format";
import { MarketContextView, type MarketContextData } from "@/components/market/market-context";
import type { WatchlistRow } from "@/services/watchlist/watchlist-service";

interface Payload {
  rows: WatchlistRow[];
  fetchedAt: string | null;
  stale: boolean;
}

type Sort = "ranking" | "added" | "since" | "change";

export function WatchlistView({ initial }: { initial: Payload }) {
  const { data, error, refresh } = useApi<Payload>("/api/watchlist?history=1", { refreshInterval: 30_000, initialData: initial });
  const [sort, setSort] = useState<Sort>("ranking");
  const [expanded, setExpanded] = useState<string | null>(null);
  const payload = data ?? initial;

  const active = useMemo(() => {
    const rows = payload.rows.filter((r) => r.active);
    const s = [...rows];
    if (sort === "ranking") s.sort((a, b) => (a.personalRanking ?? 99) - (b.personalRanking ?? 99));
    if (sort === "added") s.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    if (sort === "since") s.sort((a, b) => (b.changeSinceAdded ?? -Infinity) - (a.changeSinceAdded ?? -Infinity));
    if (sort === "change") s.sort((a, b) => (b.change24h ?? -Infinity) - (a.change24h ?? -Infinity));
    return s;
  }, [payload.rows, sort]);
  const removed = payload.rows.filter((r) => !r.active);

  return (
    <div className="space-y-4">
      {error ? <Notice tone="warn">{error.message} Showing the last loaded data.</Notice> : null}
      <Panel>
        <PanelHeader
          title={`Watching ${active.length} pair${active.length === 1 ? "" : "s"}`}
          actions={
            <>
              <Freshness fetchedAt={payload.fetchedAt} stale={payload.stale} />
              <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort watchlist" className="w-40">
                <option value="ranking">My ranking</option>
                <option value="added">Recently added</option>
                <option value="since">Since added</option>
                <option value="change">24h change</option>
              </Select>
            </>
          }
        />
        {!data && !initial ? (
          <div className="p-4"><Skeleton className="h-40 w-full" /></div>
        ) : active.length === 0 ? (
          <EmptyState
            icon={<Star className="size-5" />}
            title="Your watchlist is empty"
            description="Star pairs in the Market Scanner, or use Watch on a coin's page."
            action={<Link href="/market"><Button size="sm">Open Market Scanner</Button></Link>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-[0.8125rem]">
              <thead>
                <tr className="border-b border-border text-left text-[0.6875rem] text-muted">
                  <th className="px-4 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Pair</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                  <th className="px-3 py-2 text-right font-medium">24h</th>
                  <th className="px-3 py-2 text-right font-medium">Since added</th>
                  <th className="px-3 py-2 text-right font-medium">Target</th>
                  <th className="px-3 py-2 font-medium">Why I&apos;m watching</th>
                  <th className="px-3 py-2 font-medium">Market when added</th>
                  <th className="px-3 py-2 font-medium">Added</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {active.map((r) => {
                  const ctx = r.contextAtAdd as unknown as MarketContextData | null;
                  return (
                  <Fragment key={r.id}>
                  <tr className={cn("align-top", expanded === r.id ? "" : "border-b border-border/70")}>
                    <td className="num px-4 py-2.5 text-muted">{r.personalRanking ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      <Link href={`/crypto/${r.symbol}`} className="font-medium hover:text-accent">
                        {r.name ?? r.baseAsset}
                      </Link>
                      <span className="block text-[0.6875rem] text-muted">
                        {r.baseAsset}<span className="text-faint">/{r.quoteAsset}</span>
                      </span>
                      {r.tradable === false ? <Badge tone="down" className="mt-1">No longer tradable on Binance</Badge> : null}
                    </td>
                    <td className="num px-3 py-2.5 text-right">{formatPrice(r.price)}</td>
                    <td className="px-3 py-2.5 text-right"><ChangeText value={r.change24h} /></td>
                    <td className="px-3 py-2.5 text-right">
                      <ChangeText value={r.changeSinceAdded} />
                      <span className="block text-[0.6875rem] text-faint">from {formatPrice(r.priceAtAdd)}</span>
                    </td>
                    <td className="num px-3 py-2.5 text-right">
                      {r.targetPrice ? formatPrice(r.targetPrice) : "—"}
                      {r.distanceToTarget !== null ? (
                        <span className="block text-[0.6875rem] text-muted">{r.distanceToTarget >= 0 ? "+" : ""}{r.distanceToTarget.toFixed(1)}% away</span>
                      ) : null}
                    </td>
                    <td className="max-w-[280px] px-3 py-2.5 text-xs text-muted">
                      <p className="line-clamp-2">{r.reason ?? "—"}</p>
                      {r.notes ? <p className="mt-1 line-clamp-2 text-faint">{r.notes}</p> : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs">
                      {ctx ? (
                        <button
                          type="button"
                          onClick={() => setExpanded((e) => (e === r.id ? null : r.id))}
                          className="flex items-center gap-2 text-left text-muted hover:text-fg"
                          aria-expanded={expanded === r.id}
                        >
                          <span className="num flex flex-col gap-0.5 text-[0.6875rem]">
                            <span>
                              F&amp;G{" "}
                              <span className={ctx.fearGreed ? (ctx.fearGreed.value <= 25 ? "text-down" : ctx.fearGreed.value >= 75 ? "text-up" : "text-fg") : ""}>
                                {ctx.fearGreed ? `${ctx.fearGreed.value} ${ctx.fearGreed.label}` : "—"}
                              </span>
                            </span>
                            <span>
                              RSI {ctx.coin?.rsi14 ?? "—"} · score {ctx.scorecard ? `${ctx.scorecard.composite > 0 ? "+" : ""}${ctx.scorecard.composite}` : "—"}
                            </span>
                          </span>
                          <ChevronDown className={cn("size-3.5 transition-transform", expanded === r.id && "rotate-180")} />
                        </button>
                      ) : (
                        <span className="text-faint">not recorded</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted">{formatDate(r.addedAt)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      <WatchlistDialog
                        symbol={r.symbol}
                        entry={{ id: r.id, symbol: r.symbol, reason: r.reason, notes: r.notes, targetPrice: r.targetPrice, personalRanking: r.personalRanking }}
                        onSaved={() => void refresh()}
                        trigger={<Button size="sm" variant="ghost"><Pencil className="size-3.5" /> Edit</Button>}
                      />
                      <RemoveFromWatchlistButton id={r.id} symbol={r.symbol} onRemoved={() => void refresh()} />
                    </td>
                  </tr>
                  {expanded === r.id && ctx ? (
                    <tr className="border-b border-border/70">
                      <td colSpan={10} className="px-4 pb-3">
                        <MarketContextView ctx={ctx} title={`When added · ${formatDate(r.addedAt)}`} defaultOpen />
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {removed.length ? (
        <Panel>
          <PanelHeader title="Watchlist history" description="Pairs you stopped watching are kept with their notes." />
          <ul>
            {removed.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-2 text-xs last:border-0">
                <span>
                  <Link href={`/crypto/${r.symbol}`} className="font-medium hover:text-accent">{r.symbol}</Link>
                  <span className="ml-2 text-muted">
                    watched {formatDate(r.addedAt)} → {formatDate(r.removedAt)} · from {formatPrice(r.priceAtAdd)}
                  </span>
                  {r.tradable === false ? <Badge tone="down" className="ml-2">Not tradable</Badge> : null}
                </span>
                <span className="flex items-center gap-1.5 text-muted">
                  since added <ChangeText value={r.changeSinceAdded} />
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
