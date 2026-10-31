"use server";

import { AuthError } from "next-auth";
import { z } from "zod";
import { signIn } from "@/lib/auth/auth";
import { ConfigError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export interface LoginState {
  error: string | null;
}

const schema = z.object({
  email: z.string().trim().min(1, "Enter your email").max(254),
  password: z.string().min(1, "Enter your password").max(256),
  callbackUrl: z.string().optional(),
});

function safeCallback(url: string | undefined): string {
  // Only allow same-site relative paths to prevent open redirects.
  if (!url || !url.startsWith("/") || url.startsWith("//") || url.startsWith("/\\")) return "/dashboard";
  return url;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    callbackUrl: formData.get("callbackUrl") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: safeCallback(parsed.data.callbackUrl),
    });
    return { error: null };
  } catch (err) {
    if (err instanceof AuthError) {
      if ((err as AuthError & { code?: string }).code === "rate_limited") {
        return { error: "Too many sign-in attempts. Wait a few minutes and try again." };
      }
      if ((err as AuthError & { code?: string }).code === "unavailable") {
        return { error: "Sign-in is temporarily unavailable because the database cannot be reached. Try again shortly." };
      }
      if (err.type === "CredentialsSignin") return { error: "Incorrect email or password." };
      if (err.cause?.err instanceof ConfigError) {
        logger.error("auth.config_error", { problems: (err.cause.err as ConfigError).problems });
        return { error: "Sign-in is not configured correctly on the server. Check the environment variables." };
      }
      return { error: "Sign-in failed. Please try again." };
    }
    if (err instanceof ConfigError) {
      logger.error("auth.config_error", { problems: err.problems });
      return { error: "Sign-in is not configured correctly on the server. Check the environment variables." };
    }
    throw err; // NEXT_REDIRECT on success must propagate
  }
}

export async function googleLoginAction(formData: FormData) {
  const callbackUrl = safeCallback((formData.get("callbackUrl") as string | null) ?? undefined);
  await signIn("google", { redirectTo: callbackUrl });
}
