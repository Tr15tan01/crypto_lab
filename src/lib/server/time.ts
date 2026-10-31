import "server-only";

/** The time this request is being rendered. Server Components render once per request. */
export function requestTime(): number {
  return Date.now();
}
