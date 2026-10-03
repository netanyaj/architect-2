import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabaseAnonKey, supabaseUrl, type Database } from "@/lib/db";
import { serverEnv } from "./env";

/** The signed-in person's client: reads under RLS, session in cookies. */
export async function createServerDb() {
  const cookieStore = await cookies();
  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components can't set cookies; the proxy refreshes the session instead.
        }
      },
    },
  });
}

/**
 * Service-role client for server actions. Bypasses RLS, so every caller checks the person's role first
 * (DATA-MODEL: writes go through server actions that check can_build()).
 */
export function createAdminDb() {
  return createClient<Database>(supabaseUrl, serverEnv.supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type ServerDb = Awaited<ReturnType<typeof createServerDb>>;
export type AdminDb = ReturnType<typeof createAdminDb>;
