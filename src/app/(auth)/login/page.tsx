import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { LoginForm } from "./login-form";
import { googleLoginAction } from "./actions";
import { getSessionUser } from "@/lib/auth/session";
import { googleAuthEnabled } from "@/lib/auth/auth";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  AccessDenied: "That Google account is not authorised to use this application.",
  Configuration: "Sign-in is not configured correctly on the server.",
  Verification: "The sign-in link is no longer valid.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const callbackUrl = typeof params.callbackUrl === "string" ? params.callbackUrl : undefined;
  const errorKey = typeof params.error === "string" ? params.error : undefined;

  let user = null;
  try {
    user = await getSessionUser();
  } catch {
    // Misconfiguration is reported on submit; still render the form.
  }
  if (user) redirect("/dashboard");

  const google = googleAuthEnabled();

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex size-10 items-center justify-center rounded-lg border border-accent/30 bg-accent/10">
            <FlaskConical className="size-5 text-accent" />
          </span>
          <h1 className="text-lg font-semibold tracking-tight">Crypto Lab</h1>
          <p className="mt-1 text-xs text-muted">Private research & paper-trading workspace</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-6">
          <LoginForm callbackUrl={callbackUrl} initialError={errorKey ? (ERRORS[errorKey] ?? "Sign-in failed.") : null} />
          {google ? (
            <>
              <div className="my-5 flex items-center gap-3 text-[0.6875rem] text-faint">
                <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
              </div>
              <form action={googleLoginAction}>
                <input type="hidden" name="callbackUrl" value={callbackUrl ?? ""} />
                <button
                  type="submit"
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border-strong bg-surface-3 text-sm transition-colors hover:bg-border-strong"
                >
                  <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
                    <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.6 2.3 2.3 6.6 2.3 12s4.3 9.7 9.7 9.7c5.6 0 9.3-3.9 9.3-9.5 0-.6-.1-1.1-.2-1.6H12z" />
                  </svg>
                  Continue with Google
                </button>
              </form>
            </>
          ) : null}
        </div>
        <p className="mt-6 text-center text-[0.6875rem] leading-relaxed text-faint">
          Single-user application. There is no registration — access is limited to the configured administrator.
        </p>
      </div>
    </main>
  );
}
