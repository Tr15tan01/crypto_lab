import { z } from "zod";
import { withApi, parseJson, parseWith } from "@/lib/api/handler";
import { idSchema } from "@/lib/validation/schemas";
import { deleteConversation, getConversation, renameConversation } from "@/services/ai/orchestration/chat-service";
import { serialize } from "@/types/serialized";

export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>(async ({ user, params }) =>
  serialize(await getConversation(user.id, parseWith(idSchema, params.id))),
);

export const PATCH = withApi<{ id: string }>(async ({ req, user, params }) => {
  const { title } = await parseJson(req, z.object({ title: z.string().trim().min(1).max(120) }));
  return serialize(await renameConversation(user.id, parseWith(idSchema, params.id), title));
});

export const DELETE = withApi<{ id: string }>(async ({ user, params }) => {
  await deleteConversation(user.id, parseWith(idSchema, params.id));
  return { ok: true };
});
