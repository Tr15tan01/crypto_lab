"use client";

import { useApi } from "@/hooks/use-api";
import { ChangeText, Freshness, ListingBadge } from "./indicators";
import { Notice } from "@/components/ui/primitives";
import { formatCompact, formatDate, formatPrice } from "@/lib/utils/format";
import type { SymbolOverview } from "@/services/market/symbol";
import type { Serialized } from "@/types/serialized";

type Overview = Serialized<SymbolOverview>;

/** Live price header for a pair; refreshes every 20 s while visible. */
export function SymbolLiveHeader({ initial }: { initial: Overview }) {
  const { data } = useApi<Overview>(`/api/market/${initial.symbol}`, { refreshInterval: 20_000, initialData: initial });
  const o = data ?? initial;
  const t = o.ticker;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <p className="num text-3xl font-medium tracking-tight">{t ? formatPrice(t.price) : "—"}</p>
          <div className="mt-1 flex items-center gap-2 text-sm">
            <ChangeText value={t?.priceChangePercent} />
            <span className="text-xs text-muted">24h</span>
            <Freshness fetchedAt={o.fetchedAt} stale={o.stale} />
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-muted">24h high</dt>
            <dd className="num">{formatPrice(t?.high)}</dd>
          </div>
          <div>
            <dt className="text-muted">24h low</dt>
            <dd className="num">{formatPrice(t?.low)}</dd>
          </div>
          <div>
            <dt className="text-muted">24h volume ({t?.quoteAsset ?? "quote"})</dt>
            <dd className="num">{formatCompact(t?.quoteVolume)}</dd>
          </div>
          <div>
            <dt className="text-muted">First Binance data</dt>
            <dd className="num" title="Date of the earliest daily candle Binance serves for this pair — not the project's launch date.">
              {formatDate(o.firstAvailableCandle)}
            </dd>
          </div>
        </dl>
        <div className="ml-auto">
          <ListingBadge listing={o.listing} />
        </div>
      </div>
      {o.tickerError && !t ? <Notice tone="down">{o.tickerError}</Notice> : null}
      {o.stale ? (
        <Notice tone="warn" title="Showing the last successfully retrieved price">
          Binance is not reachable right now; this price is not live.
        </Notice>
      ) : null}
    </div>
  );
}
