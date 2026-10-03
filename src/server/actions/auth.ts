"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeNext } from "@/lib/auth-paths";
import { createAdminDb, createServerDb } from "../db";
import { ensureWorkspace } from "../workspace";

export type EmailAuthState =
  | { status: "idle" }
  | { status: "error"; message: string; field?: "email" | "password" }
  | { status: "check_email"; email: string };

/** This site's origin as the browser sees it, so callbacks work on localhost, previews and production. */
async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
}

function callbackUrl(base: string, next: string): string {
  return `${base}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;
}

/** Supabase's error text → what happened and what to do, in plain words. */
export async function friendlyAuthError(message: string): Promise<string> {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "That email and password don't match. Try again, or create an account.";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "There's already an account with that email. Sign in instead.";
  if (m.includes("email not confirmed")) return "Confirm your email first. The link is in your inbox.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many tries in a row. Wait a minute, then try again.";
  if (m.includes("provider is not enabled") || m.includes("unsupported provider"))
    return "That sign-in option isn't turned on yet. Use another one, or ask your admin.";
  if (m.includes("password") && (m.includes("at least") || m.includes("weak")))
    return "Use a password of at least 8 characters.";
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
    options: { redirectTo: callbackUrl(await origin(), next) },
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
    if (error || !data.user) return { status: "error", message: await friendlyAuthError(error?.message ?? "") };
    await ensureWorkspace(createAdminDb(), data.user);
    redirect(next);
  }

  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: callbackUrl(await origin(), next) },
  });
  if (error) return { status: "error", message: await friendlyAuthError(error.message) };
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
