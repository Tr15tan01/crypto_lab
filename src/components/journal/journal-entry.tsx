"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { History, PencilLine, Scale } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/radix";
import { Badge, Button, Field, Notice, Select, Textarea } from "@/components/ui/primitives";
import { ChangeText } from "@/components/market/indicators";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { cn, formatDateTime, formatPrice } from "@/lib/utils/format";
import { JournalFields, type JournalDraft } from "@/components/portfolio/journal-fields";
import { ExecutionBadge, type ExecutionStatus } from "@/components/portfolio/execution-dialog";

export interface JournalRowData {
  entry: {
    _id: string;
    symbol: string;
    decisionType: "BUY" | "SELL" | "HOLD" | "WATCH" | "SKIP";
    thesis?: string;
    reason?: string;
    confidence?: number | null;
    targetPrice?: number | null;
    expectedTimeHorizon?: string | null;
    riskLevel?: string | null;
    riskAssessment?: string;
    notes?: string;
    priceAtDecision: number | null;
    outcome?: string | null;
    reviews: Array<{ reviewedAt: string; priceAtReview: number | null; verdict: string; notes?: string }>;
    revisions: Array<{ revisedAt: string; changes: Record<string, { from: unknown; to: unknown }> }>;
    timestamp: string;
  };
  currentPrice: number | null;
  changeSinceDecision: number | null;
  targetReached: boolean | null;
  transaction: { type: string; quantity: number; price: number; executionStatus: string } | null;
  research: { id: string; bias: string | null; provider: string; model: string; timestamp: string } | null;
}

const DECISION_TONE = { BUY: "up", SELL: "down", HOLD: "neutral", WATCH: "info", SKIP: "neutral" } as const;
const VERDICT_LABEL: Record<string, string> = { correct: "Worked", incorrect: "Failed", mixed: "Mixed", too_early: "Too early to tell" };

function draftFrom(e: JournalRowData["entry"]): JournalDraft {
  return {
    thesis: e.thesis ?? "",
    reason: e.reason ?? "",
    targetPrice: e.targetPrice ? String(e.targetPrice) : "",
    expectedTimeHorizon: e.expectedTimeHorizon ?? "",
    riskLevel: e.riskLevel ?? "",
    riskAssessment: e.riskAssessment ?? "",
    confidence: e.confidence ? String(e.confidence) : "",
    notes: e.notes ?? "",
    aiResearchId: "",
  };
}

