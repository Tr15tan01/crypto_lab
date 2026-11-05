"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileText, Sparkles } from "lucide-react";
import { Badge, Button, EmptyState, Notice } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { formatDateTime, formatPrice } from "@/lib/utils/format";

export interface ResearchListItem {
  _id: string;
  symbol: string;
  provider: string;
  model: string;
  priceAtAnalysis: number;
  bias: "bullish" | "neutral" | "bearish" | null;
  timestamp: string;
  evaluations: Array<{ horizon: string; outcome: string; returnPercent: number }>;
}

export function BiasBadge({ bias }: { bias: ResearchListItem["bias"] }) {
  if (!bias) return <Badge>No bias stated</Badge>;
  return <Badge tone={bias === "bullish" ? "up" : bias === "bearish" ? "down" : "neutral"}>{bias === "bullish" ? "▲ " : bias === "bearish" ? "▼ " : "◆ "}{bias} lean</Badge>;
}

export function OutcomeChips({ evaluations }: { evaluations: ResearchListItem["evaluations"] }) {
  if (!evaluations.length) return <span className="text-[0.6875rem] text-faint">Not evaluated yet</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {evaluations.map((e) => (
        <Badge
          key={e.horizon}
          tone={e.outcome === "correct" ? "up" : e.outcome === "incorrect" ? "down" : "neutral"}
          title={`${e.horizon}: ${e.outcome} (${e.returnPercent.toFixed(2)}%)`}
        >
          {e.horizon} {e.outcome === "correct" ? "✓" : e.outcome === "incorrect" ? "✗" : "–"}
        </Badge>
      ))}
    </span>
  );
}

export function ResearchPanel({ symbol, items, canGenerate }: { symbol: string; items: ResearchListItem[]; canGenerate: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const doc = await apiFetch<{ _id: string }>("/api/research", { method: "POST", json: { symbol } });
      router.push(`/research/reports/${doc._id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "The analysis could not be generated.");
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-[0.8125rem] font-semibold">AI analysis reports</h2>
          <p className="mt-0.5 text-xs text-muted">Indicators are computed by the app; the AI interprets them. Not a forecast.</p>
        </div>
        <Button size="sm" variant="primary" loading={busy} disabled={!canGenerate} onClick={() => void generate()}>
          {!busy ? <Sparkles className="size-3.5" /> : null}
          {busy ? "Analysing… (up to a minute)" : "Generate analysis"}
        </Button>
      </div>
      {error ? <Notice tone="down" className="m-4">{error}</Notice> : null}
      {items.length === 0 ? (
        <EmptyState icon={<FileText className="size-5" />} title="No reports yet" description="Generate one to store a dated, comparable assessment." />
      ) : (
        <ul>
          {items.map((r) => (
            <li key={r._id} className="border-b border-border/70 last:border-0">
              <Link href={`/research/reports/${r._id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 hover:bg-surface-2">
                <span className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-fg">{formatDateTime(r.timestamp)}</span>
                  <BiasBadge bias={r.bias} />
                  <span className="text-faint">
                    @ {formatPrice(r.priceAtAnalysis)} · {r.provider}/{r.model}
                  </span>
                </span>
                <OutcomeChips evaluations={r.evaluations} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
