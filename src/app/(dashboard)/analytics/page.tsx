import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { safe } from "@/lib/server/safe";
import { getAnalytics } from "@/services/analytics/analytics-service";
import { evaluateDueResearch } from "@/services/research/research-service";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, Notice, Panel, PanelBody, PanelHeader } from "@/components/ui/primitives";
import { ChangeText, Stat } from "@/components/market/indicators";
import { BenchmarkChart, MonthlyChart } from "@/components/charts/portfolio-charts";
import { formatDate, formatPercent, formatUsd } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Analytics" };
export const maxDuration = 60;

function pct(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : formatPercent(v, { sign: false, digits: 0 });
}

export default async function AnalyticsPage() {
  const user = await requireUser();
  after(() => evaluateDueResearch(user.id, 5).catch(() => 0));
  const res = await safe(() => getAnalytics(user.id), "analytics.page");
  if (!res.data) {
    return (
      <>
        <PageHeader title="Analytics" />
        <Panel><EmptyState title="Analytics could not be calculated" description={res.error} /></Panel>
      </>
    );
  }
  const a = res.data;
  const btc = a.benchmarks.BTCUSDT;
  const eth = a.benchmarks.ETHUSDT;
  const vsBtc = btc?.returnPercent !== null && btc?.returnPercent !== undefined && a.portfolio.totalReturnPercent !== null
    ? a.portfolio.totalReturnPercent - btc.returnPercent
    : null;

  return (
    <>
      <PageHeader
        title="Analytics"
        description={`An objective look at your simulated decisions since ${formatDate(a.portfolio.createdAt)}. Definitions are listed at the bottom of the page.`}
      />
      {a.portfolio.pricesStale ? <Notice tone="warn" className="mb-4">Live prices are unavailable; current values use the last known prices.</Notice> : null}

      <Panel className="mb-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 md:grid-cols-4 xl:grid-cols-6">
          <Stat label="Portfolio return" value={<ChangeText value={a.portfolio.totalReturnPercent} />} sub={formatUsd(a.portfolio.totalValue)} />
          <Stat label="Hold-BTC return" value={<ChangeText value={btc?.returnPercent} />} sub={vsBtc !== null ? <>vs BTC <ChangeText value={vsBtc} /></> : "Benchmark unavailable"} />
          <Stat label="Hold-ETH return" value={<ChangeText value={eth?.returnPercent} />} />
          <Stat label="Profitable purchases" value={pct(a.purchases.profitablePercent)} sub={`${a.purchases.profitable} of ${a.purchases.evaluated}`} />
          <Stat label="Winning sales" value={pct(a.trades.winRatePercent)} sub={`${a.trades.sells} sale${a.trades.sells === 1 ? "" : "s"}`} />
          <Stat label="Average sale return" value={<ChangeText value={a.trades.averageReturnPercent} />} />
          <Stat label="Max drawdown" value={a.drawdown ? formatPercent(a.drawdown.percent) : "—"} sub={a.drawdown && a.drawdown.percent < 0 ? `${formatDate(a.drawdown.peakAt)} → ${formatDate(a.drawdown.troughAt)}` : "From snapshots"} />
          <Stat label="Avg holding period" value={a.holding.averageHoldDays !== null ? `${a.holding.averageHoldDays.toFixed(1)} d` : "—"} sub={a.holding.medianHoldDays !== null ? `median ${a.holding.medianHoldDays.toFixed(1)} d` : `${a.holding.closedRounds} closed positions`} />
          <Stat label="Sold too early" value={pct(a.exits.earlyPercent)} sub={`${a.exits.early} of ${a.exits.timed} sales`} />
          <Stat label="Bought near local high" value={pct(a.purchases.nearHighPercent)} sub={`${a.purchases.nearHigh} of ${a.purchases.timed} buys`} />
          <Stat
            label="Best trade"
            value={a.trades.best?.realizedPnL !== undefined ? <ChangeText value={a.trades.best.realizedPnL} format="usd" /> : "—"}
            sub={a.trades.best ? <Link className="hover:text-fg" href={`/crypto/${a.trades.best.symbol}`}>{a.trades.best.symbol}</Link> : null}
          />
          <Stat
            label="Worst trade"
            value={a.trades.worst?.realizedPnL !== undefined ? <ChangeText value={a.trades.worst.realizedPnL} format="usd" /> : "—"}
            sub={a.trades.worst ? <Link className="hover:text-fg" href={`/crypto/${a.trades.worst.symbol}`}>{a.trades.worst.symbol}</Link> : null}
          />
        </div>
      </Panel>

      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <PanelHeader title="Portfolio vs simply holding BTC / ETH" description="Starting balance invested at the portfolio start, held unchanged" />
          <PanelBody>
            <BenchmarkChart
              portfolio={a.series}
              benchmarks={[
                ...(btc ? [{ label: "Hold BTC", series: btc.series }] : []),
                ...(eth ? [{ label: "Hold ETH", series: eth.series }] : []),
              ]}
            />
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader title="Monthly performance" />
          <PanelBody>
            <MonthlyChart months={a.monthly} />
          </PanelBody>
        </Panel>
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Performance by cryptocurrency" description="Realized plus current unrealized P/L" />
          {a.bySymbol.length ? (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] text-muted">
                  <th className="px-4 py-2 font-medium">Pair</th>
                  <th className="px-3 py-2 text-right font-medium">Positions</th>
                  <th className="px-3 py-2 text-right font-medium">Realized</th>
                  <th className="px-4 py-2 text-right font-medium">Unrealized</th>
                </tr>
              </thead>
              <tbody>
                {a.bySymbol.map((s) => (
                  <tr key={s.symbol} className="border-b border-border/70 last:border-0">
                    <td className="px-4 py-2"><Link href={`/crypto/${s.symbol}`} className="hover:text-accent">{s.symbol}</Link></td>
                    <td className="num px-3 py-2 text-right text-muted">{s.rounds}</td>
                    <td className="px-3 py-2 text-right"><ChangeText value={s.realizedPnL} format="usd" /></td>
                    <td className="px-4 py-2 text-right"><ChangeText value={s.unrealizedPnL} format="usd" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState title="No trades yet" />
          )}
        </Panel>

        <Panel>
          <PanelHeader title="AI analysis track record" description="Tracked separately from your portfolio. Unsuccessful calls are kept." />
          {a.ai.reports === 0 ? (
            <EmptyState title="No AI reports yet" description="Generate analysis reports from a coin's page; each is evaluated at 1h, 24h, 7d and 30d." />
          ) : (
            <>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] text-muted">
                    <th className="px-4 py-2 font-medium">Horizon</th>
                    <th className="px-3 py-2 text-right font-medium">Evaluated</th>
                    <th className="px-3 py-2 text-right font-medium">Correct</th>
                    <th className="px-3 py-2 text-right font-medium">Wrong</th>
                    <th className="px-3 py-2 text-right font-medium">Inconclusive</th>
                    <th className="px-3 py-2 text-right font-medium">Hit rate</th>
                    <th className="px-4 py-2 text-right font-medium">Avg max ▲ / ▼</th>
                  </tr>
                </thead>
                <tbody>
                  {a.ai.byHorizon.map((h) => (
                    <tr key={h.horizon} className="border-b border-border/70 last:border-0">
                      <td className="px-4 py-2">{h.horizon} <span className="text-[11px] text-faint">±{h.thresholdPercent}%</span></td>
                      <td className="num px-3 py-2 text-right">{h.evaluated}</td>
                      <td className="num px-3 py-2 text-right">{h.correct}</td>
                      <td className="num px-3 py-2 text-right">{h.incorrect}</td>
                      <td className="num px-3 py-2 text-right text-muted">{h.inconclusive}</td>
                      <td className="num px-3 py-2 text-right">{pct(h.hitRatePercent)}</td>
                      <td className="num px-4 py-2 text-right text-muted">
                        {h.avgMaxUpside !== null ? `${formatPercent(h.avgMaxUpside, { digits: 1 })} / ${formatPercent(h.avgMaxDownside, { digits: 1 })}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-4 py-3 text-[11px] text-faint">
                {a.ai.reports} reports, {a.ai.withBias} with a stated lean. Hit rate counts only correct vs wrong verdicts. <Link href="/research/reports" className="text-muted hover:text-fg">All reports →</Link>
              </p>
            </>
          )}
        </Panel>
      </div>

      <Panel className="mb-4">
        <PanelHeader title="Positions (open → closed)" description="Each round runs from the first buy until the position is fully sold" />
        {a.rounds.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] text-muted">
                  <th className="px-4 py-2 font-medium">Pair</th>
                  <th className="px-3 py-2 font-medium">Opened</th>
                  <th className="px-3 py-2 font-medium">Closed</th>
                  <th className="px-3 py-2 text-right font-medium">Held</th>
                  <th className="px-3 py-2 text-right font-medium">Buys / sells</th>
                  <th className="px-3 py-2 text-right font-medium">Invested</th>
                  <th className="px-4 py-2 text-right font-medium">Realized</th>
                </tr>
              </thead>
              <tbody>
                {a.rounds.map((r, i) => (
                  <tr key={`${r.symbol}-${i}`} className="border-b border-border/70 last:border-0">
                    <td className="px-4 py-2"><Link href={`/crypto/${r.symbol}`} className="hover:text-accent">{r.symbol}</Link></td>
                    <td className="px-3 py-2 text-xs text-muted">{formatDate(r.openedAt)}</td>
                    <td className="px-3 py-2 text-xs text-muted">{r.closedAt ? formatDate(r.closedAt) : "open"}</td>
                    <td className="num px-3 py-2 text-right">{(r.holdMs / 86_400_000).toFixed(1)} d</td>
                    <td className="num px-3 py-2 text-right text-muted">{r.buyCount} / {r.sellCount}</td>
                    <td className="num px-3 py-2 text-right">{formatUsd(r.invested)}</td>
                    <td className="px-4 py-2 text-right">
                      <ChangeText value={r.sellCount ? r.realizedPnL : null} format="usd" />
                      {r.realizedReturnPercent !== null ? <span className="block text-[11px] text-muted">{formatPercent(r.realizedReturnPercent)}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No positions yet" />
        )}
      </Panel>

      <Panel>
        <PanelHeader title="Definitions" />
        <PanelBody>
          <ul className="list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-muted">
            {Object.values(a.definitions).map((d) => (
              <li key={d}>{d}</li>
            ))}
            <li>Max drawdown and monthly performance are computed from stored portfolio snapshots only.</li>
            <li>Total fees paid so far: {formatUsd(a.portfolio.totalFeesPaid)} (simulated).</li>
          </ul>
        </PanelBody>
      </Panel>
    </>
  );
}
