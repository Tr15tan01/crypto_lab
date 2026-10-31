"use client";

import { useActionState } from "react";
import { LogIn } from "lucide-react";
import { loginAction, type LoginState } from "./actions";
import { Button, Field, Input, Notice } from "@/components/ui/primitives";

export function LoginForm({ callbackUrl, initialError }: { callbackUrl?: string; initialError?: string | null }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, { error: initialError ?? null });

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="callbackUrl" value={callbackUrl ?? ""} />
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus className="h-9" />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-9"
        />
      </Field>
      {state.error ? <Notice tone="down">{state.error}</Notice> : null}
      <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={pending}>
        {!pending ? <LogIn className="size-4" /> : null}
        Sign in
      </Button>
    </form>
  );
}
