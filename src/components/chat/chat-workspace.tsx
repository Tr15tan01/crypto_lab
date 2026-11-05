"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, FileText, Gauge, MessageSquarePlus, Pencil, RotateCcw, Send, Square, Trash2, X } from "lucide-react";
import { apiFetch, ApiClientError } from "@/lib/client/api";
import { Badge, Button, EmptyState, Input, Notice, Spinner } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/radix";
import { Markdown } from "./markdown";
import { VerdictCard, type Prediction } from "./verdict-card";
import { TrackRecord } from "./track-record";
import { cn, formatDateTime, formatRelative } from "@/lib/utils/format";

interface Conversation {
  _id: string;
  title: string;
  focusSymbol?: string | null;
  updatedAt: string;
  messageCount: number;
}

interface ContextSummary {
  symbols: string[];
  included: string[];
  dataTimestamp: string | null;
}

interface Message {
  _id: string;
  role: "user" | "assistant";
  content: string;
  provider?: string;
  model?: string;
  timestamp: string;
  followUps?: string[];
  relevantContext?: ContextSummary;
}

type StreamEvent =
  | { type: "meta"; provider: string; model: string; userMessageId: string; context: ContextSummary }
  | { type: "delta"; text: string }
  | {
      type: "done";
      message: { _id: string; content: string; followUps: string[]; provider: string; model: string; timestamp: string };
      predictions: Prediction[];
    }
  | { type: "error"; code: string; message: string; retryable: boolean };

const STARTERS = [
  "Will Bitcoin go up this week?",
  "Is SOL a good buy right now?",
  "Give me a 30-day verdict on Ethereum.",
  "Compare SOL and ETH — which has the better setup?",
  "Analyze my current holdings — what should I trim or add?",
  "What would happen to my portfolio if Bitcoin dropped 20%?",
];

const HORIZONS = [
  { value: "24h", label: "24h", phrase: "the next 24 hours" },
  { value: "7d", label: "7 days", phrase: "the next 7 days" },
  { value: "30d", label: "30 days", phrase: "the next 30 days" },
] as const;

function verdictPrompt(coin: string, phrase: string) {
  return `Give me your verdict on ${coin} for ${phrase}: is it likely to go up or down, how confident are you, and what are the entry, target and stop levels?`;
}

/** Hides the machine-readable trailer lines while a reply is still streaming. */
function visibleStreamingText(text: string) {
  const cut = ["OUTLOOK_JSON:", "FOLLOW_UPS:"].map((m) => text.indexOf(m)).filter((i) => i >= 0);
  return cut.length ? text.slice(0, Math.min(...cut)) : text;
}

function ContextChip({ ctx, provider, model }: { ctx?: ContextSummary; provider?: string; model?: string }) {
  if (!ctx && !provider) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[0.65625rem] text-faint">
      {provider ? <span>{provider} · {model}</span> : null}
      {ctx?.dataTimestamp ? <span>· market data {formatDateTime(ctx.dataTimestamp)}</span> : null}
      {ctx?.included.length ? (
        <Tooltip content={<span>Shared with the AI provider for this answer: {ctx.included.join(", ")}.</span>}>
          <span className="cursor-help underline decoration-dotted underline-offset-2">· context: {ctx.included.length} source{ctx.included.length === 1 ? "" : "s"}</span>
        </Tooltip>
      ) : null}
    </div>
  );
}

