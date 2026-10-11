import "server-only";

/** Server-only settings. Keys are read here and nowhere else (CLAUDE.md rule 6). */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server setting ${name}. Add it to .env.local and to Vercel.`);
  return value;
}

/** An optional setting: empty strings count as unset. */
function optional(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export const serverEnv = {
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  google: () => ({ apiKey: required("GOOGLE_GENERATIVE_AI_API_KEY"), model: optional("MODEL_GEMINI") ?? "gemini-2.5-flash" }),
  openrouter: () => {
    const apiKey = optional("OPENROUTER_API_KEY");
    const model = optional("MODEL_OPENROUTER");
    return apiKey && model ? { apiKey, model } : undefined;
  },
  anthropic: () => {
    const apiKey = optional("ANTHROPIC_API_KEY");
    return apiKey ? { apiKey, model: optional("MODEL_CLAUDE") } : undefined;
  },
  openai: () => {
    const apiKey = optional("OPENAI_API_KEY");
    return apiKey ? { apiKey, model: optional("MODEL_GPT") } : undefined;
  },
  /** Lyzr Studio, the platform's account: runs only the shared demo agent (LYZR_AGENT_ID). Workspaces use their own key (M5.10). */
  lyzr: () => {
    const apiKey = optional("LYZR_API_KEY");
    return apiKey ? { apiKey, sharedAgentId: optional("LYZR_AGENT_ID"), baseUrl: optional("LYZR_BASE_URL") ?? "https://agent-prod.studio.lyzr.ai" } : undefined;
  },
  /** The GitHub App (read-only contents and metadata). The private key is stored on one line with \\n escaped. */
  githubApp: () => {
    const appId = optional("GITHUB_APP_ID");
    const privateKey = optional("GITHUB_APP_PRIVATE_KEY")?.replace(/\\n/g, "\n");
    const slug = optional("GITHUB_APP_SLUG");
    const clientId = optional("GITHUB_APP_CLIENT_ID");
    const clientSecret = optional("GITHUB_APP_CLIENT_SECRET");
    return appId && privateKey && slug && clientId && clientSecret ? { appId, privateKey, slug, clientId, clientSecret } : undefined;
  },
  siteUrl: () => process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
};
