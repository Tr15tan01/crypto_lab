"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { apiFetch } from "@/lib/client/api";

/** Starts a conversation pre-focused on one pair, so its data is included automatically. */
export function AskAIButton({ symbol, label }: { symbol: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <Button
      variant="secondary"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        setError(false);
        try {
          const c = await apiFetch<{ _id: string }>("/api/ai/conversations", { method: "POST", json: { focusSymbol: symbol } });
          router.push(`/research?c=${c._id}`);
        } catch {
          setError(true);
          setBusy(false);
        }
      }}
      title={error ? "Could not start a conversation — try again" : undefined}
    >
      {!busy ? <Sparkles className="size-3.5 text-accent" /> : null}
      {error ? "Retry" : label}
    </Button>
  );
}
