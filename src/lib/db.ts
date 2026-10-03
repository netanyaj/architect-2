import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

export type { Database };
export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type Role = "owner" | "admin" | "builder" | "viewer";

/** Public Supabase settings (safe in the browser: RLS guards every table). */
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Typed client for client components (Realtime, reads under RLS). Writes go through server actions. */
export function createBrowserDb() {
  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
}
