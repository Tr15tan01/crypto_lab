"use client";

/** Browser-side helper for calling this app's own API routes (never third-party APIs). */
export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly details?: unknown,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function apiFetch<T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      cache: "no-store",
    });
  } catch {
    throw new ApiClientError("Network error — check your connection and try again.", "NETWORK", 0, undefined, true);
  }

  let payload: { data?: T; error?: { code: string; message: string; details?: unknown; retryable?: boolean } } = {};
  try {
    payload = await res.json();
  } catch {
    // fall through
  }

  if (!res.ok || payload.error) {
    if (res.status === 401 && typeof window !== "undefined") {
      // Session expired: a full reload clears client state before showing the login page.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiClientError(
      payload.error?.message ?? `Request failed (${res.status}).`,
      payload.error?.code ?? "HTTP_ERROR",
      res.status,
      payload.error?.details,
      payload.error?.retryable ?? res.status >= 500,
    );
  }
  return payload.data as T;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
