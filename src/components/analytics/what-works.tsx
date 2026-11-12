import { Lightbulb, TrendingDown, TrendingUp } from "lucide-react";
import { EmptyState, Panel, PanelBody, PanelHeader } from "@/components/ui/primitives";
import { cn, formatPercent, formatUsd } from "@/lib/utils/format";
import type { Analytics } from "@/services/analytics/analytics-service";

function Tile({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "up" | "down" }) {
  return (
    <div>
      <p className="label-caps">{label}</p>
      <p className={cn("num mt-1 text-base", tone === "up" && "text-up", tone === "down" && "text-down")}>{value}</p>
      {sub ? <p className="mt-0.5 text-[0.65625rem] text-faint">{sub}</p> : null}
    </div>
  );
}

function ReturnBar({ value, max }: { value: number | null; max: number }) {
  const w = value === null || max <= 0 ? 0 : Math.min(50, (Math.abs(value) / max) * 50);
  return (
    <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-surface-3" aria-hidden>
      <div className="absolute inset-y-0 left-1/2 w-px bg-border-strong" />
      {value !== null ? (
        <div className={cn("absolute inset-y-0 rounded-full", value >= 0 ? "left-1/2 bg-up" : "right-1/2 bg-down")} style={{ width: `${w}%` }} />
      ) : null}
    </div>
  );
}

/** Trade quality, auto-generated insights and "what works for you" breakdowns. */
export function WhatWorks({ a }: { a: Analytics }) {
  const q = a.quality;
  const w = a.whatWorks;
  const allBuckets = w.breakdowns.flatMap((b) => b.buckets);
  const max = Math.max(1, ...allBuckets.map((b) => Math.abs(b.avgReturnPercent ?? 0)));

  return (
    <div className="mb-4 space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Panel>
          <PanelHeader title="Trade quality" description="Win rate alone hides a lot: these show whether your wins pay for your losses." />
          {q.closed ? (
            <PanelBody className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              <Tile label="Average win" value={q.avgWinPercent !== null ? formatPercent(q.avgWinPercent, { digits: 1 }) : "—"} tone="up" sub={`${q.wins} winning rounds`} />
              <Tile label="Average loss" value={q.avgLossPercent !== null ? formatPercent(q.avgLossPercent, { digits: 1 }) : "—"} tone="down" sub={`${q.losses} losing rounds`} />
              <Tile label="Payoff ratio" value={q.payoffRatio !== null ? `${q.payoffRatio.toFixed(2)}×` : "—"} sub="avg win ÷ avg loss" />
              <Tile
                label="Profit factor"
                value={q.profitFactor !== null ? q.profitFactor.toFixed(2) : "—"}
                tone={q.profitFactor !== null ? (q.profitFactor >= 1 ? "up" : "down") : undefined}
                sub="gains ÷ losses; >1 is profitable"
              />
              <Tile
                label="Expectancy"
                value={q.expectancy !== null ? formatUsd(q.expectancy, { sign: true }) : "—"}
                tone={q.expectancy !== null ? (q.expectancy >= 0 ? "up" : "down") : undefined}
                sub={q.expectancyPercent !== null ? `${formatPercent(q.expectancyPercent, { digits: 1 })} per closed round` : "per closed round"}
              />
              <Tile label="Break-even win rate" value={q.breakEvenWinRate !== null ? `${q.breakEvenWinRate.toFixed(0)}%` : "—"} sub="at your payoff ratio" />
              <Tile label="Longest win streak" value={q.longestWinStreak} />
              <Tile label="Longest loss streak" value={q.longestLossStreak} sub={q.longestLossStreak >= 4 ? "size down after 3 losses in a row" : undefined} />
            </PanelBody>
          ) : (
            <EmptyState title="No closed positions yet" description="Trade quality appears once you have sold at least one position." />
          )}
        </Panel>

        <Panel>
          <PanelHeader title={<span className="flex items-center gap-1.5"><Lightbulb className="size-3.5 text-muted" /> What your history says</span>} description="Automatic takeaways from the breakdowns below (3+ trades per group)." />
          <PanelBody>
            {w.insights.length ? (
              <ul className="space-y-2 text-xs leading-relaxed">
                {w.insights.map((i) => (
                  <li key={i.text} className="flex gap-2">
                    {i.tone === "down" ? <TrendingDown className="mt-0.5 size-3.5 shrink-0 text-down" /> : <TrendingUp className={cn("mt-0.5 size-3.5 shrink-0", i.tone === "up" ? "text-up" : "text-accent")} />}
                    <span className="text-fg/85">{i.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">Not enough trades yet for reliable patterns. Keep trading and journaling; insights appear when groups have 3+ trades and clearly differ.</p>
            )}
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="What works for you"
          description={`Your position rounds grouped by the conditions on the day you bought.${w.fearGreedAvailable ? "" : " (Fear & Greed history is unavailable right now.)"}`}
        />
        {allBuckets.length ? (
          <div className="grid gap-px bg-border md:grid-cols-2 xl:grid-cols-3">
            {w.breakdowns
              .filter((b) => b.buckets.length)
              .map((b) => (
                <div key={b.name} className="bg-surface p-4">
                  <p className="mb-2 text-xs font-medium">{b.name}</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[0.65625rem] text-faint">
                          <th className="pb-1 text-left font-medium" />
                          <th className="pb-1 text-right font-medium">Trades</th>
                          <th className="pb-1 text-right font-medium">Win</th>
                          <th className="pb-1 text-right font-medium">Avg</th>
                          <th className="pb-1" />
                        </tr>
                      </thead>
                      <tbody>
                        {b.buckets.map((x) => (
                          <tr key={x.key} className="border-t border-border/60">
                            <td className="py-1 pr-2 text-muted">{x.label.replace(/^(Bought (in|when|while|on) )/i, "")}</td>
                            <td className="num py-1 text-right">{x.rounds}</td>
                            <td className="num py-1 text-right">{x.winRatePercent !== null ? `${x.winRatePercent.toFixed(0)}%` : "—"}</td>
                            <td className={cn("num py-1 text-right", (x.avgReturnPercent ?? 0) >= 0 ? "text-up" : "text-down")}>
                              {x.avgReturnPercent !== null ? formatPercent(x.avgReturnPercent, { digits: 1 }) : "—"}
                            </td>
                            <td className="py-1 pl-2"><ReturnBar value={x.avgReturnPercent} max={max} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            {w.confidence.length ? (
              <div className="bg-surface p-4">
                <p className="mb-2 text-xs font-medium">Your confidence vs your reviews</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[0.65625rem] text-faint">
                        <th className="pb-1 text-left font-medium" />
                        <th className="pb-1 text-right font-medium">Reviewed</th>
                        <th className="pb-1 text-right font-medium">Judged correct</th>
                      </tr>
                    </thead>
                    <tbody>
                      {w.confidence.map((c) => (
                        <tr key={c.key} className="border-t border-border/60">
                          <td className="py-1 text-muted">{c.label}</td>
                          <td className="num py-1 text-right">{c.reviewed}</td>
                          <td className="num py-1 text-right">{c.correctPercent !== null ? `${c.correctPercent.toFixed(0)}%` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[0.65625rem] text-faint">If high-confidence decisions are not judged right more often, your confidence is not yet a useful signal.</p>
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState title="No positions to analyse yet" description="Buy something with the paper portfolio; every position is grouped by the market conditions on the day you bought." />
        )}
      </Panel>
    </div>
  );
}
