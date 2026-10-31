import { withApi, parseJson, parseWith } from "@/lib/api/handler";
import { idSchema, journalReviewSchema } from "@/lib/validation/schemas";
import { addJournalReview } from "@/services/journal/journal-service";
import { serialize } from "@/types/serialized";

export const dynamic = "force-dynamic";

export const POST = withApi<{ id: string }>(async ({ req, user, params }) => {
  const input = await parseJson(req, journalReviewSchema);
  return serialize(await addJournalReview(user.id, parseWith(idSchema, params.id), input));
});
