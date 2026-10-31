import { z } from "zod";
import { withApi, parseJson, parseWith } from "@/lib/api/handler";
import { idSchema } from "@/lib/validation/schemas";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { streamReply } from "@/services/ai/orchestration/chat-service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z
  .object({
    content: z.string().trim().max(4000).optional(),
    retry: z.boolean().optional(),
  })
  .refine((b) => b.retry || (b.content && b.content.length > 0), "Message is empty");

/** Streams the assistant reply as newline-delimited JSON events. */
export const POST = withApi<{ id: string }>(
  async ({ req, user, params }) => {
    const id = parseWith(idSchema, params.id);
    const body = await parseJson(req, bodySchema);
    const stream = await streamReply(user.id, id, body, req.signal);
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  },
  { rateLimit: RATE_LIMITS.aiChat },
);
