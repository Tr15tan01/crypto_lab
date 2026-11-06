"use client";

import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { Panel, PanelBody, PanelHeader, Skeleton } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/radix";
import { cn, formatRelative } from "@/lib/utils/format";

export interface ModelView {
  probability: number;
  edgePoints: number;
  trust: number;
  testAuc: number;
  trainedAt: string;
  drivers: Array<{ label: string; value: number; contribution: number }>;
}

/** Compact gauge of the learned model's probability vs its typical value. */
export function ModelProbability({ view, compact = false }: { view: ModelView; compact?: boolean }) {
  const pct = Math.round(view.probability * 100);
  const up = view.edgePoints >= 0;
  return (
    <Tooltip
      content={
        <span>
          The app&apos;s learned model: {pct}% chance to beat BTC over 7 days ({up ? "+" : ""}
          {view.edgePoints.toFixed(1)} points vs typical). Out-of-sample AUC {view.testAuc.toFixed(3)}, trust {(view.trust * 100).toFixed(0)}%.
        </span>
      }
    >
      <span className={cn("inline-flex cursor-help items-center gap-1 font-mono", compact ? "text-[0.6875rem]" : "text-xs")}>
        <GraduationCap className="size-3.5 text-muted" />
        <span className={up ? "text-up" : "text-down"}>{pct}%</span>
        {!compact ? <span className="text-muted">beat BTC 7d</span> : null}
      </span>
    </Tooltip>
  );
}

/** Coin-page panel: what the learning model thinks of this pair and why. */
export function ModelViewCard({ symbol }: { symbol: string }) {
  const { data, loading } = useApi<{ view: ModelView | null }>(`/api/learning/score?symbol=${symbol}`);
  const v = data?.view ?? null;

  return (
    <Panel>
      <PanelHeader
        title={<span className="flex items-center gap-1.5"><GraduationCap className="size-3.5 text-muted" /> Learned model</span>}
        description="Chance this pair beats BTC over the next 7 days, from the app's own model."
        actions={<Link href="/learning" className="text-[0.6875rem] text-muted hover:text-fg">How it learns</Link>}
      />
      <PanelBody>
        {loading ? (
          <Skeleton className="h-16 w-full" />
        ) : !v ? (
          <p className="text-xs text-muted">
            {symbol === "BTCUSDT" ? "The model compares coins with BTC, so it does not score BTC itself." : "No trained model yet, or not enough history for this pair. "}
            {symbol !== "BTCUSDT" ? <Link href="/learning" className="underline">Open Learning</Link> : null}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className={cn("num text-2xl font-semibold", v.edgePoints >= 0 ? "text-up" : "text-down")}>{Math.round(v.probability * 100)}%</p>
                <p className="text-[0.6875rem] text-muted">
                  {v.edgePoints >= 0 ? "+" : ""}
                  {v.edgePoints.toFixed(1)} pts vs a typical coin
                </p>
              </div>
              <div className="text-right text-[0.6875rem] text-faint">
                <p>trust {(v.trust * 100).toFixed(0)}% · AUC {v.testAuc.toFixed(3)}</p>
                <p>trained {formatRelative(v.trainedAt)}</p>
              </div>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className={cn("h-full rounded-full", v.edgePoints >= 0 ? "bg-up" : "bg-down")} style={{ width: `${Math.round(v.probability * 100)}%` }} />
            </div>
            <div>
              <p className="label-caps mb-1">Why</p>
              <ul className="space-y-1 text-xs">
                {v.drivers.map((d) => (
                  <li key={d.label} className="flex items-center justify-between gap-2">
                    <span className="truncate text-fg/85">{d.label} <span className="num text-faint">{d.value}</span></span>
                    <span className={cn("num", d.contribution >= 0 ? "text-up" : "text-down")}>{d.contribution >= 0 ? "▲" : "▼"} {Math.abs(d.contribution).toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            </div>
            {v.trust === 0 ? <p className="text-[0.6875rem] text-warn">The latest run did not beat chance out of sample, so Autopilot ignores it.</p> : null}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
