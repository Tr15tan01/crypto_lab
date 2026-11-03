"use client";

import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/radix";
import { THEME_STORAGE_KEY, applyTheme, readThemePreference, type ThemePreference } from "@/lib/theme";

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

/* The stored preference as an external store: same-tab changes notify listeners, other tabs fire "storage". */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY || e.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function choose(p: ThemePreference) {
  try {
    if (p === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, p);
  } catch {
    /* storage blocked: the choice still applies for this page view */
  }
  applyTheme(p);
  listeners.forEach((l) => l());
}

/** Top-bar theme menu. The inline script in app/layout.tsx applies the saved choice before paint. */
export function ThemeSwitch() {
  // null on the server, which cannot know the stored preference.
  const pref = useSyncExternalStore(subscribe, readThemePreference, () => null);

  // Re-apply after React Strict Mode's dev remount clears <html> attributes (a no-op in production).
  useLayoutEffect(() => {
    applyTheme(readThemePreference());
  }, []);

  // Apply changes made in other tabs, and follow the OS setting live while on "system".
  useEffect(() => {
    if (!pref) return;
    applyTheme(pref);
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-3 hover:text-fg"
          aria-label="Theme"
        >
          {/* Icons follow the resolved theme via CSS, so the first paint is already right. */}
          <Sun className="hidden size-4 light:block" aria-hidden />
          <Moon className="size-4 light:hidden" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-32">
        {OPTIONS.map((o) => {
          const Icon = o.icon;
          return (
            <DropdownMenuItem key={o.value} onSelect={() => choose(o.value)}>
              <Icon className="size-3.5 text-muted" aria-hidden />
              <span className="flex-1">{o.label}</span>
              {pref === o.value ? <Check className="size-3.5 text-accent" aria-label="selected" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
