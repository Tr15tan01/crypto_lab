import { z } from "zod";
import { withApi, parseJson } from "@/lib/api/handler";
import { symbolSchema } from "@/lib/validation/schemas";
import { createConversation, listConversations } from "@/services/ai/orchestration/chat-service";
import { serialize } from "@/types/serialized";

export const dynamic = "force-dynamic";

export const GET = withApi(async ({ user }) => serialize(await listConversations(user.id)));

const createSchema = z.object({
  title: z.string().trim().max(120).optional(),
  focusSymbol: symbolSchema.nullable().optional(),
});

export const POST = withApi(async ({ req, user }) => {
  const input = await parseJson(req, createSchema);
  return serialize(await createConversation(user.id, input));
});
