"use client";

import { useEffect, useLayoutEffect } from "react";
import { UI_SCALE_KEY, applyUiScale, readUiScale } from "@/lib/ui-scale";

/**
 * Keeps the text-size setting applied: re-applies it after React Strict Mode's dev remount
 * clears <html> attributes (a no-op in production) and follows changes made in other tabs.
 */
export function UiScaleSync() {
  useLayoutEffect(() => {
    applyUiScale(readUiScale());
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === UI_SCALE_KEY || e.key === null) applyUiScale(readUiScale());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return null;
}
