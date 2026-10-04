import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

export type { Database };
export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type Role = "owner" | "admin" | "builder" | "viewer";

/**
 * The project's API address must look like https://<ref>.supabase.co (or a local Supabase on localhost).
 * A common slip is pasting the dashboard address (https://supabase.com/dashboard/project/<ref>): pages still
 * load, but every sign-in call goes to the dashboard website and fails. Fail loudly instead, at build time.
 */
export function checkSupabaseUrl(url: string | undefined): string {
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set. Use your project's API URL: https://<project-ref>.supabase.co");
  const dashboard = url.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/);
  if (dashboard) {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL is the Supabase dashboard address. Use the API URL instead: https://${dashboard[1]}.supabase.co`,
    );
  }
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(url)) {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL should look like https://<project-ref>.supabase.co, not ${url}`);
  }
  return url.replace(/\/$/, "");
}

/** Public Supabase settings (safe in the browser: RLS guards every table). */
export const supabaseUrl = checkSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Typed client for client components (Realtime, reads under RLS). Writes go through server actions. */
export function createBrowserDb() {
  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
}
