import Link from "next/link";
import { EmptyState } from "@/components/ui/primitives";
import { cn, formatDateTime, formatPrice, formatQuantity, formatUsd } from "@/lib/utils/format";
import { ExecutionDialog, type ExecutionTx } from "./execution-dialog";

export interface TxRow extends ExecutionTx {
  grossAmount: number;
  fee: number;
  total: number;
  realizedPnL?: number;
  timestamp: string;
  priceWasStale: boolean;
}

export function TransactionsTable({ rows, showSymbol = true, emptyText }: { rows: TxRow[]; showSymbol?: boolean; emptyText?: string }) {
  if (!rows.length) {
    return <EmptyState title={emptyText ?? "No simulated trades yet"} description="Buy or sell from any coin's page to start your paper portfolio." />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-[0.8125rem]">
        <thead>
          <tr className="border-b border-border text-left text-[0.6875rem] text-muted">
            <th className="px-4 py-2 font-medium">Time</th>
            <th className="px-3 py-2 font-medium">Side</th>
            {showSymbol ? <th className="px-3 py-2 font-medium">Pair</th> : null}
            <th className="px-3 py-2 text-right font-medium">Quantity</th>
            <th className="px-3 py-2 text-right font-medium">Price</th>
            <th className="px-3 py-2 text-right font-medium">Fee</th>
            <th className="px-3 py-2 text-right font-medium">Cash flow</th>
            <th className="px-3 py-2 text-right font-medium">Realized P/L</th>
            <th className="px-4 py-2 font-medium">Real-world status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t._id} className="border-b border-border/70 last:border-0">
              <td className="whitespace-nowrap px-4 py-2 text-xs text-muted">
                {formatDateTime(t.timestamp)}
                {t.priceWasStale ? <span className="ml-1 text-warn" title="Simulated with a last-known (not live) price">· stale price</span> : null}
              </td>
              <td className="px-3 py-2">
                <span className={cn("text-xs font-medium", t.type === "BUY" ? "text-up" : "text-down")}>
                  {t.type === "BUY" ? "▲ Buy" : "▼ Sell"}
                </span>
              </td>
              {showSymbol ? (
                <td className="px-3 py-2">
                  <Link href={`/crypto/${t.symbol}`} className="hover:text-accent">
                    {t.symbol}
                  </Link>
                </td>
              ) : null}
              <td className="num px-3 py-2 text-right">{formatQuantity(t.quantity)}</td>
              <td className="num px-3 py-2 text-right">{formatPrice(t.price)}</td>
              <td className="num px-3 py-2 text-right text-muted">{formatUsd(t.fee)}</td>
              <td className="num px-3 py-2 text-right">{formatUsd(t.type === "BUY" ? -t.total : t.total, { sign: true })}</td>
              <td className="num px-3 py-2 text-right">
                {t.realizedPnL !== undefined ? (
                  <span className={t.realizedPnL >= 0 ? "text-up" : "text-down"}>
                    {t.realizedPnL >= 0 ? "▲" : "▼"} {formatUsd(t.realizedPnL, { sign: true })}
                  </span>
                ) : (
                  <span className="text-faint">—</span>
                )}
              </td>
              <td className="px-4 py-2">
                <ExecutionDialog tx={t} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
