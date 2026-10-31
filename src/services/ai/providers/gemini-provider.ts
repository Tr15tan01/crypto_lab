import "server-only";
import { ApiError, GoogleGenAI } from "@google/genai";
import { logger } from "@/lib/logger";
import { AIProviderError, AI_ERROR_MESSAGES, collect, type AIErrorKind, type AIProvider, type GenerateRequest } from "./types";

export interface GeminiProviderConfig {
  apiKey: string;
  model: string;
  temperature?: number;
  maxOutputTokens: number;
  timeoutMs: number;
}

function classify(err: unknown): AIErrorKind {
  if ((err as Error)?.name === "AbortError") return "aborted";
  if (err instanceof ApiError) {
    if (err.status === 429) return "rate_limit";
    if (err.status === 401 || err.status === 403) return "auth";
    if (err.status === 400 || err.status === 404) return "bad_request";
    if (err.status === 408 || err.status === 504) return "timeout";
    if (err.status >= 500) return "unavailable";
  }
  if (err instanceof TypeError) return "unavailable"; // network failure
  return "unknown";
}

/** Google Gemini via the official @google/genai SDK (streaming). */
export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  readonly model: string;
  private readonly client: GoogleGenAI;

  constructor(private readonly config: GeminiProviderConfig) {
    this.model = config.model;
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
  }

  async *stream(req: GenerateRequest): AsyncIterable<string> {
    // Combine the caller's signal with a timeout.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timeout")), this.config.timeoutMs);
    const onAbort = () => controller.abort(req.signal?.reason);
    req.signal?.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    controller.signal.addEventListener("abort", () => {
      if (!req.signal?.aborted) timedOut = true;
    });

    try {
      const stream = await this.client.models.generateContentStream({
        model: this.model,
        contents: req.messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        config: {
          systemInstruction: req.system,
          maxOutputTokens: req.maxOutputTokens ?? this.config.maxOutputTokens,
          ...(this.config.temperature !== undefined ? { temperature: this.config.temperature } : {}),
          abortSignal: controller.signal,
        },
      });
      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) yield text;
      }
    } catch (err) {
      const kind = timedOut ? "timeout" : classify(err);
      logger.warn("ai.gemini.error", { kind, status: err instanceof ApiError ? err.status : undefined });
      throw new AIProviderError(kind, this.name, AI_ERROR_MESSAGES[kind]("Gemini"), err);
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener("abort", onAbort);
    }
  }

  generate(req: GenerateRequest): Promise<string> {
    return collect(this.stream(req));
  }
}
