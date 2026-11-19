import type { Metadata } from "next";
import { Info } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { safe } from "@/lib/server/safe";
import { requestTime } from "@/lib/server/time";
import { getPortfolioState, listTransactions } from "@/services/portfolio/portfolio-service";
import { listSnapshots } from "@/services/portfolio/snapshots";
import { holdingRows } from "@/services/portfolio/view";
import { monthlyReturns } from "@/services/analytics/metrics";
import { serialize } from "@/types/serialized";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, Notice, Panel, PanelBody, PanelHeader } from "@/components/ui/primitives";
import { ChangeText, Freshness, Stat } from "@/components/market/indicators";
import { HoldingsTable } from "@/components/portfolio/holdings-table";
import { TransactionsTable, type TxRow } from "@/components/portfolio/transactions-table";
import {
  ActivityTimeline,
  AllocationChart,
  AssetPnLChart,
  MonthlyChart,
  PortfolioValueChart,
} from "@/components/charts/portfolio-charts";
import { Tooltip } from "@/components/ui/radix";
import { formatUsd } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Portfolio" };

export default async function PortfolioPage() {
  const user = await requireUser();
  const res = await safe(async () => {
    const state = await getPortfolioState(user.id);
    const [txs, snaps, holdings] = await Promise.all([
      listTransactions(user.id, { limit: 500 }),
      listSnapshots(user.id, state.portfolio._id),
      holdingRows(state),
    ]);
    return { state, txs, snaps, holdings };
  }, "portfolio.page");

  if (!res.data) {
    return (
      <>
        <PageHeader title="Portfolio" />
        <Panel>
          <EmptyState title="The portfolio could not be loaded" description={res.error} />
        </Panel>
      </>
    );
  }

  const { state, txs, snaps, holdings } = res.data;
  const v = state.valuation;
  const p = state.portfolio;
  const series = snaps.map((s) => ({ t: s.timestamp.getTime(), v: s.totalValue }));
  // Append the current live value so the line reaches "now" — only when every price is live.
  if (!state.pricesStale && v.unpricedSymbols.length === 0 && v.stalePricedSymbols.length === 0) {
    series.push({ t: requestTime(), v: v.totalValue });
  }
  const realizedBySymbol = new Map<string, number>();
  for (const t of txs) if (t.realizedPnL !== undefined) realizedBySymbol.set(t.symbol, (realizedBySymbol.get(t.symbol) ?? 0) + t.realizedPnL);
  const pnlRows = [...new Set([...realizedBySymbol.keys(), ...v.positions.map((x) => x.symbol)])].map((s) => ({
    label: s.replace(new RegExp(`${p.quoteAsset}$`), ""),
    realized: realizedBySymbol.get(s) ?? 0,
    unrealized: v.positions.find((x) => x.symbol === s)?.unrealizedPnL ?? 0,
  }));
  const allocation = [
    { label: "Cash", value: v.cash },
    ...v.positions.filter((x) => x.marketValue !== null).map((x) => ({ label: x.baseAsset, value: x.marketValue! })),
  ];
  const closedTrades = txs.filter((t) => t.type === "SELL").length;

  return (
    <>
      <PageHeader
        title="Portfolio"
        description={`Paper portfolio started ${p.createdAt.toLocaleDateString("en-US", { dateStyle: "medium" })} with ${formatUsd(p.initialBalance)} theoretical ${p.quoteAsset}. Accounting: average cost basis, fees included in cost.`}
        actions={<Freshness fetchedAt={state.pricesFetchedAt} stale={state.pricesStale} />}
      />

      {v.unpricedSymbols.length ? (
        <Notice tone="down" className="mb-4" title="Some positions have no price">
          {v.unpricedSymbols.join(", ")} could not be priced and are excluded from the totals below (they are not counted as zero).
        </Notice>
      ) : null}
      {v.stalePricedSymbols.length ? (
        <Notice tone="warn" className="mb-4" title="Some values use last-known prices">
          {v.stalePricedSymbols.join(", ")} {v.stalePricedSymbols.length === 1 ? "is" : "are"} valued with the last stored price, not a live one.
        </Notice>
      ) : null}

      <Panel className="mb-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 md:grid-cols-4 xl:grid-cols-5">
          <Stat label="Total value" value={formatUsd(v.totalValue)} sub={<ChangeText value={v.totalReturnPercent} />} />
          <Stat label="Available cash" value={formatUsd(v.cash)} sub={`${p.quoteAsset} · theoretical`} />
          <Stat label="Invested (cost basis)" value={formatUsd(v.investedValue)} sub={`Market value ${formatUsd(v.marketValue)}`} />
          <Stat label="Unrealized P/L" value={<ChangeText value={v.unrealizedPnL} format="usd" />} />
          <Stat label="Realized P/L" value={<ChangeText value={v.realizedPnL} format="usd" />} sub={`Fees paid ${formatUsd(p.totalFeesPaid)}`} />
          <Stat label="Overall return" value={<ChangeText value={v.totalReturnPercent} />} sub={formatUsd(v.totalReturn, { sign: true })} />
          <Stat label="Best performer" value={v.best ? v.best.baseAsset : "—"} sub={v.best ? <ChangeText value={v.best.unrealizedPercent} /> : null} />
          <Stat label="Worst performer" value={v.worst ? v.worst.baseAsset : "—"} sub={v.worst ? <ChangeText value={v.worst.unrealizedPercent} /> : null} />
          <Stat label="Open positions" value={v.positions.length} />
          <Stat label="Completed trades" value={closedTrades} sub={`${txs.length} transactions total`} />
        </div>
      </Panel>

      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <PanelHeader
            title="Portfolio value vs starting balance"
            description="From stored snapshots only — history is never re-priced with today's prices."
            actions={
              <Tooltip content="Snapshots are stored after every trade and on a schedule (hourly while the app or the cron job runs). Gaps mean no snapshot was taken, not that the value was flat.">
                <Info className="size-3.5 text-faint" aria-label="About snapshots" />
              </Tooltip>
            }
          />
          <PanelBody>
            <PortfolioValueChart points={series} initialBalance={p.initialBalance} />
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader title="Asset allocation" description="Share of current total value" />
          <PanelBody>
            <AllocationChart slices={allocation} />
          </PanelBody>
        </Panel>
      </div>

      <Panel className="mb-4">
        <PanelHeader title="Open positions" description={`${v.positions.length} holding${v.positions.length === 1 ? "" : "s"}`} />
        <HoldingsTable rows={serialize(holdings)} />
      </Panel>

      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Realized vs unrealized P/L by asset" />
          <PanelBody>
            <AssetPnLChart rows={pnlRows} />
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader title="Monthly performance" description="Change in total value per calendar month (UTC), from snapshots" />
          <PanelBody>
            <MonthlyChart months={monthlyReturns(series)} />
          </PanelBody>
        </Panel>
      </div>

      <Panel className="mb-4">
        <PanelHeader title="Buy / sell activity" />
        <PanelBody>
          <ActivityTimeline trades={txs.map((t) => ({ t: t.timestamp.getTime(), symbol: t.symbol, type: t.type, total: t.total, price: t.price }))} />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          title="Transaction history"
          description="Every simulated trade is kept. Click a status to record whether you executed it on Binance yourself."
        />
        <TransactionsTable rows={serialize(txs) as unknown as TxRow[]} />
      </Panel>
    </>
  );
}
