# Architect 2.0 prototype

A working prototype of Architect 2.0, Lyzr's vibe-coding platform, built for the Lyzr Technical PM take-home. A user types one prompt. Architect writes a **Blueprint** (the app's PRD, called "the plan" in the interface: plain-language parts, each with an automatic check and a cost). The user reviews it and clicks **Build**, and every item is built and proven.

Read these before writing code, in this order:
1. `docs/BUILD-SPEC.md`: what to build, milestone by milestone, with routes and acceptance checks.
2. `docs/DATA-MODEL.md` and `supabase/migrations/0001_init.sql`: the database.
3. `docs/BLUEPRINT-GENERATION.md`: the one real AI feature, with its prompt, schema and estimator.
4. `docs/SIMULATOR.md` and `sim/scenarios/meeting-prep.json`: how the build is simulated.
5. `docs/DESIGN.md`, `design-system/README.md` and `src/app/tokens.css`: the Soft Tray design system. The 17 final screens in `docs/screens/` are the visual source of truth.
6. `docs/QA-CHECKLIST.md`: what "done" means.

Product documents (PRD, architecture, flows) are in `docs/product/`. When this file and the PRD disagree, ask; don't guess.

## Stack
- Next.js (App Router) + TypeScript (strict) + Tailwind v4 + shadcn/ui, deployed on Vercel.
- Supabase: Auth (Google, GitHub, email), Postgres, Realtime on the `events` table.
- Vercel AI SDK. All model calls go through `src/lib/gateway.ts`, never a provider SDK directly.
  - Real providers: Google (Gemini, required) and OpenRouter (optional, free models, via `@openrouter/ai-sdk-provider`).
  - Claude and GPT: real only if `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` is set. Otherwise the gateway routes them to Gemini and the picker shows them with a `SimTag`. Never hide that a model is simulated.
  - On a free-tier rate limit (429), retry with backoff, then show the paused banner with "Switch model". Never fail over silently.
- GitHub App (read-only contents and metadata) via Octokit, for repo listing and import analysis.
- Playwright for the smoke test; Vitest for unit tests.

## Commands
- `pnpm dev`: local dev server.
- `pnpm test`: unit tests.
- `pnpm e2e`: Playwright smoke test of the core flow.
- `pnpm lint && pnpm typecheck`: must pass before every commit.
- `pnpm db:push`: apply migrations to the linked Supabase project.

## Rules that must not be broken
1. **The Blueprint always comes first, and nothing builds without a click.** Send ("Write the plan") generates the Blueprint, which the interface calls the plan. Building (and every later change) starts only when the user clicks **Build · ~N credits** or **Apply**. There is no auto-approve and no auto-start, whatever the budget.
2. **Real vs Simulated is honest.** Every simulated surface shows the `Simulated` tag (`<SimTag />`). The real parts are listed in `docs/BUILD-SPEC.md` section 1. Never fake a real part.
3. **Colour means status only.** Use the status tokens (`works`, `building`, `attention`, `approval`, `failed`) for part states and nothing else. Blocked and paused are neutral ink. Status is an icon plus a word; finished rows get only a quiet check, never a filled chip.
4. **One primary button per screen.** If the stage action is blocked by something the user can fix on screen, that fix is the primary and the stage action is a disabled secondary with its reason.
5. **Plain words.** Use the design-system word list: plan, part, works, Test version / Team version / Live, Talk first, Blocked, Keys and passwords. "Connect Gmail", not "OAuth pending". Code font only for code, file names and URLs.
6. **No secrets in the repo or the client.** API keys live in Vercel env vars and are read only in server code (`src/server/**`). Commit `.env.example` only. Never log prompts with personal data.
7. **Never push, deploy or publish** without Netanya's explicit OK in the session.
8. **Accessibility:** real `<button>` and `<a>` elements, labels on inputs, a visible focus ring (`focus` token), hit areas of at least 24×24px, 4.5:1 text contrast. Use `line-ctl` for control outlines.
9. **Nothing about other people's work.** Never commit anything about other people's take-home work: no names, repo links, scores or comparisons, in any file, commit message or PR text. Compare only against products (Lovable, Replit, v0, Base44, Cursor, today's Architect). A local pre-commit hook enforces the wording.

## Code conventions
- Folders:
  - `src/app` for routes;
  - `src/components/ax` for our components (one per design-system component), on top of `src/components/ui` (shadcn);
  - `src/server` for server-only code;
  - `src/lib` for shared helpers;
  - `sim/` for the simulator.
- **Data:** server actions for mutations; read through the typed Supabase client (`src/lib/db.ts`, generated types). Row Level Security is on for every table.
- **State:** server state comes from Supabase plus Realtime. There's no global client store beyond small Zustand slices for UI state (selected item, open drawer).
- **Copy:** user-facing strings sit in the component, written as in the final screens. Sentence case. No lorem ipsum.
- **Tests:** every server action gets a unit test. The Blueprint schema gets fixture tests on the 3 demo prompts.
- **Commits:** small, one milestone task per commit, with a message that says what changed for the user.

## Definition of done (every task)
- It works on the deployed Vercel preview, not just locally.
- It matches the final screens and the design system, in light mode, and in dark mode for the Developer view.
- Empty, loading, waiting and failed states are handled.
- Lint, typecheck, unit tests and the e2e smoke test pass.
- No keys or personal data are committed.
