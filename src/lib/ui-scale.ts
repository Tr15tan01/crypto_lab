/**
 * Text size preference. Every font size and spacing in the app is in rem, so scaling the root
 * font size (via the --ui-scale variable in globals.css) scales the interface evenly. Stored per
 * browser in localStorage and applied before first paint by the inline script in app/layout.tsx.
 */
export const UI_SCALE_KEY = "ui-scale";
export const UI_SCALE_MIN = 0.85;
export const UI_SCALE_MAX = 1.25;
export const UI_SCALE_STEP = 0.05;
export const UI_SCALE_DEFAULT = 1;

export const UI_SCALE_PRESETS = [
  { value: 0.9, label: "Small" },
  { value: 1, label: "Default" },
  { value: 1.1, label: "Large" },
  { value: 1.2, label: "Extra large" },
] as const;

export function clampScale(v: number): number {
  if (!Number.isFinite(v)) return UI_SCALE_DEFAULT;
  const stepped = Math.round(v / UI_SCALE_STEP) * UI_SCALE_STEP;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(stepped * 100) / 100));
}

export const UI_SCALE_INIT_SCRIPT = `(function(){try{var v=parseFloat(localStorage.getItem(${JSON.stringify(UI_SCALE_KEY)}));if(v>=${UI_SCALE_MIN}&&v<=${UI_SCALE_MAX}&&v!==1)document.documentElement.style.setProperty("--ui-scale",String(v))}catch(e){}})()`;

export function readUiScale(): number {
  try {
    const raw = localStorage.getItem(UI_SCALE_KEY);
    return raw === null ? UI_SCALE_DEFAULT : clampScale(Number(raw));
  } catch {
    return UI_SCALE_DEFAULT;
  }
}

export function applyUiScale(v: number) {
  const s = clampScale(v);
  if (s === UI_SCALE_DEFAULT) document.documentElement.style.removeProperty("--ui-scale");
  else document.documentElement.style.setProperty("--ui-scale", String(s));
}

/** Saves and applies; notifies other components and tabs. */
export function saveUiScale(v: number) {
  const s = clampScale(v);
  try {
    if (s === UI_SCALE_DEFAULT) localStorage.removeItem(UI_SCALE_KEY);
    else localStorage.setItem(UI_SCALE_KEY, String(s));
  } catch {
    /* storage blocked: applies to this page view only */
  }
  applyUiScale(s);
  window.dispatchEvent(new Event(UI_SCALE_EVENT));
}

export const UI_SCALE_EVENT = "crypto-lab:ui-scale";
