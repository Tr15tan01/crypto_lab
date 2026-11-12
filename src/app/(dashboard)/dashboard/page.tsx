import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { Bell, ArrowRight } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { safe } from "@/lib/server/safe";
import { requestTime } from "@/lib/server/time";
import { getCollections } from "@/lib/mongodb/collections";
import { marketData } from "@/services/binance";
import { buildOverview } from "@/services/market/overview";
import { getPortfolioState, listTransactions } from "@/services/portfolio/portfolio-service";
import { listSnapshots, maybeCreateScheduledSnapshot } from "@/services/portfolio/snapshots";
import { listWatchlist } from "@/services/watchlist/watchlist-service";
import { listResearch } from "@/services/research/research-service";
import { listNotifications } from "@/services/alerts/alerts-service";
import { latestRun } from "@/services/learning/learning-service";
import { serialize } from "@/types/serialized";
import { PageHeader } from "@/components/layout/page-header";
import { AutoRefresh } from "@/components/layout/auto-refresh";
import { Badge, EmptyState, Notice, Panel, PanelBody, PanelHeader } from "@/components/ui/primitives";
import { ChangeText, Stat } from "@/components/market/indicators";
import { MarketOverviewPanel } from "@/components/market/market-overview-panel";
import { PortfolioValueChart } from "@/components/charts/portfolio-charts";
import { BiasBadge } from "@/components/research/research-panel";
import { formatDateTime, formatPrice, formatQuantity, formatRelative, formatUsd } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Dashboard" };