export function ChatWorkspace({ aiConfigured, aiProblem }: { aiConfigured: boolean; aiProblem: string | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const activeId = params.get("c");

  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  // Thread state is tagged with its conversation id, so switching conversations never shows stale content.
  const [thread, setThread] = useState<{ id: string | null; messages: Message[]; focus: string | null; predictions: Prediction[] }>({
    id: null,
    messages: [],
    focus: null,
    predictions: [],
  });
  const [trackKey, setTrackKey] = useState(0);
  const [verdictCoin, setVerdictCoin] = useState("");
  // Set when the first message creates a conversation, until the URL catches up.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<{
    id: string;
    text: string;
    meta?: { provider: string; model: string; context: ContextSummary };
  } | null>(null);
  const [error, setError] = useState<{ id: string | null; message: string; retryable: boolean } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const streamingFor = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const viewId = activeId ?? pendingId;
  const current = thread.id === viewId ? thread : null;
  const messages = useMemo(() => current?.messages ?? [], [current]);
  const focus = current?.focus ?? null;
  const predictionsByMessage = useMemo(() => {
    const map = new Map<string, Prediction[]>();
    for (const p of current?.predictions ?? []) if (p.messageId) map.set(p.messageId, [...(map.get(p.messageId) ?? []), p]);
    return map;
  }, [current]);
  const loadingConv = viewId !== null && current === null;
  const live = streaming && streaming.id === viewId ? streaming : null;
  const shownError = error && error.id === viewId ? error : null;

  const loadList = useCallback(() => {
    apiFetch<Conversation[]>("/api/ai/conversations")
      .then((list) => {
        setConversations(list);
        setListError(null);
      })
      .catch((err) => setListError(err instanceof ApiClientError ? err.message : "Could not load conversations."));
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    // Leaving a conversation stops its in-flight answer (the question stays saved for a retry).
    if (streamingFor.current && streamingFor.current !== activeId) abortRef.current?.abort();
    if (!activeId) return;
    let cancelled = false;
    apiFetch<{ conversation: Conversation; messages: Message[]; predictions: Prediction[] }>(`/api/ai/conversations/${activeId}`)
      .then((d) => {
        if (cancelled) return;
        setThread((prev) =>
          prev.id === activeId
            ? prev
            : { id: activeId, messages: d.messages, focus: d.conversation.focusSymbol ?? null, predictions: d.predictions },
        );
        const last = d.messages[d.messages.length - 1];
        if (last?.role === "user" && streamingFor.current !== activeId) {
          setError({ id: activeId, message: "This question has no answer yet.", retryable: true });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setThread({ id: activeId, messages: [], focus: null, predictions: [] });
        setError({ id: activeId, message: err instanceof ApiClientError ? err.message : "Could not load conversation.", retryable: false });
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, live?.text]);

  const select = (id: string | null) => {
    setPendingId(null);
    router.push(id ? `/research?c=${id}` : "/research");
  };

  const send = async (opts: { content?: string; retry?: boolean }) => {
    let conversationId = viewId;
    setError(null);
    if (!conversationId) {
      try {
        const c = await apiFetch<Conversation>("/api/ai/conversations", { method: "POST", json: {} });
        conversationId = c._id;
        setThread({ id: c._id, messages: [], focus: null, predictions: [] });
        setPendingId(c._id);
        setConversations((prev) => [c, ...(prev ?? [])]);
        router.replace(`/research?c=${c._id}`);
      } catch (err) {
        setError({ id: null, message: err instanceof ApiClientError ? err.message : "Could not start a conversation.", retryable: false });
        return;
      }
    }
    const id = conversationId;
    const update = (fn: (m: Message[]) => Message[]) =>
      setThread((t) => (t.id === id ? { ...t, messages: fn(t.messages) } : t));

    if (opts.content) {
      const content = opts.content;
      update((m) => [...m, { _id: `local-${Date.now()}`, role: "user", content, timestamp: new Date().toISOString() }]);
      setInput("");
    }
    const controller = new AbortController();
    abortRef.current = controller;
    streamingFor.current = id;
    setStreaming({ id, text: "" });

    try {
      const res = await fetch(`/api/ai/conversations/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string; retryable?: boolean } };
        throw new ApiClientError(payload.error?.message ?? `Request failed (${res.status}).`, "HTTP", res.status, undefined, payload.error?.retryable ?? true);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as StreamEvent;
          if (ev.type === "meta") {
            setStreaming((s) => ({ id, text: s?.text ?? "", meta: { provider: ev.provider, model: ev.model, context: ev.context } }));
            update((m) => m.map((x) => (x._id.startsWith("local-") ? { ...x, _id: ev.userMessageId, relevantContext: ev.context } : x)));
          } else if (ev.type === "delta") {
            text += ev.text;
            setStreaming((s) => ({ ...(s ?? { id }), id, text }));
          } else if (ev.type === "done") {
            finished = true;
            update((m) => [...m, { ...ev.message, role: "assistant" }]);
            if (ev.predictions.length) {
              setThread((t) => (t.id === id ? { ...t, predictions: [...t.predictions, ...ev.predictions] } : t));
              setTrackKey((k) => k + 1);
            }
            setStreaming(null);
          } else if (ev.type === "error") {
            finished = true;
            setStreaming(null);
            setError({ id, message: ev.message, retryable: ev.retryable });
          }
        }
      }
      if (!finished) {
        setStreaming(null);
        setError({ id, message: "The response was interrupted. Your question was saved — retry to get an answer.", retryable: true });
      }
      loadList();
    } catch (err) {
      setStreaming(null);
      if (controller.signal.aborted) {
        setError({ id, message: "Stopped. Retry to generate an answer.", retryable: true });
      } else {
        setError({ id, message: err instanceof ApiClientError ? err.message : "Could not reach the server.", retryable: true });
      }
    } finally {
      if (streamingFor.current === id) streamingFor.current = null;
    }
  };

  const rename = async (id: string) => {
    const title = renameValue.trim();
    setRenaming(null);
    if (!title) return;
    try {
      await apiFetch(`/api/ai/conversations/${id}`, { method: "PATCH", json: { title } });
      loadList();
    } catch {
      setListError("Could not rename the conversation.");
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this conversation and its messages? This cannot be undone. AI calls made in it stay in the track record.")) return;
    try {
      await apiFetch(`/api/ai/conversations/${id}`, { method: "DELETE" });
      if (id === viewId) select(null);
      loadList();
    } catch {
      setListError("Could not delete the conversation.");
    }
  };

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const busy = live !== null;

  return (
    <div className="grid min-h-[calc(100vh-170px)] gap-4 lg:grid-cols-[260px_1fr]">
      {/* Conversations */}
      <aside className="flex max-h-[calc(100vh-170px)] flex-col rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border p-2">
          <Button size="sm" variant="primary" className="w-full justify-center" onClick={() => select(null)}>
            <MessageSquarePlus className="size-3.5" /> New conversation
          </Button>
        </div>
        <Link href="/research/reports" className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted hover:text-fg">
          <FileText className="size-3.5" /> Analysis reports
        </Link>
        <TrackRecord refreshKey={trackKey} />
        <div className="flex-1 overflow-y-auto p-1.5">
          {listError ? <Notice tone="down" className="m-1">{listError}</Notice> : null}
          {conversations === null && listError ? null : conversations === null ? (
            <div className="flex justify-center py-6"><Spinner className="size-4 text-muted" /></div>
          ) : !conversations || conversations.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-faint">No conversations yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {conversations.map((c) => (
                <li key={c._id}>
                  {renaming === c._id ? (
                    <form
                      className="flex items-center gap-1 p-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void rename(c._id);
                      }}
                    >
                      <Input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} maxLength={120} className="h-7 text-xs" aria-label="Conversation title" />
                      <button type="submit" className="p-1 text-muted hover:text-fg" aria-label="Save title"><Check className="size-3.5" /></button>
                      <button type="button" onClick={() => setRenaming(null)} className="p-1 text-muted hover:text-fg" aria-label="Cancel"><X className="size-3.5" /></button>
                    </form>
                  ) : (
                    <div
                      className={cn(
                        "group flex items-center gap-1 rounded-md px-2 py-1.5 text-xs",
                        c._id === viewId ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                      )}
                    >
                      <button type="button" onClick={() => select(c._id)} className="min-w-0 flex-1 text-left">
                        <span className="block truncate">{c.title}</span>
                        <span className="block text-[0.625rem] text-faint">
                          {c.focusSymbol ? `${c.focusSymbol} · ` : ""}{formatRelative(c.updatedAt)}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRenaming(c._id);
                          setRenameValue(c.title);
                        }}
                        className="p-1 opacity-0 transition-opacity hover:text-fg group-hover:opacity-100 focus:opacity-100"
                        aria-label={`Rename ${c.title}`}
                      >
                        <Pencil className="size-3" />
                      </button>
                      <button type="button" onClick={() => void remove(c._id)} className="p-1 opacity-0 transition-opacity hover:text-down group-hover:opacity-100 focus:opacity-100" aria-label={`Delete ${c.title}`}>
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Thread */}
      <section className="flex max-h-[calc(100vh-170px)] min-h-[520px] flex-col rounded-lg border border-border bg-surface">
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <p className="text-xs text-muted">
            {focus ? (
              <>Focused on <Link href={`/crypto/${focus}`} className="text-fg hover:text-accent">{focus}</Link> — its data is included automatically</>
            ) : (
              "Ask about any Binance pair, your paper portfolio or your past decisions."
            )}
          </p>
          <Badge tone="warn">Not financial advice</Badge>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {!aiConfigured ? (
            <Notice tone="down" title="The AI provider is not configured" className="mb-4">
              {aiProblem ?? "Set AI_PROVIDER and the matching API key and model on the server."}
            </Notice>
          ) : null}

          {loadingConv ? (
            <div className="flex justify-center py-10"><Spinner className="size-5 text-muted" /></div>
          ) : messages.length === 0 && !busy ? (
            <EmptyState
              title="Research assistant"
              description="Ask about any coin and get a verdict: direction, probability, entry, target and stop, built from live Binance data, a quant scorecard and historical base rates. Every call is scored later so you can see how often it is right."
              action={
                <div className="mt-2 flex max-w-xl flex-wrap justify-center gap-2">
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={!aiConfigured}
                      onClick={() => void send({ content: s })}
                      className="rounded-full border border-border-strong px-3 py-1 text-xs text-muted transition-colors hover:border-accent/50 hover:text-fg disabled:opacity-40"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              }
            />
          ) : (
            <div className="mx-auto max-w-3xl space-y-5">
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m._id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-lg rounded-br-sm bg-surface-3 px-3.5 py-2 text-[0.84375rem] whitespace-pre-wrap">{m.content}</div>
                  </div>
                ) : (
                  <div key={m._id} className="animate-fade-in">
                    {predictionsByMessage.get(m._id)?.map((p) => <VerdictCard key={p._id} p={p} />)}
                    <Markdown>{m.content}</Markdown>
                    <ContextChip ctx={m.relevantContext} provider={m.provider} model={m.model} />
                  </div>
                ),
              )}
              {live ? (
                <div>
                  {live.text ? (
                    <Markdown>{visibleStreamingText(live.text)}</Markdown>
                  ) : (
                    <p className="flex items-center gap-2 text-xs text-muted">
                      <Spinner className="size-3.5" /> Gathering market data and your records…
                    </p>
                  )}
                  {live.meta ? <ContextChip ctx={live.meta.context} provider={live.meta.provider} model={live.meta.model} /> : null}
                </div>
              ) : null}
              {shownError ? (
                <Notice tone="down" title="No answer">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>{shownError.message}</span>
                    {shownError.retryable ? (
                      <Button size="sm" onClick={() => void send({ retry: true })} disabled={!aiConfigured}>
                        <RotateCcw className="size-3.5" /> Retry
                      </Button>
                    ) : null}
                  </div>
                </Notice>
              ) : null}
              {!busy && !shownError && lastAssistant?.followUps?.length && messages[messages.length - 1]?.role === "assistant" ? (
                <div className="flex flex-wrap gap-2">
                  {lastAssistant.followUps.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => void send({ content: f })}
                      className="rounded-full border border-border-strong px-3 py-1 text-xs text-muted transition-colors hover:border-accent/50 hover:text-fg"
                    >
                      {f}
                    </button>
                  ))}
                </div>
              ) : null}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <form
          className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 pt-2.5 text-[0.6875rem] text-muted"
          onSubmit={(e) => e.preventDefault()}
          aria-label="Quick verdict"
        >
          <Gauge className="size-3.5" aria-hidden />
          <span>Quick verdict on</span>
          <Input
            value={verdictCoin}
            onChange={(e) => setVerdictCoin(e.target.value.toUpperCase())}
            placeholder={focus?.replace(/USDT$/, "") ?? "SOL"}
            maxLength={20}
            aria-label="Coin for a quick verdict"
            className="h-6 w-20 px-1.5 text-[0.6875rem] uppercase"
          />
          {HORIZONS.map((h) => {
            const coin = verdictCoin.trim() || focus?.replace(/USDT$/, "") || "";
            return (
              <button
                key={h.value}
                type="button"
                disabled={!coin || busy || !aiConfigured}
                onClick={() => {
                  void send({ content: verdictPrompt(coin, h.phrase) });
                  setVerdictCoin("");
                }}
                className="rounded-full border border-border-strong px-2.5 py-0.5 transition-colors hover:border-accent/50 hover:text-fg disabled:opacity-40"
              >
                {h.label}
              </button>
            );
          })}
        </form>
        <form
          className="p-3 pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim() && !busy) void send({ content: input.trim() });
          }}
        >
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (input.trim() && !busy) void send({ content: input.trim() });
                }
              }}
              rows={2}
              maxLength={4000}
              placeholder={focus ? `Ask about ${focus}…` : "Ask a research question…"}
              aria-label="Message"
              disabled={!aiConfigured}
              className="max-h-40 min-h-11 flex-1 resize-y rounded-md border border-border-strong bg-bg px-3 py-2 text-[0.84375rem] placeholder:text-faint focus:border-accent/60 focus:outline-none disabled:opacity-50"
            />
            {busy ? (
              <Button variant="secondary" size="lg" onClick={() => abortRef.current?.abort()} aria-label="Stop generating">
                <Square className="size-3.5" />
              </Button>
            ) : (
              <Button type="submit" variant="primary" size="lg" disabled={!input.trim() || !aiConfigured} aria-label="Send">
                <Send className="size-4" />
              </Button>
            )}
          </div>
          <p className="mt-1.5 text-[0.65625rem] text-faint">Enter to send · Shift+Enter for a new line · Only the data relevant to your question is shared with the AI provider.</p>
        </form>
      </section>
    </div>
  );
}
