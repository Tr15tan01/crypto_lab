"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BellPlus, Trash2 } from "lucide-react";
import { Badge, Button, EmptyState, Input, Notice, Select } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { formatDateTime, formatPrice } from "@/lib/utils/format";

export interface AlertItem {
  _id: string;
  symbol: string;
  type: string;
  threshold: number;
  referencePrice: number | null;
  status: "active" | "triggered" | "disabled";
  note?: string;
  createdAt: string;
  triggeredAt?: string | null;
  triggerPrice?: number | null;
}

const TYPES: Array<{ value: string; label: string; unit: string; needsPosition?: boolean }> = [
  { value: "PRICE_ABOVE", label: "Price rises to", unit: "price" },
  { value: "PRICE_BELOW", label: "Price falls to", unit: "price" },
  { value: "CHANGE_UP_PERCENT", label: "Rises by", unit: "%" },
  { value: "CHANGE_DOWN_PERCENT", label: "Drops by", unit: "%" },
  { value: "POSITION_PROFIT_PERCENT", label: "Position profit ≥", unit: "%", needsPosition: true },
  { value: "POSITION_LOSS_PERCENT", label: "Position loss ≥", unit: "%", needsPosition: true },
];

export function describe(a: Pick<AlertItem, "type" | "threshold" | "referencePrice">) {
  const t = TYPES.find((x) => x.value === a.type);
  if (!t) return a.type;
  const value = t.unit === "%" ? `${a.threshold}%` : formatPrice(a.threshold);
  return `${t.label} ${value}${a.referencePrice ? ` (from ${formatPrice(a.referencePrice)})` : ""}`;
}

export function AlertsPanel({
  symbol,
  alerts,
  hasPosition,
  showSymbol = false,
}: {
  symbol?: string;
  alerts: AlertItem[];
  hasPosition?: boolean;
  showSymbol?: boolean;
}) {
  const router = useRouter();
  const [type, setType] = useState("PRICE_ABOVE");
  const [threshold, setThreshold] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!symbol) return;
    const n = Number(threshold);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter a positive number.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/alerts", { method: "POST", json: { symbol, type, threshold: n } });
      setThreshold("");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not create the alert.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await apiFetch(`/api/alerts/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not delete the alert.");
    }
  };

  return (
    <div>
      {symbol ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Alert condition" className="w-auto flex-1">
            {TYPES.filter((t) => !t.needsPosition || hasPosition).map((t) => (
              <option key={t.value} value={t.value}>
                {t.label} ({t.unit})
              </option>
            ))}
          </Select>
          <Input
            inputMode="decimal"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder={TYPES.find((t) => t.value === type)?.unit === "%" ? "e.g. 5" : "price"}
            aria-label="Threshold"
            className="w-28"
          />
          <Button size="md" variant="secondary" loading={busy} onClick={() => void create()}>
            <BellPlus className="size-3.5" /> Add
          </Button>
        </div>
      ) : null}
      {error ? <Notice tone="down" className="m-3">{error}</Notice> : null}
      {alerts.length === 0 ? (
        <EmptyState className="py-6" title="No alerts" description="Alerts are checked against Binance prices while the app is open and by the scheduled job." />
      ) : (
        <ul>
          {alerts.map((a) => (
            <li key={a._id} className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2 text-xs last:border-0">
              <span className="min-w-0">
                {showSymbol ? <span className="mr-1.5 font-medium">{a.symbol}</span> : null}
                <span className="text-fg">{describe(a)}</span>
                <span className="block text-[11px] text-faint">
                  {a.status === "triggered" && a.triggeredAt
                    ? `Triggered ${formatDateTime(a.triggeredAt)} at ${formatPrice(a.triggerPrice)}`
                    : `Created ${formatDateTime(a.createdAt)}`}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <Badge tone={a.status === "active" ? "accent" : a.status === "triggered" ? "info" : "neutral"}>{a.status}</Badge>
                <button type="button" onClick={() => void remove(a._id)} className="rounded-sm p-1 text-faint hover:text-down" aria-label="Delete alert">
                  <Trash2 className="size-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
