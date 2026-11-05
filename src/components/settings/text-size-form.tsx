"use client";

import { useSyncExternalStore } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import {
  UI_SCALE_DEFAULT,
  UI_SCALE_EVENT,
  UI_SCALE_KEY,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_PRESETS,
  UI_SCALE_STEP,
  clampScale,
  readUiScale,
  saveUiScale,
} from "@/lib/ui-scale";
import { cn } from "@/lib/utils/format";

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === UI_SCALE_KEY || e.key === null) onChange();
  };
  window.addEventListener(UI_SCALE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(UI_SCALE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Text size for this browser: applies instantly to every page, saved locally. */
export function TextSizeForm() {
  // null on the server, which cannot know the stored preference.
  const scale = useSyncExternalStore(subscribe, readUiScale, () => null);
  const current = scale ?? UI_SCALE_DEFAULT;
  const pct = Math.round(current * 100);
  const set = (v: number) => saveUiScale(clampScale(v));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button
          size="icon"
          variant="secondary"
          onClick={() => set(current - UI_SCALE_STEP)}
          disabled={current <= UI_SCALE_MIN}
          aria-label="Smaller text"
        >
          <Minus className="size-3.5" />
        </Button>
        <input
          type="range"
          min={UI_SCALE_MIN * 100}
          max={UI_SCALE_MAX * 100}
          step={UI_SCALE_STEP * 100}
          value={pct}
          onChange={(e) => set(Number(e.target.value) / 100)}
          aria-label="Text size"
          aria-valuetext={`${pct}%`}
          className="h-1.5 flex-1 accent-[var(--color-accent)]"
        />
        <Button
          size="icon"
          variant="secondary"
          onClick={() => set(current + UI_SCALE_STEP)}
          disabled={current >= UI_SCALE_MAX}
          aria-label="Larger text"
        >
          <Plus className="size-3.5" />
        </Button>
        <span className="num w-12 text-right text-sm">{scale === null ? "—" : `${pct}%`}</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {UI_SCALE_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => set(p.value)}
            aria-pressed={Math.abs(current - p.value) < 0.001}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              Math.abs(current - p.value) < 0.001
                ? "border-accent/60 bg-accent/10 text-fg"
                : "border-border-strong text-muted hover:border-accent/50 hover:text-fg",
            )}
          >
            {p.label} <span className="text-faint">{Math.round(p.value * 100)}%</span>
          </button>
        ))}
        {current !== UI_SCALE_DEFAULT ? (
          <Button size="sm" variant="ghost" onClick={() => set(UI_SCALE_DEFAULT)}>
            <RotateCcw className="size-3.5" /> Reset
          </Button>
        ) : null}
      </div>

      <div className="rounded-md border border-border bg-surface-2 px-3 py-2.5">
        <p className="label-caps">Preview</p>
        <p className="mt-1 text-[0.8125rem]">BTCUSDT is trading at <span className="num">80,198.42</span>, <span className="text-up">+2.41%</span> today.</p>
        <p className="text-[0.6875rem] text-muted">Small labels, tables and chart axes scale together with the text.</p>
      </div>
      <p className="text-[0.6875rem] text-faint">
        Range {Math.round(UI_SCALE_MIN * 100)}–{Math.round(UI_SCALE_MAX * 100)}%. Saved in this browser and applied on every page, before it is drawn.
        Your browser&apos;s own zoom and default font size still apply on top.
      </p>
    </div>
  );
}
