import Link from "next/link";
import { Button, EmptyState } from "@/components/ui/primitives";
import { ChangeText } from "@/components/market/indicators";
import { TradeDialog, type TradeContext } from "./trade-dialog";
import { formatPercent, formatPrice, formatQuantity, formatRelative, formatUsd } from "@/lib/utils/format";

export interface HoldingRow {
  symbol: string;
  baseAsset: string;
  quantity: number;
  averageCost: number;
  investedValue: number;
  price: number | null;
  priceLive: boolean;
  priceAsOf: number | null;
  marketValue: number | null;
  unrealizedPnL: number | null;
  unrealizedPercent: number | null;
  allocationPercent: number | null;
  trade: TradeContext;
}

export function HoldingsTable({ rows }: { rows: HoldingRow[] }) {
  if (!rows.length) {
    return (
      <EmptyState
        title="No open positions"
        description="Find a coin in the Market Scanner and simulate a purchase."
        action={
          <Link href="/market">
            <Button size="sm">Open Market Scanner</Button>
          </Link>
        }
      />
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] text-muted">
            <th className="px-4 py-2 font-medium">Asset</th>
            <th className="px-3 py-2 text-right font-medium">Quantity</th>
            <th className="px-3 py-2 text-right font-medium">Avg cost</th>
            <th className="px-3 py-2 text-right font-medium">Price</th>
            <th className="px-3 py-2 text-right font-medium">Value</th>
            <th className="px-3 py-2 text-right font-medium">Unrealized P/L</th>
            <th className="px-3 py-2 text-right font-medium">Allocation</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.symbol} className="border-b border-border/70 last:border-0">
              <td className="px-4 py-2">
                <Link href={`/crypto/${h.symbol}`} className="font-medium hover:text-accent">
                  {h.baseAsset}
                  <span className="text-faint">/{h.trade.quoteAsset}</span>
                </Link>
              </td>
              <td className="num px-3 py-2 text-right">{formatQuantity(h.quantity)}</td>
              <td className="num px-3 py-2 text-right text-muted">{formatPrice(h.averageCost)}</td>
              <td className="num px-3 py-2 text-right">
                {formatPrice(h.price)}
                {h.price !== null && !h.priceLive ? (
                  <span className="block text-[10px] text-warn">last known · {formatRelative(h.priceAsOf)}</span>
                ) : null}
                {h.price === null ? <span className="block text-[10px] text-down">price unavailable</span> : null}
              </td>
              <td className="num px-3 py-2 text-right">{formatUsd(h.marketValue)}</td>
              <td className="px-3 py-2 text-right">
                <ChangeText value={h.unrealizedPnL} format="usd" />
                <span className="block text-[11px]">
                  <ChangeText value={h.unrealizedPercent} showIcon={false} className="text-[11px]" />
                </span>
              </td>
              <td className="num px-3 py-2 text-right text-muted">{formatPercent(h.allocationPercent, { sign: false, digits: 1 })}</td>
              <td className="px-4 py-2 text-right">
                <TradeDialog
                  side="sell"
                  ctx={h.trade}
                  trigger={
                    <Button size="sm" variant="danger" disabled={!h.trade.tradable}>
                      Sell
                    </Button>
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
