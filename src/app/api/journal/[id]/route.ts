import { withApi, parseJson, parseWith } from "@/lib/api/handler";
import { idSchema, journalUpdateSchema } from "@/lib/validation/schemas";
import { updateJournalEntry } from "@/services/journal/journal-service";
import { serialize } from "@/types/serialized";

export const dynamic = "force-dynamic";

/** Edits are recorded as revisions (previous and new values), never silent rewrites. */
export const PATCH = withApi<{ id: string }>(async ({ req, user, params }) => {
  const input = await parseJson(req, journalUpdateSchema);
  return serialize(await updateJournalEntry(user.id, parseWith(idSchema, params.id), input));
});
