import "server-only";
import OpenAI from "openai";
import { logger } from "@/lib/logger";
import { AIProviderError, AI_ERROR_MESSAGES, collect, type AIErrorKind, type AIProvider, type GenerateRequest } from "./types";

export interface OpenAIProviderConfig {
  apiKey: string;
  model: string;
  temperature?: number;
  maxOutputTokens: number;
  timeoutMs: number;
}

function classify(err: unknown): AIErrorKind {
  if (err instanceof OpenAI.APIUserAbortError) return "aborted";
  if (err instanceof OpenAI.APIConnectionTimeoutError) return "timeout";
  if (err instanceof OpenAI.RateLimitError) return "rate_limit";
  if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError) return "auth";
  if (err instanceof OpenAI.BadRequestError || err instanceof OpenAI.NotFoundError) return "bad_request";
  if (err instanceof OpenAI.InternalServerError || err instanceof OpenAI.APIConnectionError) return "unavailable";
  if ((err as Error)?.name === "AbortError") return "aborted";
  return "unknown";
}

function rejectsTemperature(err: unknown): boolean {
  return err instanceof OpenAI.BadRequestError && /temperature/i.test(err.message);
}

/** OpenAI via the Responses API (streaming). */
export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  readonly model: string;
  private readonly client: OpenAI;
  private sendTemperature: boolean;

  constructor(private readonly config: OpenAIProviderConfig) {
    this.model = config.model;
    this.client = new OpenAI({ apiKey: config.apiKey, timeout: config.timeoutMs, maxRetries: 1 });
    this.sendTemperature = config.temperature !== undefined;
  }

  async *stream(req: GenerateRequest): AsyncIterable<string> {
    let stream;
    try {
      stream = await this.open(req);
    } catch (err) {
      // Some reasoning models reject `temperature`; retry once without it and remember.
      if (this.sendTemperature && rejectsTemperature(err)) {
        logger.warn("ai.openai.temperature_unsupported", { model: this.model });
        this.sendTemperature = false;
        try {
          stream = await this.open(req);
        } catch (err2) {
          throw this.wrap(err2);
        }
      } else {
        throw this.wrap(err);
      }
    }

    try {
      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          yield event.delta;
        } else if (event.type === "response.failed") {
          throw new AIProviderError("unavailable", this.name, AI_ERROR_MESSAGES.unavailable("OpenAI"));
        } else if (event.type === "error") {
          throw new AIProviderError("unknown", this.name, AI_ERROR_MESSAGES.unknown("OpenAI"));
        }
      }
    } catch (err) {
      if (err instanceof AIProviderError) throw err;
      throw this.wrap(err);
    }
  }

  generate(req: GenerateRequest): Promise<string> {
    return collect(this.stream(req));
  }

  private open(req: GenerateRequest) {
    return this.client.responses.create(
      {
        model: this.model,
        instructions: req.system,
        input: req.messages.map((m) => ({ role: m.role, content: m.content })),
        max_output_tokens: req.maxOutputTokens ?? this.config.maxOutputTokens,
        ...(this.sendTemperature ? { temperature: this.config.temperature } : {}),
        store: false,
        stream: true,
      },
      { signal: req.signal },
    );
  }

  private wrap(err: unknown): AIProviderError {
    const kind = classify(err);
    logger.warn("ai.openai.error", { kind, status: (err as { status?: number })?.status });
    return new AIProviderError(kind, this.name, AI_ERROR_MESSAGES[kind]("OpenAI"), err);
  }
}
