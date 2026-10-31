import { z } from "zod";
import { withApi, parseJson, parseSearchParams } from "@/lib/api/handler";
import { decisionTypeSchema, journalCreateSchema, symbolSchema } from "@/lib/validation/schemas";
import { createJournalEntry, listJournal } from "@/services/journal/journal-service";
import { serialize } from "@/types/serialized";

export const dynamic = "force-dynamic";

export const GET = withApi(async ({ req, user }) => {
  const q = parseSearchParams(req, z.object({ symbol: symbolSchema.optional(), decisionType: decisionTypeSchema.optional() }));
  return serialize(await listJournal(user.id, q));
});

export const POST = withApi(async ({ req, user }) => {
  const input = await parseJson(req, journalCreateSchema);
  return serialize(await createJournalEntry(user.id, input));
});
