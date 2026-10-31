import "server-only";
import { aiEnv, type AIEnv } from "@/lib/env";
import { ConfigError } from "@/lib/errors";
import type { AIProvider } from "./types";
import { OpenAIProvider } from "./openai-provider";
import { GeminiProvider } from "./gemini-provider";

/**
 * Builds the provider selected by AI_PROVIDER. Model names always come from the environment;
 * nothing is hard-coded and there is no silent fallback to another provider.
 *
 * To add a provider: implement AIProvider in ./providers, add its env vars to src/lib/env.ts,
 * and register it in BUILDERS below.
 */
type Builder = (env: AIEnv) => AIProvider;

function requireVars(env: AIEnv, provider: string, keys: Array<keyof AIEnv>) {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) {
    throw new ConfigError(`AI provider "${provider}" is selected but not configured`, missing.map((k) => `${k} is required`));
  }
}

const BUILDERS: Record<AIEnv["AI_PROVIDER"], Builder> = {
  openai: (env) => {
    requireVars(env, "openai", ["OPENAI_API_KEY", "OPENAI_MODEL"]);
    return new OpenAIProvider({
      apiKey: env.OPENAI_API_KEY!,
      model: env.OPENAI_MODEL!,
      temperature: env.AI_TEMPERATURE,
      maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
      timeoutMs: env.AI_TIMEOUT_MS,
    });
  },
  gemini: (env) => {
    requireVars(env, "gemini", ["GEMINI_API_KEY", "GEMINI_MODEL"]);
    return new GeminiProvider({
      apiKey: env.GEMINI_API_KEY!,
      model: env.GEMINI_MODEL!,
      temperature: env.AI_TEMPERATURE,
      maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
      timeoutMs: env.AI_TIMEOUT_MS,
    });
  },
};

const cache = new Map<string, AIProvider>();

export function getAIProvider(): AIProvider {
  const env = aiEnv();
  const model = env.AI_PROVIDER === "openai" ? env.OPENAI_MODEL : env.GEMINI_MODEL;
  const temperature = env.AI_TEMPERATURE ?? "default";
  // Re-validated on every call; a changed provider or model produces a new instance.
  const key = `${env.AI_PROVIDER}:${model}:${temperature}:${env.AI_MAX_OUTPUT_TOKENS}:${env.AI_TIMEOUT_MS}`;
  let provider = cache.get(key);
  if (!provider) {
    provider = BUILDERS[env.AI_PROVIDER](env);
    cache.clear();
    cache.set(key, provider);
  }
  return provider;
}

export interface AIStatus {
  configured: boolean;
  provider: string | null;
  model: string | null;
  problems: string[];
}

/** Safe status for the settings page — never includes keys. */
export function getAIStatus(): AIStatus {
  try {
    const p = getAIProvider();
    return { configured: true, provider: p.name, model: p.model, problems: [] };
  } catch (err) {
    let provider: string | null = null;
    try {
      provider = process.env.AI_PROVIDER ?? null;
    } catch {
      /* ignore */
    }
    return {
      configured: false,
      provider,
      model: null,
      problems: err instanceof ConfigError ? err.problems : ["AI provider configuration could not be read."],
    };
  }
}
