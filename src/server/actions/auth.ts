"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { safeNext } from "@/lib/auth-paths";
import { createAdminDb, createServerDb } from "../db";
import { origin } from "../origin";
import { ensureWorkspace } from "../workspace";

export type EmailAuthState =
  | { status: "idle" }
  | { status: "error"; message: string; field?: "email" | "password" }
  | { status: "check_email"; email: string };

function callbackUrl(base: string, next: string): string {
  return `${base}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;
}

/** Supabase's error → what happened and what to do, in plain words. Uses the error code when there is one. */
export async function friendlyAuthError(message: string, code?: string): Promise<string> {
  const m = message.toLowerCase();
  if (code === "over_email_send_rate_limit" || m.includes("email rate limit"))
    return "We couldn't send the confirmation email: this prototype's email limit is used up for now. Continue with GitHub instead, or try again in an hour.";
  if (m.includes("not authorized") && m.includes("email"))
    return "This prototype can't send email to that address yet. Continue with GitHub instead.";
  if (m.includes("invalid login credentials")) return "That email and password don't match. Try again, or create an account.";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "There's already an account with that email. Sign in instead.";
  if (m.includes("email not confirmed")) return "Confirm your email first. The link is in your inbox.";
  if (code === "over_request_rate_limit" || m.includes("rate limit") || m.includes("too many"))
    return "Too many tries in a row. Wait a minute, then try again.";
  if (m.includes("provider is not enabled") || m.includes("unsupported provider"))
    return "That sign-in option isn't turned on yet. Use another one, or ask your admin.";
  if (m.includes("password") && (m.includes("at least") || m.includes("weak")))
    return "Use a password of at least 8 characters.";
  if (m.includes("invalid") && m.includes("email")) return "That email address can't be used. Check it, or use another.";
  return "Sign-in didn't work. Try again, or use another sign-in option.";
}

const providerSchema = z.enum(["google", "github"]);

/** Google or GitHub: hands the browser to the provider, which returns to /auth/callback. */
export async function signInWithProvider(provider: "google" | "github", next: string) {
  const parsed = providerSchema.safeParse(provider);
  if (!parsed.success) redirect(`/login?error=${encodeURIComponent("Unknown sign-in option.")}`);
  const db = await createServerDb();
  const { data, error } = await db.auth.signInWithOAuth({
    provider: parsed.data,
    options: {
      redirectTo: callbackUrl(await origin(), next),
      // Always show Google's and GitHub's account chooser, even when one account is already signed in,
      // so people can pick which account to use (both providers support prompt=select_account).
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data.url) {
    redirect(`/login?error=${encodeURIComponent(await friendlyAuthError(error?.message ?? ""))}&next=${encodeURIComponent(safeNext(next))}`);
  }
  redirect(data.url);
}

const emailSchema = z.object({
  email: z.string().trim().email("Enter an email address like you@company.com."),
  password: z.string().min(8, "Use a password of at least 8 characters."),
  mode: z.enum(["sign_in", "sign_up"]),
  next: z.string().optional(),
});

/** Email and password, for signing in or creating an account. */
export async function signInWithEmail(_prev: EmailAuthState, form: FormData): Promise<EmailAuthState> {
  const parsed = emailSchema.safeParse({
    email: form.get("email"),
    password: form.get("password"),
    mode: form.get("mode"),
    next: form.get("next") ?? undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue.path[0] === "email" || issue.path[0] === "password" ? issue.path[0] : undefined;
    return { status: "error", message: issue.message, field };
  }
  const { email, password, mode } = parsed.data;
  const next = safeNext(parsed.data.next);
  const db = await createServerDb();

  if (mode === "sign_in") {
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error || !data.user) return { status: "error", message: await friendlyAuthError(error?.message ?? "", error?.code) };
    await ensureWorkspace(createAdminDb(), data.user);
    redirect(next);
  }

  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: callbackUrl(await origin(), next) },
  });
  if (error) return { status: "error", message: await friendlyAuthError(error.message, error.code) };
  // With "Confirm email" on, there's no session until they click the link.
  if (!data.session || !data.user) return { status: "check_email", email };
  await ensureWorkspace(createAdminDb(), data.user);
  redirect(next);
}

export async function signOut() {
  const db = await createServerDb();
  await db.auth.signOut();
  redirect("/login");
}
