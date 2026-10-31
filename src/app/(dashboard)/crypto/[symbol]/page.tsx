import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Pencil, Star } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { safe } from "@/lib/server/safe";
import { getCollections } from "@/lib/mongodb/collections";
import { getSymbolOverview } from "@/services/market/symbol";
import { effectiveFeeRate, getActivePortfolio, listTransactions } from "@/services/portfolio/portfolio-service";
import { listResearch } from "@/services/research/research-service";
import { listJournal } from "@/services/journal/journal-service";
import { listAlerts } from "@/services/alerts/alerts-service";
import { serialize } from "@/types/serialized";
import { Badge, Button, EmptyState, Panel, PanelBody, PanelHeader } from "@/components/ui/primitives";
import { ChangeText } from "@/components/market/indicators";
import { SymbolLiveHeader } from "@/components/market/symbol-live";
import { IndicatorPanel } from "@/components/market/indicator-panel";
import { PriceChart } from "@/components/charts/price-chart";
import { TradeDialog, type TradeContext } from "@/components/portfolio/trade-dialog";
import { TransactionsTable, type TxRow } from "@/components/portfolio/transactions-table";
import { WatchlistDialog, RemoveFromWatchlistButton } from "@/components/watchlist/watch-dialogs";
import { ResearchPanel, type ResearchListItem } from "@/components/research/research-panel";
import { AskAIButton } from "@/components/research/ask-ai-button";
import { AlertsPanel, type AlertItem } from "@/components/alerts/alerts-panel";
import { JournalEntryCard, type JournalRowData } from "@/components/journal/journal-entry";
import { formatDate, formatPercent, formatPrice, formatQuantity, formatUsd } from "@/lib/utils/format";

const SYMBOL_RE = /^[A-Z0-9]{2,20}$/;

export async function generateMetadata({ params }: PageProps<"/crypto/[symbol]">): Promise<Metadata> {
  const { symbol } = await params;
  return { title: symbol.toUpperCase() };
}

