"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/radix";
import { Button, Field, Input, Notice, Select, Textarea } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/client/api";

export interface WatchEntry {
  id: string;
  symbol: string;
  reason: string | null;
  notes: string | null;
  targetPrice: number | null;
  personalRanking: number | null;
}

/** Add a pair to the watchlist (symbol fixed) or edit an existing entry. */
export function WatchlistDialog({
  symbol,
  entry,
  trigger,
  onSaved,
}: {
  symbol: string;
  entry?: WatchEntry | null;
  trigger: React.ReactNode;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(entry?.reason ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [target, setTarget] = useState(entry?.targetPrice ? String(entry.targetPrice) : "");
  const [ranking, setRanking] = useState(entry?.personalRanking ? String(entry.personalRanking) : "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    const t = Number(target);
    const targetPrice = target ? (Number.isFinite(t) && t > 0 ? t : NaN) : null;
    if (Number.isNaN(targetPrice)) {
      setError("Target price must be a positive number.");
      setSaving(false);
      return;
    }
    try {
      if (entry) {
        await apiFetch(`/api/watchlist/${entry.id}`, {
          method: "PATCH",
          json: { reason, notes, targetPrice, personalRanking: ranking ? Number(ranking) : null },
        });
      } else {
        await apiFetch("/api/watchlist", {
          method: "POST",
          json: { symbol, reason: reason || undefined, notes: notes || undefined, targetPrice },
        });
      }
      setOpen(false);
      onSaved?.();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setReason(entry?.reason ?? "");
          setNotes(entry?.notes ?? "");
          setTarget(entry?.targetPrice ? String(entry.targetPrice) : "");
          setRanking(entry?.personalRanking ? String(entry.personalRanking) : "");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={entry ? `Edit ${symbol}` : `Watch ${symbol}`} description="Your notes are private and stored in your database.">
        <div className="space-y-3">
          <Field label="Why are you watching it?" htmlFor="w-reason">
            <Textarea id="w-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={2000} />
          </Field>
          <Field label="Notes" htmlFor="w-notes">
            <Textarea id="w-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={4000} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Target price" htmlFor="w-target">
              <Input id="w-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="optional" />
            </Field>
            {entry ? (
              <Field label="Personal ranking" htmlFor="w-rank" hint="1 = highest conviction">
                <Select id="w-rank" value={ranking} onChange={(e) => setRanking(e.target.value)}>
                  <option value="">Unranked</option>
                  {Array.from({ length: 10 }, (_, i) => (
                    <option key={i + 1} value={String(i + 1)}>
                      {i + 1}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
          {error ? <Notice tone="down">{error}</Notice> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              {entry ? "Save" : "Add to watchlist"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveFromWatchlistButton({ id, symbol, onRemoved }: { id: string; symbol: string; onRemoved?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
        Remove
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-[11px] text-muted">Remove {symbol}? History is kept.</span>
      <Button
        size="sm"
        variant="danger"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await apiFetch(`/api/watchlist/${id}`, { method: "DELETE" });
            onRemoved?.();
            router.refresh();
          } finally {
            setBusy(false);
            setConfirming(false);
          }
        }}
      >
        Remove
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Keep
      </Button>
    </span>
  );
}