function EditDialog({ e }: { e: JournalRowData["entry"] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<JournalDraft>(draftFrom(e));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    setError(null);
    const target = Number(draft.targetPrice);
    try {
      await apiFetch(`/api/journal/${e._id}`, {
        method: "PATCH",
        json: {
          thesis: draft.thesis,
          reason: draft.reason,
          riskAssessment: draft.riskAssessment,
          notes: draft.notes,
          targetPrice: draft.targetPrice ? (Number.isFinite(target) && target > 0 ? target : undefined) : null,
          expectedTimeHorizon: draft.expectedTimeHorizon || null,
          riskLevel: draft.riskLevel || null,
          confidence: draft.confidence ? Number(draft.confidence) : null,
        },
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setDraft(draftFrom(e)); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost"><PencilLine className="size-3.5" /> Edit</Button>
      </DialogTrigger>
      <DialogContent wide title={`Edit decision · ${e.symbol}`} description="Changes are kept in the entry's revision history.">
        <JournalFields value={draft} onChange={setDraft} decision={e.decisionType === "BUY" ? "buy" : e.decisionType === "SELL" ? "sell" : "other"} />
        {error ? <Notice tone="down" className="mt-3">{error}</Notice> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => void save()}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReviewDialog({ e }: { e: JournalRowData["entry"] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [verdict, setVerdict] = useState("correct");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/journal/${e._id}/reviews`, { method: "POST", json: { verdict, notes: notes || undefined } });
      setOpen(false);
      setNotes("");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost"><Scale className="size-3.5" /> Review</Button>
      </DialogTrigger>
      <DialogContent title={`Review decision · ${e.symbol}`} description="Record how this decision turned out. Reviews are added, never overwritten.">
        <div className="space-y-3">
          <Field label="Verdict" htmlFor="r-verdict">
            <Select id="r-verdict" value={verdict} onChange={(ev) => setVerdict(ev.target.value)}>
              {Object.entries(VERDICT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="What worked, what didn't?" htmlFor="r-notes">
            <Textarea id="r-notes" value={notes} onChange={(ev) => setNotes(ev.target.value)} rows={4} maxLength={2000} />
          </Field>
          {error ? <Notice tone="down">{error}</Notice> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={() => void save()}>Save review</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function JournalEntryCard({ row, showSymbol = true }: { row: JournalRowData; showSymbol?: boolean }) {
  const e = row.entry;
  const [showHistory, setShowHistory] = useState(false);
  const facts: Array<[string, React.ReactNode]> = [
    ["Price at decision", formatPrice(e.priceAtDecision)],
    ["Now", formatPrice(row.currentPrice)],
    ["Since decision", <ChangeText key="c" value={row.changeSinceDecision} />],
    ["Target", e.targetPrice ? `${formatPrice(e.targetPrice)}${row.targetReached ? " · reached" : ""}` : "—"],
    ["Horizon", e.expectedTimeHorizon ?? "—"],
    ["Risk", e.riskLevel ? e.riskLevel.replace("_", " ") : "—"],
    ["Confidence", e.confidence ? `${e.confidence}/10` : "—"],
  ];
  return (
    <article className="border-b border-border/70 px-4 py-4 last:border-0">
      <header className="flex flex-wrap items-center gap-2">
        <Badge tone={DECISION_TONE[e.decisionType]}>{e.decisionType}</Badge>
        {showSymbol ? (
          <Link href={`/crypto/${e.symbol}`} className="text-[13px] font-medium hover:text-accent">{e.symbol}</Link>
        ) : null}
        <span className="text-xs text-muted">{formatDateTime(e.timestamp)}</span>
        {row.transaction ? <ExecutionBadge status={row.transaction.executionStatus as ExecutionStatus} /> : <Badge>Decision only</Badge>}
        {e.outcome ? (
          <Badge tone={e.outcome === "correct" ? "up" : e.outcome === "incorrect" ? "down" : "neutral"}>Review: {VERDICT_LABEL[e.outcome]}</Badge>
        ) : null}
        <span className="ml-auto flex gap-1">
          <EditDialog e={e} />
          <ReviewDialog e={e} />
        </span>
      </header>
      {e.thesis || e.reason ? (
        <div className="mt-2.5 space-y-1.5 text-[13px] leading-relaxed">
          {e.thesis ? <p><span className="text-muted">Thesis · </span>{e.thesis}</p> : null}
          {e.reason ? <p><span className="text-muted">Reason · </span>{e.reason}</p> : null}
          {e.riskAssessment ? <p><span className="text-muted">Risk · </span>{e.riskAssessment}</p> : null}
          {e.notes ? <p className="text-muted">{e.notes}</p> : null}
        </div>
      ) : (
        <p className="mt-2 text-xs text-faint">No thesis was recorded for this decision.</p>
      )}
      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {facts.map(([k, v]) => (
          <div key={k} className="flex gap-1.5">
            <dt className="text-muted">{k}</dt>
            <dd className="num">{v}</dd>
          </div>
        ))}
        {row.research ? (
          <div className="flex gap-1.5">
            <dt className="text-muted">AI analysis</dt>
            <dd>
              <Link className="text-info hover:underline" href={`/research/reports/${row.research.id}`}>
                {row.research.bias ?? "report"} · {formatDateTime(row.research.timestamp)}
              </Link>
            </dd>
          </div>
        ) : null}
      </dl>
      {e.reviews.length || e.revisions.length ? (
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          className="mt-3 flex items-center gap-1 text-[11px] text-muted hover:text-fg"
          aria-expanded={showHistory}
        >
          <History className="size-3" /> {e.reviews.length} review{e.reviews.length === 1 ? "" : "s"} · {e.revisions.length} edit
          {e.revisions.length === 1 ? "" : "s"}
        </button>
      ) : null}
      {showHistory ? (
        <ul className={cn("mt-2 space-y-1.5 border-l border-border pl-3 text-[11px] text-muted")}>
          {e.reviews.map((r, i) => (
            <li key={`r${i}`}>
              {formatDateTime(r.reviewedAt)} — reviewed as <b className="text-fg">{VERDICT_LABEL[r.verdict]}</b> at {formatPrice(r.priceAtReview)}
              {r.notes ? `: ${r.notes}` : ""}
            </li>
          ))}
          {e.revisions.map((r, i) => (
            <li key={`v${i}`}>
              {formatDateTime(r.revisedAt)} — edited {Object.keys(r.changes).join(", ")}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
