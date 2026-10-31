import { AppError } from "@/lib/errors";

/**
 * Provider-neutral AI interface. Business logic only ever talks to `AIProvider`;
 * provider SDKs are confined to their own files under ./providers.
 */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateRequest {
  system: string;
  messages: ChatTurn[];
  signal?: AbortSignal;
  /** Overrides AI_MAX_OUTPUT_TOKENS for this call. */
  maxOutputTokens?: number;
}

export interface AIProvider {
  /** "openai" | "gemini" — stored with every message and report. */
  readonly name: string;
  /** Model identifier from the environment, stored with every message and report. */
  readonly model: string;
  /** Streams text deltas. Throws AIProviderError subclasses on failure. */
  stream(req: GenerateRequest): AsyncIterable<string>;
  /** Convenience: collects the full streamed response. */
  generate(req: GenerateRequest): Promise<string>;
}

export type AIErrorKind = "rate_limit" | "timeout" | "auth" | "bad_request" | "unavailable" | "aborted" | "unknown";

export class AIProviderError extends AppError {
  constructor(
    readonly kind: AIErrorKind,
    readonly provider: string,
    message: string,
    cause?: unknown,
  ) {
    super(
      kind === "rate_limit" ? "RATE_LIMITED" : "AI_UNAVAILABLE",
      message,
      { cause, retryable: kind === "rate_limit" || kind === "timeout" || kind === "unavailable" },
    );
    this.name = "AIProviderError";
  }
}

export const AI_ERROR_MESSAGES: Record<AIErrorKind, (provider: string) => string> = {
  rate_limit: (p) => `The ${p} API is rate-limiting requests. Wait a moment and retry.`,
  timeout: (p) => `The ${p} API did not respond in time. Retry the request.`,
  auth: (p) => `The ${p} API rejected the credentials. Check the API key on the server.`,
  bad_request: (p) => `The ${p} API rejected the request. Check the configured model name.`,
  unavailable: (p) => `The ${p} API is temporarily unavailable. Retry shortly.`,
  aborted: () => "The request was cancelled.",
  unknown: (p) => `The ${p} API returned an unexpected error. Retry the request.`,
};

export async function collect(stream: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const chunk of stream) out += chunk;
  return out;
}
