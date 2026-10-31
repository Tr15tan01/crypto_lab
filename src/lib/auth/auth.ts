import "server-only";
import NextAuth, { CredentialsSignin, type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { authEnv } from "@/lib/env";
import { getCollections } from "@/lib/mongodb/collections";
import { RATE_LIMITS, clientIp, consumeRateLimit } from "@/lib/security/rate-limit";
import { logger } from "@/lib/logger";

/**
 * Single-administrator authentication.
 *
 * - No registration, no adapter, no user-created accounts. The only identity that can sign in
 *   is the administrator configured in environment variables.
 * - Credentials: email + bcrypt-hashed password from ADMIN_EMAIL / ADMIN_PASSWORD_HASH.
 * - Google (optional): only when GOOGLE_AUTH_ENABLED=true, and only for GOOGLE_ALLOWED_EMAIL.
 *   Whichever method is used, the session belongs to the same administrator record.
 */

class RateLimitedSignin extends CredentialsSignin {
  code = "rate_limited";
}

class UnavailableSignin extends CredentialsSignin {
  code = "unavailable";
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(256),
});

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab); // keep timing similar
    return false;
  }
  return timingSafeEqual(ab, bb);
}

async function upsertAdminUser(method: "credentials" | "google") {
  const { ADMIN_EMAIL } = authEnv();
  const { users } = await getCollections();
  const now = new Date();
  const user = await users.findOneAndUpdate(
    { email: ADMIN_EMAIL },
    {
      $set: { lastLoginAt: now, lastLoginMethod: method },
      $setOnInsert: { email: ADMIN_EMAIL, role: "admin" as const, createdAt: now },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (!user) throw new Error("Failed to load administrator record");
  return user;
}

function buildConfig(): NextAuthConfig {
  const env = authEnv();

  const providers: NextAuthConfig["providers"] = [
    Credentials({
      id: "credentials",
      name: "Email and password",
      credentials: { email: { label: "Email", type: "email" }, password: { label: "Password", type: "password" } },
      async authorize(raw, request) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;

        const ip = clientIp(request.headers);
        const [byIp, byAccount] = await Promise.all([
          consumeRateLimit(RATE_LIMITS.login, ip),
          consumeRateLimit(RATE_LIMITS.loginAccount, "admin"),
        ]);
        if (byIp.unavailable || byAccount.unavailable) {
          // Fail closed: without the limiter, brute-force protection cannot be guaranteed.
          throw new UnavailableSignin();
        }
        if (!byIp.allowed || !byAccount.allowed) {
          logger.warn("auth.login_rate_limited", { ip });
          throw new RateLimitedSignin();
        }

        // Always run bcrypt so a wrong email takes as long as a wrong password.
        const passwordOk = await bcrypt.compare(parsed.data.password, env.ADMIN_PASSWORD_HASH);
        const emailOk = safeEqual(parsed.data.email, env.ADMIN_EMAIL);
        if (!passwordOk || !emailOk) {
          logger.warn("auth.login_failed", { ip });
          return null;
        }

        const user = await upsertAdminUser("credentials");
        logger.info("auth.login_succeeded", { method: "credentials" });
        return { id: user._id.toString(), email: user.email };
      },
    }),
  ];

  if (env.GOOGLE_AUTH_ENABLED && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.push(
      Google({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        authorization: { params: { prompt: "select_account" } },
      }),
    );
  }

  return {
    providers,
    trustHost: true,
    session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60, updateAge: 12 * 60 * 60 },
    pages: { signIn: "/login", error: "/login" },
    callbacks: {
      async signIn({ account, profile }) {
        if (account?.provider === "credentials") return true;
        if (account?.provider === "google") {
          const allowed = env.GOOGLE_ALLOWED_EMAIL?.toLowerCase();
          const email = typeof profile?.email === "string" ? profile.email.toLowerCase() : "";
          const verified = profile?.email_verified === true;
          if (allowed && verified && safeEqual(email, allowed)) return true;
          logger.warn("auth.google_rejected", { reason: verified ? "email_not_allowed" : "email_not_verified" });
          return false;
        }
        return false;
      },
      async jwt({ token, user, account }) {
        if (account && user) {
          if (account.provider === "google") {
            const admin = await upsertAdminUser("google");
            token.uid = admin._id.toString();
            token.email = admin.email;
            logger.info("auth.login_succeeded", { method: "google" });
          } else {
            token.uid = user.id;
            token.email = user.email;
          }
        }
        return token;
      },
      async session({ session, token }) {
        if (typeof token.uid === "string") session.user.id = token.uid;
        if (typeof token.email === "string") session.user.email = token.email;
        return session;
      },
    },
    logger: {
      error(error) {
        // Auth.js reports wrong passwords as errors; keep logs free of anything sensitive.
        logger.warn("auth.error", { name: error.name });
      },
      warn(code) {
        logger.warn("auth.warn", { code });
      },
      debug() {},
    },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => buildConfig());

export function googleAuthEnabled(): boolean {
  try {
    const env = authEnv();
    return Boolean(env.GOOGLE_AUTH_ENABLED && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  } catch {
    return false;
  }
}
