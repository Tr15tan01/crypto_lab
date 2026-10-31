"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, RefreshCw, Search, Star, Wallet } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { Button, EmptyState, Input, Notice, Panel, Select, Skeleton } from "@/components/ui/primitives";
import { Segmented } from "@/components/ui/radix";
import { ChangeText, Freshness } from "./indicators";
import { cn, formatCompact, formatPrice } from "@/lib/utils/format";

interface Row {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  name: string | null;
  price: number;
  priceChangePercent: number;
  high: number;
  low: number;
  quoteVolume: number;
  watched: boolean;
  ranking: number | null;
  held: boolean;
}

interface Payload {
  rows: Row[];
  quoteAssets: string[];
  personalDataAvailable: boolean;
  fetchedAt: string;
  stale: boolean;
}

type SortKey = "gainers" | "losers" | "volume_desc" | "volume_asc" | "alpha" | "ranking";
type Direction = "all" | "up" | "down";

const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: "volume_desc", label: "Highest volume" },
  { value: "volume_asc", label: "Lowest volume" },
  { value: "gainers", label: "Biggest gainers" },
  { value: "losers", label: "Biggest losers" },
  { value: "alpha", label: "Alphabetical" },
  { value: "ranking", label: "My ranking" },
];

const VOLUME_FLOORS = [
  { value: "0", label: "Any volume" },
  { value: "100000", label: "≥ 100K" },
  { value: "1000000", label: "≥ 1M" },
  { value: "10000000", label: "≥ 10M" },
  { value: "100000000", label: "≥ 100M" },
];

const PAGE_SIZE = 50;

