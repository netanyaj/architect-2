import "server-only";

import { cookies } from "next/headers";
import { openInDevOf, type OpenInDev } from "@/lib/dev-preference";
import { createServerDb } from "./db";

export type ThemeChoice = "system" | "light" | "dark";

/**
 * The person's theme (Resources › Theme, Settings › Preferences): System, Light or Dark. The cookie set when they choose it
 * is read first, so pages render without a round trip; a browser without it falls back to the account's saved setting
 * (read from the session, no network call). Light unless they chose otherwise.
 */
export async function userTheme(): Promise<ThemeChoice> {
  const ok = (v: unknown): v is ThemeChoice => v === "dark" || v === "light" || v === "system";
  const cookie = (await cookies()).get("ax_theme")?.value;
  if (ok(cookie)) return cookie;
  const db = await createServerDb();
  const { data } = await db.auth.getSession();
  const saved = data.session?.user.user_metadata?.theme;
  return ok(saved) ? saved : "light";
}

/** "Open projects in Developer view" (M5.5): from the person's account; imported repos only by default. */
export async function userOpenInDev(): Promise<OpenInDev> {
  const cookie = (await cookies()).get("ax_open_in_dev")?.value;
  if (cookie) return openInDevOf(cookie);
  const db = await createServerDb();
  const { data } = await db.auth.getSession();
  return openInDevOf(data.session?.user.user_metadata?.open_in_dev);
}
