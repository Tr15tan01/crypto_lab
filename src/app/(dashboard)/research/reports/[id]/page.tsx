import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { safe } from "@/lib/server/safe";
import { requestTime } from "@/lib/server/time";
import { getResearch } from "@/services/research/research-service";
import { HORIZONS, HORIZON_ORDER } from "@/services/research/evaluation";
import { Badge, EmptyState, Notice, Panel, PanelBody, PanelHeader } from "@/components/ui/primitives";
import { Markdown } from "@/components/chat/markdown";
import { BiasBadge } from "@/components/research/research-panel";
import { AskAIButton } from "@/components/research/ask-ai-button";
import { cn, formatDateTime, formatPercent, formatPrice } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Analysis report" };

export default async function ReportPage({ params }: PageProps<"/research/reports/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[a-f0-9]{24}$/i.test(id)) notFound();
  const res = await safe(() => getResearch(user.id, id), "report.page");
  if (!res.data) {
    if (res.error === "Report not found.") notFound();
    return <EmptyState title="The report could not be loaded" description={res.error} />;
  }
  const r = res.data;
  const daily = (r.indicators as { daily?: Record<string, unknown> }).daily;

  return (
    <>
      <Link href="/research/reports" className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
        <ChevronLeft className="size-3.5" /> All reports
      </Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            <Link href={`/crypto/${r.symbol}`} className="hover:text-accent">{r.symbol}</Link> analysis
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            {formatDateTime(r.timestamp)} · price {formatPrice(r.priceAtAnalysis)} · data as of {formatDateTime(r.dataTimestamp)} ·{" "}
            {r.provider} / {r.model} <BiasBadge bias={r.bias} />
          </p>
        </div>
        <AskAIButton symbol={r.symbol} label="Discuss with AI" />
      </div>

      <Notice tone="warn" className="mb-4">
        AI-generated research based only on Binance market data and app-calculated indicators. Scenario ranges are hypothetical, not
        predictions. Not financial advice.
      </Notice>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <PanelBody className="p-6">
            <Markdown>{r.analysis}</Markdown>
          </PanelBody>
        </Panel>
        <div className="space-y-4">
          <Panel>
            <PanelHeader title="How the lean played out" description="Close-to-close return at each horizon; failed calls are kept." />
            <ul>
              {HORIZON_ORDER.map((h) => {
                const e = r.evaluations.find((x) => x.horizon === h);
                const due = r.timestamp.getTime() + HORIZONS[h].ms;
                return (
                  <li key={h} className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-2.5 text-xs last:border-0">
                    <span>
                      <span className="font-medium">{h}</span>
                      <span className="ml-1 text-faint">±{HORIZONS[h].thresholdPercent}%</span>
                    </span>
                    {e ? (
                      <span className="text-right">
                        <Badge tone={e.outcome === "correct" ? "up" : e.outcome === "incorrect" ? "down" : "neutral"}>{e.outcome.replace("_", " ")}</Badge>
                        <span className="num mt-1 block text-muted">
                          {formatPrice(e.startPrice)} → {formatPrice(e.endPrice)} ({formatPercent(e.returnPercent)})
                        </span>
                        <span className="num block text-faint">
                          max ▲ {formatPercent(e.maxUpsidePercent)} · max ▼ {formatPercent(e.maxDownsidePercent)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-faint">{due > requestTime() ? `due ${formatDateTime(due)}` : "pending evaluation"}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>
          {r.scenarios && (r.scenarios.bullish || r.scenarios.bearish) ? (
            <Panel>
              <PanelHeader title="Hypothetical scenario ranges" description="As stated in the report — not forecasts." />
              <PanelBody className="space-y-1.5 text-xs">
                {r.scenarios.bullish ? (
                  <p><span className="text-up">▲ Bullish</span> <span className="num">{formatPrice(r.scenarios.bullish.low)} – {formatPrice(r.scenarios.bullish.high)}</span></p>
                ) : null}
                {r.scenarios.bearish ? (
                  <p><span className="text-down">▼ Bearish</span> <span className="num">{formatPrice(r.scenarios.bearish.low)} – {formatPrice(r.scenarios.bearish.high)}</span></p>
                ) : null}
              </PanelBody>
            </Panel>
          ) : null}
          {daily ? (
            <Panel>
              <PanelHeader title="Indicator values used" description="Calculated by the app at report time (daily candles)" />
              <PanelBody>
                <dl className="space-y-1 text-xs">
                  {(["rsi14", "ema20", "ema50", "ema200", "atrPercent"] as const).map((k) => (
                    <div key={k} className="flex justify-between">
                      <dt className="text-muted">{k}</dt>
                      <dd className={cn("num")}>{typeof daily[k] === "number" ? formatPrice(daily[k] as number) : "—"}</dd>
                    </div>
                  ))}
                </dl>
              </PanelBody>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
