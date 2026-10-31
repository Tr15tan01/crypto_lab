"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X, FlaskConical } from "lucide-react";
import { NAV_ITEMS } from "./nav";
import { cn } from "@/lib/utils/format";

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-0.5">
      {NAV_ITEMS.map((item) => {
        const active =
          pathname === item.href ||
          pathname.startsWith(`${item.href}/`) ||
          item.match?.some((m) => pathname.startsWith(m));
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors",
                active ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              {active ? <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" aria-hidden /> : null}
              <Icon className={cn("size-4 shrink-0", active ? "text-accent" : "text-faint group-hover:text-muted")} />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 px-2.5">
      <span className="flex size-6 items-center justify-center rounded-md border border-accent/30 bg-accent/10">
        <FlaskConical className="size-3.5 text-accent" />
      </span>
      <span className="text-[13px] font-semibold tracking-tight">Crypto Lab</span>
    </Link>
  );
}

export function Sidebar({ email, signOutSlot }: { email: string; signOutSlot: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border bg-bg py-4 lg:flex">
        <Brand />
        <nav aria-label="Main" className="mt-6 flex-1 px-2">
          <NavLinks />
        </nav>
        <div className="mx-2 space-y-2 border-t border-border px-2.5 pt-3">
          <p className="truncate text-[11px] text-faint" title={email}>
            {email}
          </p>
          {signOutSlot}
        </div>
      </aside>

      {/* Mobile */}
      <div className="sticky top-0 z-40 flex h-12 items-center justify-between border-b border-border bg-bg/95 px-3 backdrop-blur lg:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md p-1.5 text-muted hover:bg-surface-3 hover:text-fg"
          aria-label="Open navigation"
        >
          <Menu className="size-5" />
        </button>
      </div>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-bg py-4 animate-fade-in">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-muted hover:bg-surface-3"
                aria-label="Close navigation"
              >
                <X className="size-4" />
              </button>
            </div>
            <nav aria-label="Main" className="mt-6 flex-1 px-2">
              <NavLinks onNavigate={() => setOpen(false)} />
            </nav>
            <div className="mx-2 space-y-2 border-t border-border px-2.5 pt-3">
              <p className="truncate text-[11px] text-faint">{email}</p>
              {signOutSlot}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