export default async function CryptoPage({ params }: PageProps<"/crypto/[symbol]">) {
  const user = await requireUser();
  const symbol = (await params).symbol.toUpperCase();
  if (!SYMBOL_RE.test(symbol)) notFound();

  const [overviewRes, userData] = await Promise.all([
    safe(() => getSymbolOverview(symbol), "crypto.overview"),
    safe(async () => {
      const portfolio = await getActivePortfolio(user.id);
      const { holdings, watchlist } = await getCollections();
      const [holding, watch, txs, research, journal, alerts] = await Promise.all([
        holdings.findOne({ portfolioId: portfolio._id, symbol }),
        watchlist.findOne({ userId: user.id, symbol, active: true }),
        listTransactions(user.id, { symbol, limit: 100 }),
        listResearch(user.id, { symbol, limit: 20 }),
        listJournal(user.id, { symbol, limit: 20 }),
        listAlerts(user.id, { symbol }),
      ]);
      return { portfolio, holding, watch, txs, research, journal, alerts };
    }, "crypto.user"),
  ]);

  const overview = overviewRes.data;
  if (overview && overview.listing === "not_listed" && !userData.data?.txs.length && !userData.data?.watch) {
    notFound();
  }

  const u = userData.data;
  const ticker = overview?.ticker ?? null;
  const baseAsset = overview?.info?.baseAsset ?? symbol.replace(/(USDT|USDC|FDUSD|BTC|ETH|BNB)$/, "");
  const quoteAsset = overview?.info?.quoteAsset ?? "USDT";
  const holding = u?.holding && u.holding.quantity > 0 ? u.holding : null;

  const tradeCtx: TradeContext | null = u
    ? {
        symbol,
        baseAsset,
        quoteAsset,
        price: ticker?.price ?? null,
        priceFetchedAt: overview?.fetchedAt ?? null,
        priceStale: overview?.stale ?? true,
        tradable: overview?.listing === "tradable",
        availableBalance: u.portfolio.availableBalance,
        portfolioQuoteAsset: u.portfolio.quoteAsset,
        feeRatePercent: effectiveFeeRate(u.portfolio),
        holdingQuantity: holding?.quantity ?? 0,
        averageCost: holding?.averageCost ?? 0,
      }
    : null;

  const researchOptions = (u?.research ?? []).slice(0, 10).map((r) => ({
    id: r._id.toString(),
    label: `${r.timestamp.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} · ${r.bias ?? "no bias"} · ${r.provider}`,
  }));

  const marketValue = holding && ticker ? holding.quantity * ticker.price : null;
  const unrealized = holding && marketValue !== null ? marketValue - holding.investedValue : null;
  const watch = u?.watch ?? null;

  return (
    <>
      <Link href="/market" className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
        <ChevronLeft className="size-3.5" /> Market Scanner
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg border border-border-strong bg-surface-2 font-mono text-xs font-semibold">
            {baseAsset.slice(0, 4)}
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {overview?.name ?? baseAsset} <span className="text-muted">{baseAsset}/{quoteAsset}</span>
            </h1>
            <p className="text-xs text-muted">{symbol} · Binance Spot</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {watch ? (
            <Badge tone="accent" className="h-8 px-2.5">
              <Star className="size-3.5 fill-accent" /> Watching
            </Badge>
          ) : (
            <WatchlistDialog
              symbol={symbol}
              trigger={
                <Button disabled={overview?.listing !== "tradable"}>
                  <Star className="size-3.5" /> Watch
                </Button>
              }
            />
          )}
          <AskAIButton symbol={symbol} label={`Ask AI about ${baseAsset}`} />
          {tradeCtx ? (
            <>
              <TradeDialog
                side="buy"
                ctx={tradeCtx}
                researchOptions={researchOptions}
                trigger={
                  <Button variant="up" disabled={!tradeCtx.tradable}>
                    Buy (simulated)
                  </Button>
                }
              />
              <TradeDialog
                side="sell"
                ctx={tradeCtx}
                researchOptions={researchOptions}
                trigger={
                  <Button variant="down" disabled={!holding || !tradeCtx.tradable}>
                    Sell (simulated)
                  </Button>
                }
              />
            </>
          ) : null}
        </div>
      </div>

      <Panel className="mb-4 p-4">
        {overview ? (
          <SymbolLiveHeader initial={serialize(overview)} />
        ) : (
          <EmptyState title="Market data is unavailable" description={overviewRes.error ?? undefined} />
        )}
      </Panel>

      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <PriceChart symbol={symbol} />
        </Panel>
        <div className="space-y-4">
          <Panel>
            <PanelHeader title="My virtual position" description="Simulated holding in the paper portfolio" />
            <PanelBody>
              {!u ? (
                <p className="text-xs text-muted">{userData.error}</p>
              ) : holding ? (
                <dl className="grid grid-cols-2 gap-y-3 text-xs">
                  <div>
                    <dt className="text-muted">Quantity</dt>
                    <dd className="num text-sm">{formatQuantity(holding.quantity)} {baseAsset}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Average cost</dt>
                    <dd className="num text-sm">{formatPrice(holding.averageCost)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Market value</dt>
                    <dd className="num text-sm">{formatUsd(marketValue)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Unrealized P/L</dt>
                    <dd className="text-sm">
                      <ChangeText value={unrealized} format="usd" />{" "}
                      <span className="text-[11px]">
                        ({formatPercent(unrealized !== null && holding.investedValue ? (unrealized / holding.investedValue) * 100 : null)})
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Cost basis</dt>
                    <dd className="num">{formatUsd(holding.investedValue)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Realized on this pair</dt>
                    <dd><ChangeText value={holding.realizedPnL} format="usd" /></dd>
                  </div>
                </dl>
              ) : (
                <p className="text-xs text-muted">
                  No open position. Available virtual cash: <span className="num text-fg">{formatUsd(u.portfolio.availableBalance)}</span>
                </p>
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              title="Watchlist"
              actions={
                watch ? (
                  <>
                    <WatchlistDialog
                      symbol={symbol}
                      entry={{
                        id: watch._id.toString(),
                        symbol,
                        reason: watch.reason ?? null,
                        notes: watch.notes ?? null,
                        targetPrice: watch.targetPrice ?? null,
                        personalRanking: watch.personalRanking ?? null,
                      }}
                      trigger={
                        <Button size="sm" variant="ghost">
                          <Pencil className="size-3.5" /> Edit
                        </Button>
                      }
                    />
                    <RemoveFromWatchlistButton id={watch._id.toString()} symbol={symbol} />
                  </>
                ) : null
              }
            />
            <PanelBody className="space-y-2 text-xs">
              {watch ? (
                <>
                  <p className="text-muted">
                    Added {formatDate(watch.addedAt)} at {formatPrice(watch.priceAtAdd)}
                    {ticker && watch.priceAtAdd ? (
                      <>
                        {" · since then "}
                        <ChangeText value={((ticker.price - watch.priceAtAdd) / watch.priceAtAdd) * 100} />
                      </>
                    ) : null}
                  </p>
                  {watch.targetPrice ? <p>Target: <span className="num">{formatPrice(watch.targetPrice)}</span></p> : null}
                  {watch.reason ? <p><span className="text-muted">Why · </span>{watch.reason}</p> : null}
                  {watch.notes ? <p className="whitespace-pre-wrap text-muted">{watch.notes}</p> : null}
                </>
              ) : (
                <p className="text-muted">Not on your watchlist.</p>
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Price alerts" />
            <AlertsPanel symbol={symbol} alerts={serialize(u?.alerts ?? []) as AlertItem[]} hasPosition={Boolean(holding)} />
          </Panel>
        </div>
      </div>

      <div className="mb-4 grid items-start gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <ResearchPanel
            symbol={symbol}
            items={serialize(u?.research ?? []) as unknown as ResearchListItem[]}
            canGenerate={overview?.listing === "tradable" && Boolean(ticker)}
          />
        </Panel>
        <Panel>
          <PanelHeader title="Technical indicators" />
          <IndicatorPanel s={overview?.indicators ?? null} error={overview?.indicatorsError ?? overviewRes.error} />
        </Panel>
      </div>

      <Panel className="mb-4">
        <PanelHeader title="My simulated transactions" description={`${u?.txs.length ?? 0} on ${symbol}`} />
        <TransactionsTable rows={serialize(u?.txs ?? []) as unknown as TxRow[]} showSymbol={false} emptyText={`No simulated ${baseAsset} trades yet`} />
      </Panel>

      <Panel>
        <PanelHeader
          title="Decisions & notes"
          actions={
            <Link href={`/journal?symbol=${symbol}`} className="text-xs text-muted hover:text-fg">
              Open journal
            </Link>
          }
        />
        {u?.journal.rows.length ? (
          (serialize(u.journal.rows) as unknown as JournalRowData[]).map((row) => (
            <JournalEntryCard key={row.entry._id} row={row} showSymbol={false} />
          ))
        ) : (
          <EmptyState className="py-8" title="No decisions recorded" description="Every simulated trade creates a journal entry; you can also log HOLD/SKIP decisions from the journal." />
        )}
      </Panel>
    </>
  );
}
