import "server-only";
import { isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export type SafeResult<T> = { data: T; error: null } | { data: null; error: string };

/** Runs a server-side read for a page; failures become a user-safe message instead of a crash. */
export async function safe<T>(fn: () => Promise<T>, label = "page.data"): Promise<SafeResult<T>> {
  try {
    return { data: await fn(), error: null };
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_")) {
      throw err; // redirects / notFound
    }
    if (!isAppError(err) || err.status >= 500) logger.error(`${label}.failed`, { error: err });
    return { data: null, error: isAppError(err) ? err.publicMessage : "This data could not be loaded right now." };
  }
}
