"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/client/api";

interface State<T> {
  data: T | undefined;
  error: ApiClientError | null;
  loading: boolean;
}

/**
 * Small data-fetching hook for this app's API routes.
 * - Keeps the last successful data when a refresh fails (so stale data stays visible, flagged by the API).
 * - Optional polling that pauses while the tab is hidden.
 */
export function useApi<T>(
  url: string | null,
  options: { refreshInterval?: number; initialData?: T } = {},
) {
  const { refreshInterval, initialData } = options;
  const [state, setState] = useState<State<T>>({
    data: initialData,
    error: null,
    loading: url !== null && initialData === undefined,
  });
  const urlRef = useRef(url);
  useLayoutEffect(() => {
    urlRef.current = url;
  }, [url]);
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const current = urlRef.current;
    if (!current) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setState((s) => ({ ...s, loading: s.data === undefined }));
    try {
      const data = await apiFetch<T>(current, { signal: controller.signal });
      if (!controller.signal.aborted && urlRef.current === current) setState({ data, error: null, loading: false });
    } catch (err) {
      if (controller.signal.aborted) return;
      const error =
        err instanceof ApiClientError ? err : new ApiClientError("Something went wrong.", "UNKNOWN", 0, undefined, true);
      setState((s) => ({ data: s.data, error, loading: false }));
    }
  }, []);

  useEffect(() => {
    if (!url) return;
    if (initialData === undefined) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, load]);

  useEffect(() => {
    if (!url || !refreshInterval) return;
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const id = window.setInterval(tick, refreshInterval);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, refreshInterval, load]);

  useEffect(() => () => inFlight.current?.abort(), []);

  return { ...state, refresh: load, setData: (d: T) => setState((s) => ({ ...s, data: d })) };
}
