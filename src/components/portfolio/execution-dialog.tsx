"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/radix";
import { Badge, Button, Field, Input, Notice, Select, Textarea } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { formatDateTime, formatPrice, formatQuantity } from "@/lib/utils/format";

export type ExecutionStatus = "NOT_EXECUTED" | "EXECUTED" | "PARTIALLY_EXECUTED" | "CANCELLED";

export const EXECUTION_LABEL: Record<ExecutionStatus, string> = {
  NOT_EXECUTED: "Not executed",
  EXECUTED: "Executed on Binance",
  PARTIALLY_EXECUTED: "Partially executed",
  CANCELLED: "Cancelled",
};

export function ExecutionBadge({ status }: { status: ExecutionStatus }) {
  const tone = status === "EXECUTED" ? "info" : status === "PARTIALLY_EXECUTED" ? "warn" : status === "CANCELLED" ? "neutral" : "neutral";
  return <Badge tone={tone}>{status === "NOT_EXECUTED" ? "Simulated only" : EXECUTION_LABEL[status]}</Badge>;
}

export interface ExecutionTx {
  _id: string;
  type: "BUY" | "SELL";
  symbol: string;
  baseAsset: string;
  quantity: number;
  price: number;
  executionStatus: ExecutionStatus;
  actualExecutionDetails: {
    price?: number | null;
    quantity?: number | null;
    fee?: number | null;
    feeAsset?: string | null;
    executedAt?: string | null;
    orderReference?: string | null;
  } | null;
  executionHistory: Array<{ status: ExecutionStatus; recordedAt: string; note?: string }>;
}

function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Manually record whether a simulated decision was actually executed on Binance. */
export function ExecutionDialog({ tx }: { tx: ExecutionTx }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const d = tx.actualExecutionDetails;
  const [status, setStatus] = useState<ExecutionStatus>(tx.executionStatus);
  const [price, setPrice] = useState(d?.price ? String(d.price) : String(tx.price));
  const [qty, setQty] = useState(d?.quantity ? String(d.quantity) : String(tx.quantity));
  const [fee, setFee] = useState(d?.fee !== null && d?.fee !== undefined ? String(d.fee) : "");
  const [feeAsset, setFeeAsset] = useState(d?.feeAsset ?? "");
  const [executedAt, setExecutedAt] = useState(toLocalInput(d?.executedAt));
  const [orderRef, setOrderRef] = useState(d?.orderReference ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const executed = status === "EXECUTED" || status === "PARTIALLY_EXECUTED";

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/portfolio/transactions/${tx._id}/execution`, {
        method: "PATCH",
        json: {
          status,
          note: note || undefined,
          details: executed
            ? {
                price: Number(price) || null,
                quantity: Number(qty) || null,
                fee: fee === "" ? null : Number(fee),
                feeAsset: feeAsset || null,
                executedAt: executedAt ? new Date(executedAt).toISOString() : null,
                orderReference: orderRef || null,
              }
            : undefined,
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="text-left" aria-label={`Real-world status for ${tx.type} ${tx.symbol}`}>
          <ExecutionBadge status={tx.executionStatus} />
        </button>
      </DialogTrigger>
      <DialogContent
        title="Did you execute this trade on Binance?"
        description={`Simulated ${tx.type.toLowerCase()} of ${formatQuantity(tx.quantity)} ${tx.baseAsset} at ${formatPrice(tx.price)}. Only you can confirm a real trade — nothing is imported from Binance.`}
      >
        <div className="space-y-3">
          <Field label="Real-world status" htmlFor="x-status">
            <Select id="x-status" value={status} onChange={(e) => setStatus(e.target.value as ExecutionStatus)}>
              {(Object.keys(EXECUTION_LABEL) as ExecutionStatus[]).map((s) => (
                <option key={s} value={s}>
                  {EXECUTION_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          {executed ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Actual price" htmlFor="x-price">
                <Input id="x-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
              </Field>
              <Field label="Actual quantity" htmlFor="x-qty">
                <Input id="x-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
              </Field>
              <Field label="Actual fee" htmlFor="x-fee">
                <Input id="x-fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="optional" />
              </Field>
              <Field label="Fee asset" htmlFor="x-fee-asset">
                <Input id="x-fee-asset" value={feeAsset} onChange={(e) => setFeeAsset(e.target.value.toUpperCase())} placeholder="e.g. BNB" />
              </Field>
              <Field label="Execution date" htmlFor="x-date">
                <Input id="x-date" type="datetime-local" value={executedAt} onChange={(e) => setExecutedAt(e.target.value)} />
              </Field>
              <Field label="Binance order reference" htmlFor="x-ref">
                <Input id="x-ref" value={orderRef} onChange={(e) => setOrderRef(e.target.value)} placeholder="optional" maxLength={64} />
              </Field>
            </div>
          ) : null}
          <Field label="Note" htmlFor="x-note" hint="Saved in the status history.">
            <Textarea id="x-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} />
          </Field>
          {tx.executionHistory.length > 1 ? (
            <div className="rounded-md border border-border p-2.5">
              <p className="label-caps mb-1.5">Status history</p>
              <ul className="space-y-1 text-[11px] text-muted">
                {tx.executionHistory.map((h, i) => (
                  <li key={i}>
                    {formatDateTime(h.recordedAt)} — {EXECUTION_LABEL[h.status]}
                    {h.note ? ` · ${h.note}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {error ? <Notice tone="down">{error}</Notice> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              Save status
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
