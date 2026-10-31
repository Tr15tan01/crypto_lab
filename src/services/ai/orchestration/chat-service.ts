import "server-only";
import { ObjectId } from "mongodb";
import { getCollections } from "@/lib/mongodb/collections";
import { AppError, NotFoundError, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { ConversationDoc, MessageDoc } from "@/models";
import { getAIProvider } from "../providers/factory";
import { AIProviderError, type ChatTurn } from "../providers/types";
import { buildChatContext } from "../context/context-builder";
import { CHAT_SYSTEM_PROMPT } from "./prompts";
import { extractFollowUps } from "./follow-ups";

const HISTORY_TURNS = 16;

/* ───────────── Conversations ───────────── */

export async function listConversations(userId: string) {
  const { conversations } = await getCollections();
  return conversations.find({ userId }).sort({ updatedAt: -1 }).limit(200).toArray();
}

export async function createConversation(userId: string, opts: { title?: string; focusSymbol?: string | null } = {}) {
  const { conversations } = await getCollections();
  const now = new Date();
  const doc: ConversationDoc = {
    _id: new ObjectId(),
    userId,
    title: opts.title?.trim() || (opts.focusSymbol ? `About ${opts.focusSymbol}` : "New conversation"),
    focusSymbol: opts.focusSymbol ?? null,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };
  await conversations.insertOne(doc);
  return doc;
}

async function ownConversation(userId: string, id: string) {
  const { conversations } = await getCollections();
  const c = await conversations.findOne({ _id: new ObjectId(id), userId });
  if (!c) throw new NotFoundError("Conversation not found.");
  return c;
}

export async function getConversation(userId: string, id: string) {
  const conversation = await ownConversation(userId, id);
  const { messages } = await getCollections();
  const list = await messages.find({ conversationId: conversation._id }).sort({ timestamp: 1 }).toArray();
  return { conversation, messages: list };
}

export async function renameConversation(userId: string, id: string, title: string) {
  const { conversations } = await getCollections();
  const res = await conversations.findOneAndUpdate(
    { _id: new ObjectId(id), userId },
    { $set: { title: title.trim().slice(0, 120) } },
    { returnDocument: "after" },
  );
  if (!res) throw new NotFoundError("Conversation not found.");
  return res;
}

export async function deleteConversation(userId: string, id: string) {
  const conversation = await ownConversation(userId, id);
  const { conversations, messages } = await getCollections();
  await messages.deleteMany({ conversationId: conversation._id, userId });
  await conversations.deleteOne({ _id: conversation._id, userId });
}

/* ───────────── Streaming replies ───────────── */

/** Providers expect the history to start with a user turn and alternate roles. */
export function normalizeTurns(turns: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const t of turns) {
    if (out.length === 0 && t.role !== "user") continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === t.role) prev.content = `${prev.content}\n\n${t.content}`;
    else out.push({ ...t });
  }
  return out;
}

export type StreamEvent =
  | { type: "meta"; provider: string; model: string; userMessageId: string; context: MessageDoc["relevantContext"] }
  | { type: "delta"; text: string }
  | { type: "done"; message: { _id: string; content: string; followUps: string[]; provider: string; model: string; timestamp: string } }
  | { type: "error"; code: string; message: string; retryable: boolean };

/**
 * Persists the user's message (or reuses the last unanswered one for a retry), streams the
 * provider's answer as NDJSON events and saves the assistant reply only when it completed.
 * Errors are reported to the client; nothing is fabricated and the provider is never switched.
 */
export async function streamReply(
  userId: string,
  conversationId: string,
  input: { content?: string; retry?: boolean },
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const conversation = await ownConversation(userId, conversationId);
  const { messages, conversations } = await getCollections();

  const history = await messages
    .find({ conversationId: conversation._id })
    .sort({ timestamp: -1 })
    .limit(HISTORY_TURNS + 1)
    .toArray();
  history.reverse();

  let userMessage: MessageDoc;
  if (input.retry) {
    const last = history[history.length - 1];
    if (!last || last.role !== "user") throw new AppError("CONFLICT", "There is no unanswered message to retry.");
    userMessage = last;
    history.pop();
  } else {
    const content = (input.content ?? "").trim();
    if (!content) throw new AppError("VALIDATION", "Message is empty.");
    // An earlier unanswered message stays in history; the new question supersedes it.
    userMessage = {
      _id: new ObjectId(),
      userId,
      conversationId: conversation._id,
      role: "user",
      content,
      timestamp: new Date(),
    };
    await messages.insertOne(userMessage);
    const isFirst = conversation.messageCount === 0;
    await conversations.updateOne(
      { _id: conversation._id },
      {
        $set: {
          updatedAt: new Date(),
          ...(isFirst && conversation.title.startsWith("New conversation") ? { title: content.slice(0, 70) } : {}),
        },
        $inc: { messageCount: 1 },
      },
    );
  }

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController<Uint8Array>, e: StreamEvent) =>
    controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const provider = getAIProvider();
        const recentText = history.slice(-4).map((m) => m.content).join("\n");
        const context = await buildChatContext(userId, userMessage.content, {
          focusSymbol: conversation.focusSymbol,
          recentText,
        });

        await messages.updateOne({ _id: userMessage._id }, { $set: { relevantContext: context.summary } });
        send(controller, {
          type: "meta",
          provider: provider.name,
          model: provider.model,
          userMessageId: userMessage._id.toString(),
          context: context.summary,
        });

        const turns: ChatTurn[] = history
          .filter((m) => m._id.toString() !== userMessage._id.toString())
          .map((m) => ({ role: m.role, content: m.content }));
        turns.push({ role: "user", content: `${context.text}\n\n---\nUSER QUESTION:\n${userMessage.content}` });

        let full = "";
        for await (const delta of provider.stream({ system: CHAT_SYSTEM_PROMPT, messages: normalizeTurns(turns), signal })) {
          full += delta;
          send(controller, { type: "delta", text: delta });
        }
        if (!full.trim()) {
          throw new AIProviderError("unknown", provider.name, "The AI provider returned an empty response. Retry the request.");
        }

        const { content, followUps } = extractFollowUps(full);
        const assistant: MessageDoc = {
          _id: new ObjectId(),
          userId,
          conversationId: conversation._id,
          role: "assistant",
          content,
          provider: provider.name,
          model: provider.model,
          timestamp: new Date(),
          followUps,
          relevantContext: context.summary,
          regenerated: input.retry ? true : undefined,
        };
        await messages.insertOne(assistant);
        await conversations.updateOne(
          { _id: conversation._id },
          { $set: { updatedAt: new Date() }, $inc: { messageCount: 1 } },
        );
        send(controller, {
          type: "done",
          message: {
            _id: assistant._id.toString(),
            content,
            followUps,
            provider: provider.name,
            model: provider.model,
            timestamp: assistant.timestamp.toISOString(),
          },
        });
      } catch (err) {
        if (signal.aborted) {
          logger.info("ai.chat.aborted_by_client");
        } else {
          if (!isAppError(err)) logger.error("ai.chat.failed", { error: err });
          send(controller, {
            type: "error",
            code: isAppError(err) ? err.code : "INTERNAL",
            message: isAppError(err) ? err.publicMessage : "The assistant failed to respond. Your message was saved — retry.",
            retryable: isAppError(err) ? err.retryable || err.code === "AI_UNAVAILABLE" : true,
          });
        }
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
}
