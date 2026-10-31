"use client";

import { Field, Input, Select, Textarea } from "@/components/ui/primitives";

export interface JournalDraft {
  thesis: string;
  reason: string;
  targetPrice: string;
  expectedTimeHorizon: string;
  riskLevel: string;
  riskAssessment: string;
  confidence: string;
  notes: string;
  aiResearchId: string;
}

export const EMPTY_JOURNAL: JournalDraft = {
  thesis: "",
  reason: "",
  targetPrice: "",
  expectedTimeHorizon: "",
  riskLevel: "",
  riskAssessment: "",
  confidence: "",
  notes: "",
  aiResearchId: "",
};

/** Converts the form draft to the API's journal shape (empty fields omitted). */
export function journalPayload(d: JournalDraft) {
  const target = Number(d.targetPrice);
  const confidence = Number(d.confidence);
  return {
    thesis: d.thesis || undefined,
    reason: d.reason || undefined,
    targetPrice: d.targetPrice && Number.isFinite(target) && target > 0 ? target : undefined,
    expectedTimeHorizon: (d.expectedTimeHorizon || null) as
      | "intraday"
      | "days"
      | "weeks"
      | "months"
      | "years"
      | null,
    riskLevel: (d.riskLevel || null) as "low" | "medium" | "high" | "very_high" | null,
    riskAssessment: d.riskAssessment || undefined,
    confidence: d.confidence ? confidence : null,
    notes: d.notes || undefined,
    aiResearchId: d.aiResearchId || null,
  };
}

export interface ResearchOption {
  id: string;
  label: string;
}

export function JournalFields({
  value,
  onChange,
  decision,
  researchOptions = [],
}: {
  value: JournalDraft;
  onChange: (v: JournalDraft) => void;
  decision: "buy" | "sell" | "other";
  researchOptions?: ResearchOption[];
}) {
  const set = (k: keyof JournalDraft) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="space-y-3">
      <Field label="Investment thesis" htmlFor="j-thesis" hint="What do you believe, and why does it matter for the price?">
        <Textarea id="j-thesis" value={value.thesis} onChange={set("thesis")} maxLength={4000} rows={3} />
      </Field>
      <Field label={decision === "sell" ? "Reason for selling" : decision === "buy" ? "Reason for buying now" : "Reason"} htmlFor="j-reason">
        <Input id="j-reason" value={value.reason} onChange={set("reason")} maxLength={2000} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Expected price target" htmlFor="j-target">
          <Input id="j-target" inputMode="decimal" value={value.targetPrice} onChange={set("targetPrice")} placeholder="optional" />
        </Field>
        <Field label="Time horizon" htmlFor="j-horizon">
          <Select id="j-horizon" value={value.expectedTimeHorizon} onChange={set("expectedTimeHorizon")}>
            <option value="">Not set</option>
            <option value="intraday">Intraday</option>
            <option value="days">Days</option>
            <option value="weeks">Weeks</option>
            <option value="months">Months</option>
            <option value="years">Years</option>
          </Select>
        </Field>
        <Field label="Risk level" htmlFor="j-risk">
          <Select id="j-risk" value={value.riskLevel} onChange={set("riskLevel")}>
            <option value="">Not set</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="very_high">Very high</option>
          </Select>
        </Field>
        <Field label="Confidence (1–10)" htmlFor="j-confidence">
          <Select id="j-confidence" value={value.confidence} onChange={set("confidence")}>
            <option value="">Not set</option>
            {Array.from({ length: 10 }, (_, i) => (
              <option key={i + 1} value={String(i + 1)}>
                {i + 1}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Risk assessment" htmlFor="j-risk-text" hint="What would prove this decision wrong?">
        <Textarea id="j-risk-text" value={value.riskAssessment} onChange={set("riskAssessment")} rows={2} maxLength={2000} />
      </Field>
      {researchOptions.length ? (
        <Field label="AI analysis at the time of the decision" htmlFor="j-research">
          <Select id="j-research" value={value.aiResearchId} onChange={set("aiResearchId")}>
            <option value="">None</option>
            {researchOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="Notes" htmlFor="j-notes">
        <Textarea id="j-notes" value={value.notes} onChange={set("notes")} rows={2} maxLength={4000} />
      </Field>
    </div>
  );
}
