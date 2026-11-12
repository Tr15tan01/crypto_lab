"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Pause, Play } from "lucide-react";
import { Tooltip } from "@/components/ui/radix";
import { cn } from "@/lib/utils/format";

/**
 * Keeps a server-rendered page live: re-fetches its data every `seconds` while the tab is
 * visible (and immediately when you come back to it after longer than that). One light request
 * per interval; nothing runs in background tabs.
 */
export function AutoRefresh({ seconds = 60, className }: { seconds?: number; className?: string }) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [pending, startTransition] = useTransition();
  const last = useRef(0);

  useEffect(() => {
    if (paused) return;
    last.current = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - last.current < seconds * 1000 - 500) return;
      last.current = Date.now();
      startTransition(() => router.refresh());
    };
    const id = window.setInterval(refresh, seconds * 1000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [paused, seconds, router]);

  return (
    <Tooltip content={paused ? "Live updates are paused on this page." : `Prices and values on this page refresh every ${seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds}s`} while the tab is open.`}>
      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        aria-pressed={!paused}
        aria-label={paused ? "Resume live updates" : "Pause live updates"}
        className={cn("inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[0.6875rem] text-muted transition-colors hover:text-fg", className)}
      >
        <span className={cn("size-1.5 rounded-full", paused ? "bg-faint" : "bg-up", !paused && (pending ? "opacity-40" : "animate-pulse-soft"))} aria-hidden />
        {paused ? "Paused" : "Live · 1 min"}
        {paused ? <Play className="size-3" /> : <Pause className="size-3" />}
      </button>
    </Tooltip>
  );
}
