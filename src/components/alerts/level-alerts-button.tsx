"use client";

import { useState } from "react";
import { BellPlus, Check } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/radix";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { formatPrice } from "@/lib/utils/format";

/**
 * Creates price alerts at a call's stop and target in one click, so you hear about it when a
 * level is reached instead of having to watch the chart.
 */
export function LevelAlertsButton({
  symbol,
  price,
  stop,
  target,
  source,
  size = "sm",
}: {
  symbol: string;
  price: number;
  stop: number | null;
  target: number | null;
  source: string;
  size?: "sm" | "md";
}) {
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const levels = [
    stop !== null ? { label: "stop", value: stop } : null,
    target !== null ? { label: "target", value: target } : null,
  ].filter((l): l is { label: string; value: number } => l !== null && l.value > 0 && l.value !== price);
  if (!levels.length) return null;

  const create = async () => {
    setState("saving");
    setError(null);
    try {
      for (const l of levels) {
        await apiFetch("/api/alerts", {
          method: "POST",
          json: {
            symbol,
            type: l.value > price ? "PRICE_ABOVE" : "PRICE_BELOW",
            threshold: l.value,
            note: `${source} ${l.label} (set at ${formatPrice(price)})`,
          },
        });
      }
      setState("done");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not create the alerts.");
      setState("idle");
    }
  };

  return (
    <Tooltip
      content={
        error ?? (
          <span>
            Alert me when {symbol} reaches {levels.map((l) => `the ${l.label} ${formatPrice(l.value)}`).join(" or ")}.
          </span>
        )
      }
    >
      <Button size={size} variant="ghost" onClick={() => void create()} loading={state === "saving"} disabled={state === "done"}>
        {state === "done" ? <Check className="size-3.5 text-up" /> : <BellPlus className="size-3.5" />}
        {state === "done" ? "Alerts set" : error ? "Retry alerts" : "Set alerts"}
      </Button>
    </Tooltip>
  );
}