export function MarketScanner() {
  const [quote, setQuote] = useState("USDT");
  const { data, error, loading, refresh, setData } = useApi<Payload>(`/api/market/tickers?quote=${quote}`, {
    refreshInterval: 30_000,
  });

  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<Direction>("all");
  const [minVolume, setMinVolume] = useState("0");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [onlyWatched, setOnlyWatched] = useState(false);
  const [onlyHeld, setOnlyHeld] = useState(false);
  const [sort, setSort] = useState<SortKey>("volume_desc");
  const [page, setPage] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toUpperCase();
    const vol = Number(minVolume);
    const pMin = minPrice ? Number(minPrice) : null;
    const pMax = maxPrice ? Number(maxPrice) : null;
    const rows = data.rows.filter((r) => {
      if (q && !r.symbol.includes(q) && !(r.name ?? "").toUpperCase().includes(q)) return false;
      if (direction === "up" && r.priceChangePercent <= 0) return false;
      if (direction === "down" && r.priceChangePercent >= 0) return false;
      if (r.quoteVolume < vol) return false;
      if (pMin !== null && Number.isFinite(pMin) && r.price < pMin) return false;
      if (pMax !== null && Number.isFinite(pMax) && r.price > pMax) return false;
      if (onlyWatched && !r.watched) return false;
      if (onlyHeld && !r.held) return false;
      return true;
    });
    const sorted = [...rows];
    switch (sort) {
      case "gainers":
        sorted.sort((a, b) => b.priceChangePercent - a.priceChangePercent);
        break;
      case "losers":
        sorted.sort((a, b) => a.priceChangePercent - b.priceChangePercent);
        break;
      case "volume_asc":
        sorted.sort((a, b) => a.quoteVolume - b.quoteVolume);
        break;
      case "alpha":
        sorted.sort((a, b) => a.symbol.localeCompare(b.symbol));
        break;
      case "ranking":
        sorted.sort((a, b) => (a.ranking ?? 99) - (b.ranking ?? 99) || b.quoteVolume - a.quoteVolume);
        break;
      default:
        sorted.sort((a, b) => b.quoteVolume - a.quoteVolume);
    }
    return sorted;
  }, [data, query, direction, minVolume, minPrice, maxPrice, onlyWatched, onlyHeld, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  const toggleWatch = async (row: Row) => {
    if (row.watched) return; // removal happens on the watchlist page, where notes live
    setPending(row.symbol);
    setActionError(null);
    try {
      await apiFetch("/api/watchlist", { method: "POST", json: { symbol: row.symbol } });
      if (data) setData({ ...data, rows: data.rows.map((r) => (r.symbol === row.symbol ? { ...r, watched: true } : r)) });
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : "Could not add to watchlist.");
    } finally {
      setPending(null);
    }
  };

  const headerSort = (asc: SortKey, desc: SortKey) => () => setSort(sort === desc ? asc : desc);
  const sortIcon = (asc: SortKey, desc: SortKey) =>
    sort === desc ? <ArrowDown className="size-3" /> : sort === asc ? <ArrowUp className="size-3" /> : null;

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder="Search symbol or name"
              aria-label="Search symbol or name"
              className="pl-8"
            />
          </div>
          <Select
            value={quote}
            onChange={(e) => {
              setQuote(e.target.value);
              setPage(0);
            }}
            aria-label="Quote asset"
            className="w-32"
          >
            {(data?.quoteAssets.length ? data.quoteAssets : ["USDT"]).map((q) => (
              <option key={q} value={q}>
                {q} pairs
              </option>
            ))}
          </Select>
          <Segmented<Direction>
            label="24h direction"
            value={direction}
            onChange={(v) => {
              setDirection(v);
              setPage(0);
            }}
            options={[
              { value: "all", label: "All" },
              { value: "up", label: "▲ Up" },
              { value: "down", label: "▼ Down" },
            ]}
          />
          <Select value={minVolume} onChange={(e) => setMinVolume(e.target.value)} aria-label="Minimum 24h volume" className="w-32">
            {VOLUME_FLOORS.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </Select>
          <div className="flex items-center gap-1">
            <Input
              inputMode="decimal"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              placeholder="Min price"
              aria-label="Minimum price"
              className="w-24"
            />
            <span className="text-faint">–</span>
            <Input
              inputMode="decimal"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              placeholder="Max price"
              aria-label="Maximum price"
              className="w-24"
            />
          </div>
          <Button size="sm" variant={onlyWatched ? "primary" : "secondary"} aria-pressed={onlyWatched} onClick={() => setOnlyWatched((v) => !v)}>
            <Star className="size-3.5" /> Watchlist
          </Button>
          <Button size="sm" variant={onlyHeld ? "primary" : "secondary"} aria-pressed={onlyHeld} onClick={() => setOnlyHeld((v) => !v)}>
            <Wallet className="size-3.5" /> Held
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort" className="w-40">
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
            <Button size="icon" variant="ghost" onClick={() => void refresh()} aria-label="Refresh market data">
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-2 text-[11px] text-muted">
          <span>
            {data ? `${filtered.length.toLocaleString()} of ${data.rows.length.toLocaleString()} tradable pairs` : "Loading pairs…"}
          </span>
          {data ? <Freshness fetchedAt={data.fetchedAt} stale={data.stale} /> : null}
        </div>

        {actionError ? <Notice tone="down" className="mx-4 mb-3">{actionError}</Notice> : null}
        {data && !data.personalDataAvailable ? (
          <Notice tone="warn" className="mx-4 mb-3">
            The database is unreachable, so watchlist and position markers are not shown. Market data is unaffected.
          </Notice>
        ) : null}
        {data?.stale ? (
          <Notice tone="warn" className="mx-4 mb-3" title="Showing the last successfully retrieved prices">
            Binance could not be reached just now. Values below are not live.
          </Notice>
        ) : null}

        {error && !data ? (
          <EmptyState
            title="Market data is unavailable"
            description={error.message}
            action={
              <Button size="sm" onClick={() => void refresh()}>
                <RefreshCw className="size-3.5" /> Retry
              </Button>
            }
          />
        ) : !data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 10 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState title="No pairs match these filters" description="Clear a filter or broaden the price/volume range." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead>
                <tr className="border-y border-border text-left text-[11px] text-muted">
                  <th className="w-10 px-3 py-2 font-medium" aria-label="Watchlist" />
                  <th className="px-3 py-2 font-medium">
                    <button type="button" className="inline-flex items-center gap-1 hover:text-fg" onClick={() => setSort("alpha")}>
                      Pair {sort === "alpha" ? <ArrowUp className="size-3" /> : null}
                    </button>
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                  <th className="px-3 py-2 text-right font-medium">
                    <button type="button" className="inline-flex items-center gap-1 hover:text-fg" onClick={headerSort("losers", "gainers")}>
                      24h change {sortIcon("losers", "gainers")}
                    </button>
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    <button type="button" className="inline-flex items-center gap-1 hover:text-fg" onClick={headerSort("volume_asc", "volume_desc")}>
                      24h volume ({quote}) {sortIcon("volume_asc", "volume_desc")}
                    </button>
                  </th>
                  <th className="px-3 py-2 text-right font-medium">24h high</th>
                  <th className="px-3 py-2 text-right font-medium">24h low</th>
                  <th className="px-3 py-2 font-medium">Position</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.symbol} className="group border-b border-border/70 transition-colors hover:bg-surface-2">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => void toggleWatch(r)}
                        disabled={pending === r.symbol}
                        aria-label={r.watched ? `${r.symbol} is on your watchlist` : `Add ${r.symbol} to watchlist`}
                        title={r.watched ? "On your watchlist" : "Add to watchlist"}
                        className="rounded-sm p-0.5 text-faint transition-colors hover:text-accent disabled:opacity-40"
                      >
                        <Star className={cn("size-3.5", r.watched && "fill-accent text-accent")} />
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/crypto/${r.symbol}`} className="flex items-baseline gap-2">
                        <span className="font-medium text-fg group-hover:text-accent">
                          {r.baseAsset}
                          <span className="text-faint">/{r.quoteAsset}</span>
                        </span>
                        {r.name ? <span className="truncate text-xs text-muted">{r.name}</span> : null}
                      </Link>
                    </td>
                    <td className="num px-3 py-2 text-right">{formatPrice(r.price)}</td>
                    <td className="px-3 py-2 text-right">
                      <ChangeText value={r.priceChangePercent} />
                    </td>
                    <td className="num px-3 py-2 text-right text-muted">{formatCompact(r.quoteVolume)}</td>
                    <td className="num px-3 py-2 text-right text-muted">{formatPrice(r.high)}</td>
                    <td className="num px-3 py-2 text-right text-muted">{formatPrice(r.low)}</td>
                    <td className="px-3 py-2">
                      {r.held ? (
                        <span className="inline-flex items-center gap-1 text-xs text-accent">
                          <Wallet className="size-3" /> Held
                        </span>
                      ) : (
                        <span className="text-xs text-faint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && filtered.length > PAGE_SIZE ? (
          <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2 text-xs text-muted">
            <span>
              Page {currentPage + 1} of {pageCount}
            </span>
            <Button size="icon" variant="ghost" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} aria-label="Previous page">
              <ChevronLeft className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)} aria-label="Next page">
              <ChevronRight className="size-4" />
            </Button>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
