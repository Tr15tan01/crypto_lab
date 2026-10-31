"use client";

import Link from "next/link";
import { Bell, FlaskConical } from "lucide-react";
import { useEffect, useRef } from "react";
import { useApi } from "@/hooks/use-api";
import { apiFetch } from "@/lib/client/api";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, Tooltip } from "@/components/ui/radix";
import { cn, formatDateTime, formatRelative } from "@/lib/utils/format";

interface MarketStatus {
  state: "live" | "stale" | "unavailable";
  lastUpdatedAt: string | null;
  source: string;
}

interface NotificationsPayload {
  unread: number;
  items: Array<{ id: string; title: string; body: string; createdAt: string; readAt: string | null; symbol: string }>;
  pollIntervalSeconds: number;
}

function MarketStatusPill() {
  const { data, error } = useApi<MarketStatus>("/api/market/status", { refreshInterval: 30_000 });
  const state = error ? "unavailable" : (data?.state ?? "unavailable");
  const label = { live: "Live", stale: "Stale", unavailable: "Offline" }[state];
  const tone = {
    live: "bg-up",
    stale: "bg-warn",
    unavailable: "bg-down",
  }[state];
  return (
    <Tooltip
      content={
        <span>
          Binance market data: <b>{label}</b>
          <br />
          Last successful update: {data?.lastUpdatedAt ? formatDateTime(data.lastUpdatedAt) : "never"}
        </span>
      }
    >
      <span className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted">
        <span className={cn("size-1.5 rounded-full", tone, state === "live" && "animate-pulse-soft")} />
        Binance {label}
        {data?.lastUpdatedAt && state !== "live" ? (
          <span className="text-faint">· {formatRelative(data.lastUpdatedAt)}</span>
        ) : null}
      </span>
    </Tooltip>
  );
}

function Notifications() {
  const { data, refresh } = useApi<NotificationsPayload>("/api/notifications", { refreshInterval: 60_000 });
  const lastCheck = useRef(0);

  // Ask the server to evaluate alerts periodically while the app is open (it throttles itself).
  useEffect(() => {
    const interval = Math.max(15, data?.pollIntervalSeconds ?? 60) * 1000;
    const run = async () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastCheck.current < interval - 1000) return;
      lastCheck.current = Date.now();
      try {
        const res = await apiFetch<{ triggered: number }>("/api/alerts/check", { method: "POST" });
        if (res.triggered > 0) void refresh();
      } catch {
        // Alert checks are best-effort; the market status pill reports data problems.
      }
    };
    void run();
    const id = window.setInterval(run, interval);
    return () => window.clearInterval(id);
  }, [data?.pollIntervalSeconds, refresh]);

  const markRead = async () => {
    if (!data?.unread) return;
    try {
      await apiFetch("/api/notifications", { method: "POST", json: { action: "mark_all_read" } });
      void refresh();
    } catch {
      /* ignore */
    }
  };

  return (
    <DropdownMenu onOpenChange={(open) => !open && void markRead()}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative rounded-md p-1.5 text-muted transition-colors hover:bg-surface-3 hover:text-fg"
          aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ""}`}
        >
          <Bell className="size-4" />
          {data?.unread ? (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-3.5 items-center justify-center rounded-full bg-accent px-1 font-mono text-[9px] font-semibold leading-3.5 text-accent-fg">
              {data.unread > 9 ? "9+" : data.unread}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-medium">Alerts</span>
          <Link href="/watchlist#alerts" className="text-[11px] text-muted hover:text-fg">
            Manage
          </Link>
        </div>
        {data?.items.length ? (
          <ul className="max-h-80 overflow-y-auto">
            {data.items.map((n) => (
              <li key={n.id} className="border-b border-border px-3 py-2 last:border-0">
                <Link href={`/crypto/${n.symbol}`} className="block">
                  <p className={cn("text-xs", n.readAt ? "text-muted" : "font-medium text-fg")}>{n.title}</p>
                  <p className="mt-0.5 text-[11px] text-muted">{n.body}</p>
                  <p className="mt-0.5 text-[10px] text-faint">{formatDateTime(n.createdAt)}</p>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-6 text-center text-xs text-muted">No alerts have triggered yet.</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopBar() {
  return (
    <div className="sticky top-12 z-30 flex h-11 items-center justify-between border-b border-border bg-bg/90 px-4 backdrop-blur sm:px-6 lg:top-0">
      <Tooltip content="Every trade in this app is simulated with theoretical dollars. Nothing is sent to Binance.">
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          <FlaskConical className="size-3.5 text-accent" />
          <span className="hidden sm:inline">Paper trading · simulated funds only</span>
          <span className="sm:hidden">Simulated</span>
        </span>
      </Tooltip>
      <div className="flex items-center gap-2">
        <MarketStatusPill />
        <Notifications />
      </div>
    </div>
  );
}
