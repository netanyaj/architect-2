import "server-only";

import { openInDevOf, type OpenInDev } from "@/lib/dev-preference";
import { cookies } from "next/headers";
import { createServerDb } from "./db";

/**
 * The person's theme (Settings › Appearance), a user setting. The cookie set when they choose it is read first, so
 * pages render without a round trip; a browser without it falls back to the account's saved setting (read from the
 * session, no network call). Light unless they chose dark.
 */
export async function userTheme(): Promise<"light" | "dark"> {
  const cookie = (await cookies()).get("ax_theme")?.value;
  if (cookie === "dark" || cookie === "light") return cookie;
  const db = await createServerDb();
  const { data } = await db.auth.getSession();
  return data.session?.user.user_metadata?.theme === "dark" ? "dark" : "light";
}

/** "Open projects in Developer view" (M5.5): from the person's account; imported repos only by default. */
export async function userOpenInDev(): Promise<OpenInDev> {
  const cookie = (await cookies()).get("ax_open_in_dev")?.value;
  if (cookie) return openInDevOf(cookie);
  const db = await createServerDb();
  const { data } = await db.auth.getSession();
  return openInDevOf(data.session?.user.user_metadata?.open_in_dev);
}
