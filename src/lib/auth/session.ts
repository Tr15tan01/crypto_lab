import "server-only";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { authEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";

/**
 * Data Access Layer for authentication. Every page, server action and route handler calls
 * one of these. The proxy only performs an optimistic cookie check, so these functions are the
 * real security boundary.
 */
export interface SessionUser {
  id: string;
  email: string;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  const email = session?.user?.email?.toLowerCase();
  if (!id || !email) return null;
  // If the administrator email was changed in the environment, old sessions stop working.
  if (email !== authEnv().ADMIN_EMAIL) return null;
  return { id, email };
}

/** For Server Components and Server Actions: redirects to /login when not signed in. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** For Route Handlers: throws a 401 AppError when not signed in. */
export async function requireApiUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AppError("UNAUTHORIZED", "You need to sign in.");
  return user;
}