function Viewall({ href }: { href: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
      View all <ArrowRight className="size-3" />
    </Link>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  after(() => maybeCreateScheduledSnapshot(user.id).catch(() => false));

  const [stateRes, marketRes, watchRes, txRes, researchRes, notifRes, alertCountRes, learnRes] = await Promise.all([
    safe(async () => {
      const state = await getPortfolioState(user.id);
      const snaps = await listSnapshots(user.id, state.portfolio._id, new Date(requestTime() - 90 * 86_400_000));
      return { state, snaps };
    }, "dashboard.portfolio"),
    safe(async () => {
      const res = await marketData().allTickers();
      return { overview: buildOverview(res.data, "USDT"), fetchedAt: new Date(res.fetchedAt).toISOString(), stale: res.stale };
    }, "dashboard.market"),
    safe(() => listWatchlist(user.id), "dashboard.watchlist"),
    safe(() => listTransactions(user.id, { limit: 6 }), "dashboard.transactions"),
    safe(() => listResearch(user.id, { limit: 5 }), "dashboard.research"),
    safe(() => listNotifications(user.id), "dashboard.notifications"),
    safe(async () => (await getCollections()).alerts.countDocuments({ userId: user.id, status: "active" }), "dashboard.alerts"),
    safe(() => latestRun(), "dashboard.learning"),
  ]);
  const learned = learnRes.data;

  const s = stateRes.data?.state;
  const v = s?.valuation;
  const series = (stateRes.data?.snaps ?? []).map((x) => ({ t: x.timestamp.getTime(), v: x.totalValue }));
  if (v && s && !s.pricesStale && !v.unpricedSymbols.length && !v.stalePricedSymbols.length) series.push({ t: requestTime(), v: v.totalValue });
  const btc = marketRes.data?.overview.majors.find((m) => m.baseAsset === "BTC");

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Your research desk at a glance. All portfolio figures are simulated with theoretical funds."
        actions={<AutoRefresh />}
      />

      {stateRes.error ? <Notice tone="down" className="mb-4" title="Portfolio unavailable">{stateRes.error}</Notice> : null}

      <Panel className="mb-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 lg:grid-cols-4">
          <Stat label="Theoretical portfolio value" value={formatUsd(v?.totalValue)} sub={v ? <>since start <ChangeText value={v.totalReturnPercent} /></> : null} />
          <Stat label="Available virtual cash" value={formatUsd(v?.cash)} sub={s ? `${s.portfolio.quoteAsset} · started with ${formatUsd(s.portfolio.initialBalance)}` : null} />
          <Stat
            label="Overall profit / loss"
            value={<ChangeText value={v?.totalReturn} format="usd" />}
            sub={v ? <>realized <ChangeText value={v.realizedPnL} format="usd" showIcon={false} /> · unrealized <ChangeText value={v.unrealizedPnL} format="usd" showIcon={false} /></> : null}
          />
          <Stat
            label="Today's market (24h)"
            value={btc ? <>BTC <ChangeText value={btc.priceChangePercent} /></> : "—"}
            sub={marketRes.data ? <>median liquid pair <ChangeText value={marketRes.data.overview.medianChangePercent} showIcon={false} /></> : "Market data unavailable"}
          />
        </div>
      </Panel>

      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <PanelHeader title="Portfolio value · 90 days" actions={<Viewall href="/portfolio" />} />
          <PanelBody>{s ? <PortfolioValueChart points={series} initialBalance={s.portfolio.initialBalance} height={220} /> : null}</PanelBody>
        </Panel>
        <Panel>
          <PanelHeader
            title="Alerts"
            description={alertCountRes.data !== null ? `${alertCountRes.data} active` : "Unavailable"}
            actions={<Viewall href="/watchlist#alerts" />}
          />
          {notifRes.error ? (
            <EmptyState className="py-8" title={notifRes.error} />
          ) : notifRes.data?.items.length ? (
            <ul>
              {notifRes.data.items.slice(0, 6).map((n) => (
                <li key={n._id.toString()} className="border-b border-border/70 px-4 py-2 last:border-0">
                  <Link href={`/crypto/${n.symbol}`} className="block text-xs hover:text-accent">
                    <span className={n.readAt ? "text-muted" : "font-medium"}>{n.title}</span>
                    <span className="block text-[0.6875rem] text-faint">{n.body} · {formatRelative(n.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState className="py-8" icon={<Bell className="size-5" />} title="No triggered alerts" description="Set price alerts from any coin's page." />
          )}
        </Panel>
      </div>

      <Panel className="mb-4">
        <PanelHeader title="Market overview" actions={<Viewall href="/market" />} />
        <MarketOverviewPanel initial={marketRes.data ? serialize(marketRes.data) : null} initialError={marketRes.error} />
      </Panel>

      <Panel className="mb-4">
        <PanelHeader
          title="Learned model · most likely to outperform other coins this week"
          description={
            learned
              ? `Trained ${formatRelative(learned.createdAt)} on ${learned.data.samples.toLocaleString("en-US")} examples · out-of-sample AUC ${learned.test.metrics.auc.toFixed(3)} · typical ${(learned.test.metrics.baseRate * 100).toFixed(0)}%`
              : "The model trains itself on market history; open Learning to start the first run."
          }
          actions={<Viewall href="/learning" />}
        />
        {learned?.picks.top.length ? (
          <PanelBody className="flex flex-wrap gap-2">
            {learned.picks.top.slice(0, 10).map((p) => (
              <Link
                key={p.symbol}
                href={`/crypto/${p.symbol}`}
                title={p.drivers.map((d) => `${d.contribution >= 0 ? "+" : "−"} ${d.label}`).join(" · ")}
                className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs transition-colors hover:border-accent/50"
              >
                <span className="font-mono font-semibold">{p.symbol.replace(/USDT$/, "")}</span>
                <span className="num text-up">{Math.round(p.probability * 100)}%</span>
              </Link>
            ))}
          </PanelBody>
        ) : (
          <PanelBody><p className="text-xs text-muted">No trained model yet.</p></PanelBody>
        )}
      </Panel>

      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Open positions" actions={<Viewall href="/portfolio" />} />
          {v?.positions.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[0.8125rem]">
                <tbody>
                  {v.positions.map((p) => (
                    <tr key={p.symbol} className="border-b border-border/70 last:border-0">
                      <td className="px-4 py-2"><Link href={`/crypto/${p.symbol}`} className="font-medium hover:text-accent">{p.baseAsset}</Link></td>
                      <td className="num px-3 py-2 text-right text-muted">{formatQuantity(p.quantity)}</td>
                      <td className="num px-3 py-2 text-right">{formatUsd(p.marketValue)}</td>
                      <td className="px-4 py-2 text-right"><ChangeText value={p.unrealizedPercent} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              className="py-8"
              title={stateRes.error ?? "No open positions"}
              description={stateRes.error ? undefined : "Simulate a purchase from the Market Scanner."}
            />
          )}
        </Panel>
        <Panel>
          <PanelHeader title="Watchlist" actions={<Viewall href="/watchlist" />} />
          {watchRes.data?.rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[0.8125rem]">
                <tbody>
                  {watchRes.data.rows.slice(0, 8).map((w) => (
                    <tr key={w.id} className="border-b border-border/70 last:border-0">
                      <td className="px-4 py-2">
                        <Link href={`/crypto/${w.symbol}`} className="font-medium hover:text-accent">{w.baseAsset}</Link>
                        {w.tradable === false ? <Badge tone="down" className="ml-2">Not tradable</Badge> : null}
                      </td>
                      <td className="num px-3 py-2 text-right">{formatPrice(w.price)}</td>
                      <td className="px-3 py-2 text-right"><ChangeText value={w.change24h} /></td>
                      <td className="px-4 py-2 text-right text-xs text-muted">since added <ChangeText value={w.changeSinceAdded} showIcon={false} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState className="py-8" title={watchRes.error ?? "Nothing on your watchlist yet"} />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Recent simulated transactions" actions={<Viewall href="/portfolio" />} />
          {txRes.data?.length ? (
            <ul>
              {txRes.data.map((t) => (
                <li key={t._id.toString()} className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-2 text-xs last:border-0">
                  <span>
                    <span className={t.type === "BUY" ? "text-up" : "text-down"}>{t.type === "BUY" ? "▲ Buy" : "▼ Sell"}</span>{" "}
                    <Link href={`/crypto/${t.symbol}`} className="font-medium hover:text-accent">{t.symbol}</Link>
                    <span className="ml-2 text-faint">{formatDateTime(t.timestamp)}</span>
                  </span>
                  <span className="num text-muted">
                    {formatQuantity(t.quantity)} @ {formatPrice(t.price)} · {formatUsd(t.total)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState className="py-8" title={txRes.error ?? "No simulated trades yet"} />
          )}
        </Panel>
        <Panel>
          <PanelHeader title="Recent AI research" actions={<Viewall href="/research/reports" />} />
          {researchRes.data?.length ? (
            <ul>
              {researchRes.data.map((r) => (
                <li key={r._id.toString()} className="border-b border-border/70 last:border-0">
                  <Link href={`/research/reports/${r._id.toString()}`} className="flex items-center justify-between gap-2 px-4 py-2 text-xs hover:bg-surface-2">
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{r.symbol}</span>
                      <BiasBadge bias={r.bias} />
                    </span>
                    <span className="text-faint">{formatDateTime(r.timestamp)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState className="py-8" title={researchRes.error ?? "No AI reports yet"} description="Generate one from any coin's page, or ask the assistant." />
          )}
        </Panel>
      </div>
    </>
  );
}
