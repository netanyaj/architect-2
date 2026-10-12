# Setup

Run Architect 2.0 yourself: Next.js on Vercel, Supabase for the database and sign-in.

## What you need
- Node 22+ and pnpm.
- A Supabase project (the live one is in `ap-south-1`, Mumbai) with Google and GitHub sign-in, email sign-in with "Confirm email" off, and **Allow anonymous sign-ins** on (Authentication › Sign In / Providers) for Try the demo. Supabase Vault must be on (Database › Extensions › `supabase_vault`); it is by default.
- A Gemini API key (required). OpenRouter is optional: it's a picker choice and the fallback when Gemini's free quota runs out. Claude and GPT become real when their keys are set.
- A GitHub App with read-only Contents and Metadata, for importing repos.
- Optional: a Lyzr API key and a Studio agent id for the shared demo agent.

## Steps
1. `pnpm install`, then copy `.env.example` to `.env.local` and fill it in. Keys are read only in server code (`src/server/**`).
2. Link Supabase (`supabase link`) and apply the migrations: `pnpm db:push`. Then `pnpm db:types` regenerates `src/lib/database.types.ts`, and `pnpm db:verify` checks that signed-out visitors see nothing.
3. `pnpm dev`, and open http://localhost:3000.
4. On Vercel: set the same variables, plus `CRON_SECRET` for the daily cleanup (`vercel.json` schedules `/api/cron/purge`), and turn on Analytics (Project › Analytics). The live app runs in `bom1`, next to the database.

## Checks
- `pnpm lint && pnpm typecheck` before every commit; `pnpm test` for the unit tests (migrations run on PGlite).
- `pnpm e2e` for the Playwright suite against a local dev server, or `E2E_BASE_URL=https://… pnpm e2e` against a deployment. It needs `LYZR_API_KEY` and `LYZR_AGENT_ID` for the Lyzr tests; each test makes its own account and deletes it.
- `node --env-file=.env.local scripts/delete-test-accounts.mjs` lists leftover test accounts (add `--yes` to delete them).
- `node scripts/render-diagrams.mjs` re-renders the diagrams in `docs/product/diagrams/` from their sources in `src/`.
