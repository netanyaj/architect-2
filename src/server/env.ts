import "server-only";

/** Server-only settings. Keys are read here and nowhere else (CLAUDE.md rule 6). */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server setting ${name}. Add it to .env.local and to Vercel.`);
  return value;
}

export const serverEnv = {
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  siteUrl: () => process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
};
