import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth-paths";
import { createAdminDb, createServerDb } from "@/server/db";
import { ensureWorkspace } from "@/server/workspace";

/**
 * Google, GitHub and email-confirmation links return here with a one-time code.
 * Swap it for a session, make sure the person has their own Acme Ops, then go where they were headed.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));
  const code = searchParams.get("code");
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");

  const fail = (message: string) =>
    NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}&next=${encodeURIComponent(next)}`, origin));

  if (providerError) return fail("Sign-in was cancelled or didn't finish. Try again.");
  if (!code) return fail("That sign-in link is missing its code. Start again from here.");

  const db = await createServerDb();
  const { data, error } = await db.auth.exchangeCodeForSession(code);
  if (error || !data.user) return fail("That sign-in link has expired or was already used. Sign in again.");

  try {
    await ensureWorkspace(createAdminDb(), data.user);
  } catch {
    return fail("You're signed in, but your workspace couldn't be set up. Try again in a moment.");
  }
  return NextResponse.redirect(new URL(next, origin));
}
