/**
 * Light/dark theme. The preference ("system" | "light" | "dark") lives in localStorage; the
 * resolved theme is the `data-theme` attribute on <html>, which globals.css keys the palette on.
 * Shared by the server layout (inline script, applied before first paint) and the client switch.
 */
export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";
export const DEFAULT_THEME: ResolvedTheme = "dark";

/** Runs synchronously while <head> is parsed, so the page never paints in the wrong theme. */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var t=p==="light"||p==="dark"?p:(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

export function readThemePreference(): ThemePreference {
  try {
    const p = localStorage.getItem(THEME_STORAGE_KEY);
    return p === "light" || p === "dark" ? p : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref !== "system") return pref;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(pref: ThemePreference) {
  document.documentElement.setAttribute("data-theme", resolveTheme(pref));
}
