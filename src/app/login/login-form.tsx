"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { buttonClasses } from "@/components/ax/button";
import { StageBanner } from "@/components/ax/stage-banner";
import { PENDING_PROMPT_KEY } from "@/lib/auth-paths";
import { cn } from "@/lib/utils";
import { signInWithEmail, signInWithProvider, type EmailAuthState } from "@/server/actions/auth";

function ProviderButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" aria-disabled={pending || undefined} className={buttonClasses({ className: "w-full" })}>
      {pending ? "Opening…" : label}
    </button>
  );
}

function SubmitButton({ mode }: { mode: "sign_in" | "sign_up" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" aria-disabled={pending || undefined} className={buttonClasses({ variant: "primary", disabled: pending, className: "w-full" })}>
      {pending ? (mode === "sign_in" ? "Signing in…" : "Creating your account…") : mode === "sign_in" ? "Sign in" : "Create account"}
    </button>
  );
}

const inputClasses =
  "min-h-[38px] w-full rounded-full border border-line-ctl bg-surface px-4 text-body text-ink placeholder:text-ink-3 aria-[invalid=true]:border-failed";

export function LoginForm({ next, error }: { next: string; error?: string }) {
  const [mode, setMode] = useState<"sign_in" | "sign_up">("sign_in");
  const [state, action] = useActionState<EmailAuthState, FormData>(signInWithEmail, { status: "idle" });
  const [promptKept, setPromptKept] = useState(false);
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser-only storage after mount
      setPromptKept(Boolean(sessionStorage.getItem(PENDING_PROMPT_KEY)));
    } catch {
      // Storage can be blocked; the prompt just isn't restored.
    }
  }, []);

  if (state.status === "check_email") {
    return (
      <div role="status" className="flex flex-col gap-3">
        <h2 className="text-sub font-semibold">Check your email</h2>
        <p className="text-ink-2">
          We sent a link to <b className="text-ink">{state.email}</b>. Open it on this device to finish creating your account.
          {promptKept && " Your idea is kept and waits on Home."}
        </p>
      </div>
    );
  }

  const formError = state.status === "error" ? state : undefined;
  return (
    <div className="flex flex-col gap-5">
      {error && <StageBanner kind="error" title="You're not signed in yet">{error}</StageBanner>}
      {promptKept && (
        <p role="status" className="rounded-card bg-tray px-3.5 py-2.5 text-small text-ink-2">
          Your idea is kept. You&apos;ll see it on Home after you sign in.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <form action={signInWithProvider.bind(null, "google", next)}>
          <ProviderButton label="Continue with Google" />
        </form>
        <form action={signInWithProvider.bind(null, "github", next)}>
          <ProviderButton label="Continue with GitHub" />
        </form>
      </div>

      <div className="flex items-center gap-3 text-small text-ink-3" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        or with email
        <span className="h-px flex-1 bg-line" />
      </div>

      <form action={action} className="flex flex-col gap-3" noValidate>
        <input type="hidden" name="mode" value={mode} />
        <input type="hidden" name="next" value={next} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={emailId} className="font-semibold">
            Email
          </label>
          <input
            id={emailId}
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@company.com"
            aria-invalid={formError?.field === "email" || undefined}
            aria-describedby={formError ? errorId : undefined}
            className={inputClasses}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={passwordId} className="font-semibold">
            Password
          </label>
          <input
            id={passwordId}
            name="password"
            type="password"
            autoComplete={mode === "sign_in" ? "current-password" : "new-password"}
            required
            minLength={8}
            placeholder={mode === "sign_up" ? "At least 8 characters" : undefined}
            aria-invalid={formError?.field === "password" || undefined}
            aria-describedby={formError ? errorId : undefined}
            className={inputClasses}
          />
        </div>
        {formError && (
          <p id={errorId} role="alert" className="text-small font-semibold text-failed">
            {formError.message}
          </p>
        )}
        <SubmitButton mode={mode} />
      </form>

      <p className={cn("text-center text-small text-ink-2")}>
        {mode === "sign_in" ? "New to Architect? " : "Already have an account? "}
        <button
          type="button"
          onClick={() => setMode(mode === "sign_in" ? "sign_up" : "sign_in")}
          className="min-h-6 font-semibold text-ink underline decoration-line-ctl underline-offset-[3px]"
        >
          {mode === "sign_in" ? "Create an account" : "Sign in instead"}
        </button>
      </p>
    </div>
  );
}
