"use client";

import Link from "next/link";
import { useApi } from "@/hooks/use-api";
import { EmptyState, Notice } from "@/components/ui/primitives";
import { ChangeText, Freshness } from "./indicators";
import { formatCompact, formatPercent, formatPrice } from "@/lib/utils/format";
import type { MarketOverview } from "@/services/market/overview";

interface Payload {
  overview: MarketOverview;
  fetchedAt: string;
  stale: boolean;
}

function List({ title, rows, metric }: { title: string; rows: MarketOverview["majors"]; metric: "change" | "volume" }) {
  return (
    <div>
      <p className="label-caps mb-1.5">{title}</p>
      <ul className="space-y-0.5">
        {rows.map((t) => (
          <li key={t.symbol}>
            <Link href={`/crypto/${t.symbol}`} className="flex items-center justify-between gap-2 rounded-sm px-1.5 py-1 text-xs hover:bg-surface-2">
              <span className="font-medium">{t.baseAsset}</span>
              <span className="num text-muted">{formatPrice(t.price)}</span>
              {metric === "change" ? <ChangeText value={t.priceChangePercent} className="w-20 justify-end" /> : <span className="num w-20 text-right text-muted">{formatCompact(t.quoteVolume)}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MarketOverviewPanel({ initial, initialError }: { initial: Payload | null; initialError: string | null }) {
  const { data, error } = useApi<Payload>("/api/market/overview", { refreshInterval: 60_000, initialData: initial ?? undefined });
  if (!data) {
    return <EmptyState title="Market data is unavailable" description={error?.message ?? initialError ?? "Binance could not be reached."} />;
  }
  const o = data.overview;
  const breadthTotal = o.advancers + o.decliners + o.unchanged;
  const advPct = breadthTotal ? (o.advancers / breadthTotal) * 100 : 0;
  return (
    <div className="space-y-4 p-4">
      {data.stale ? <Notice tone="warn">Showing the last retrieved market data — not live.</Notice> : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-caps">Breadth · liquid {o.quoteAsset} pairs</p>
          <p className="mt-1 text-sm">
            <span className="text-up">▲ {o.advancers}</span> <span className="text-muted">/</span> <span className="text-down">▼ {o.decliners}</span>
            <span className="ml-2 text-xs text-muted">median {formatPercent(o.medianChangePercent)}</span>
          </p>
          <div className="mt-2 flex h-1.5 w-56 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`${o.advancers} advancing, ${o.decliners} declining`}>
            <span className="bg-up" style={{ width: `${advPct}%` }} />
            <span className="ml-0.5 flex-1 bg-down" />
          </div>
        </div>
        <Freshness fetchedAt={data.fetchedAt} stale={data.stale} />
      </div>
      <div className="grid gap-5 md:grid-cols-3">
        <List title="Majors" rows={o.majors} metric="change" />
        <List title="Top gainers (≥ $1M vol)" rows={o.leaders.gainers} metric="change" />
        <List title="Top losers (≥ $1M vol)" rows={o.leaders.losers} metric="change" />
      </div>
    </div>
  );
}
