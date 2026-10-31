"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/radix";
import { Button, Field, Input, Notice, Select } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { EMPTY_JOURNAL, JournalFields, journalPayload, type JournalDraft } from "@/components/portfolio/journal-fields";

/** Log a decision that is not a simulated trade: HOLD, WATCH, SKIP (or a trade decided but not simulated). */
export function NewJournalEntryDialog({ defaultSymbol }: { defaultSymbol?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [symbol, setSymbol] = useState(defaultSymbol ?? "");
  const [decisionType, setDecisionType] = useState("HOLD");
  const [draft, setDraft] = useState<JournalDraft>(EMPTY_JOURNAL);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      let s = symbol.trim().toUpperCase();
      if (/^[A-Z0-9]{2,10}$/.test(s) && !/(USDT|USDC|FDUSD|BTC|ETH|BNB)$/.test(s)) s = `${s}USDT`;
      await apiFetch("/api/journal", { method: "POST", json: { symbol: s, decisionType, ...journalPayload(draft) } });
      setOpen(false);
      setDraft(EMPTY_JOURNAL);
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
        <Button variant="primary">
          <Plus className="size-3.5" /> Log a decision
        </Button>
      </DialogTrigger>
      <DialogContent wide title="Log a decision" description="Simulated trades create entries automatically. Use this for decisions to hold, wait or pass.">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pair" htmlFor="n-symbol" hint="e.g. BTCUSDT (or BTC)">
              <Input id="n-symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} autoFocus />
            </Field>
            <Field label="Decision" htmlFor="n-type">
              <Select id="n-type" value={decisionType} onChange={(e) => setDecisionType(e.target.value)}>
                <option value="HOLD">Hold</option>
                <option value="WATCH">Watch / wait</option>
                <option value="SKIP">Skip (decided not to buy)</option>
                <option value="BUY">Buy (not simulated)</option>
                <option value="SELL">Sell (not simulated)</option>
              </Select>
            </Field>
          </div>
          <JournalFields value={draft} onChange={setDraft} decision="other" />
          {error ? <Notice tone="down">{error}</Notice> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={saving} disabled={!symbol.trim()} onClick={() => void save()}>Save decision</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
