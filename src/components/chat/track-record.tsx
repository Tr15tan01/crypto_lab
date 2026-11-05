"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronDown, Target } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { Tooltip } from "@/components/ui/radix";
import { cn, formatRelative } from "@/lib/utils/format";
import { OutcomeBadge, type Prediction } from "./verdict-card";

interface TrackRecordData {
  summary: {
    total: number;
    pending: number;
    correct: number;
    incorrect: number;
    inconclusive: number;
    hitRatePercent: number | null;
    avgConfidence: number | null;
    targetHits: number;
    stopHits: number;
  };
  recent: Prediction[];
}

const ARROW = { bullish: "▲", bearish: "▼", neutral: "■" } as const;

/** Sidebar panel: how often the assistant's past calls were right. Reloads when `refreshKey` changes. */
export function TrackRecord({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<TrackRecordData | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<TrackRecordData>("/api/ai/predictions")
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData(null));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (!data || data.summary.total === 0) {
    return (
      <div className="border-b border-border px-3 py-2 text-[0.6875rem] text-faint">
        <span className="flex items-center gap-1.5 text-xs text-muted"><Target className="size-3.5" /> AI track record</span>
        <span className="mt-0.5 block">Ask for a verdict on a coin — every call is scored when its horizon ends.</span>
      </div>
    );
  }

  const s = data.summary;
  const decided = s.correct + s.incorrect;
  const calibration =
    s.hitRatePercent === null || s.avgConfidence === null || decided < 5
      ? null
      : s.hitRatePercent < s.avgConfidence - 10
        ? { text: "overconfident", cls: "text-down" }
        : s.hitRatePercent > s.avgConfidence + 10
          ? { text: "underconfident", cls: "text-info" }
          : { text: "well calibrated", cls: "text-up" };

  return (
    <div className="border-b border-border px-3 py-2">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-xs text-muted hover:text-fg" aria-expanded={open}>
        <span className="flex items-center gap-1.5"><Target className="size-3.5" /> AI track record</span>
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span
          className={cn(
            "font-mono text-lg font-semibold tabular-nums",
            s.hitRatePercent === null ? "text-faint" : s.hitRatePercent >= 55 ? "text-up" : s.hitRatePercent < 45 ? "text-down" : "text-fg",
          )}
        >
          {s.hitRatePercent === null ? "—" : `${s.hitRatePercent.toFixed(0)}%`}
        </span>
        <span className="text-[0.6875rem] text-muted">
          {decided ? `${s.correct} of ${decided} right` : "no calls scored yet"}
        </span>
      </div>
      <p className="text-[0.65625rem] text-faint">
        {s.pending} pending · {s.inconclusive} inconclusive
        {s.avgConfidence !== null ? (
          <>
            {" · "}
            <Tooltip content={<span>Average stated confidence of scored calls is {s.avgConfidence}%. A calibrated forecaster&apos;s hit rate is close to it.</span>}>
              <span className={cn("cursor-help", calibration?.cls)}>{calibration ? calibration.text : `avg conf ${s.avgConfidence}%`}</span>
            </Tooltip>
          </>
        ) : null}
      </p>
      {open ? (
        <ul className="mt-2 space-y-1">
          {data.recent.map((p) => (
            <li key={p._id}>
              <Link href={p.conversationId ? `/research?c=${p.conversationId}` : "/autopilot"} className="flex items-center justify-between gap-2 rounded px-1 py-0.5 text-[0.6875rem] hover:bg-surface-2">
                <span className="min-w-0 truncate">
                  <span className={cn(p.bias === "bullish" ? "text-up" : p.bias === "bearish" ? "text-down" : "text-muted")}>{ARROW[p.bias]}</span>{" "}
                  {p.symbol.replace(/USDT$/, "")} <span className="text-faint">{p.confidence}% · {p.horizon} · {formatRelative(p.timestamp)}</span>
                </span>
                <OutcomeBadge p={p} compact />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
