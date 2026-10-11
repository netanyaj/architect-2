# Handoff pack: Architect 2.0 prototype

This folder becomes the root of the new repo. Claude Code reads `CLAUDE.md` first.

## What's here
| Path | What |
|---|---|
| `CLAUDE.md` | Project context, rules that must not break, conventions, definition of done |
| `docs/BUILD-SPEC.md` | Real vs Simulated, routes mapped to the final screens, milestones M1–M6 with acceptance checks |
| `docs/DATA-MODEL.md`, `supabase/migrations/0001_init.sql` | Database, the Build-gate rule, seed data |
| `docs/BLUEPRINT-GENERATION.md` | Schema, system prompt, estimator, demo prompts |
| `docs/SIMULATOR.md`, `sim/scenarios/meeting-prep.json` | How the build is simulated, the event types, scenario rules |
| `docs/DESIGN.md`, `src/app/tokens.css`, `design-system/` | Design tokens (Tailwind v4), the component list, the design-system copy |
| `docs/QA-CHECKLIST.md` | What M6 checks |
| `docs/DECISIONS.md` | Where the prototype differs from the spec, and why; the numbers we set |
| [`docs/COVERAGE.md`](docs/COVERAGE.md) | Every Must in the PRD: Done, Simulated or Doc only, and where to see it |
| `docs/product/` | PRD, architecture, flows, stack and milestones (for context) |
| `.env.example` | The keys you add yourself |

## Invites

Invites are shared by link: Settings › People › Create invite link (or the account menu › Invite people), then send the link yourself. It only works for the email it was made for. There's no email service by decision; sending invites by email (Supabase Auth with custom SMTP, `INVITE_EMAILS=on`) and matching invites to a new sign-up automatically are **Next**.

## Seeing each role without a second account

In a project, ⋯ › **View as role** › Builder or Viewer shows the project as that role sees it, with "Viewing as Viewer · Stop" at the top. Only the page changes: every action is still checked against your real role on the server.

## Try the demo

The sign-in page's "Just looking? Try the demo" signs you in anonymously with your own seeded Acme Ops workspace, as Priya (an Owner). A tour card on Home walks the story in five steps. Demo visitors write up to 5 plans a day, and are deleted with their workspace after 7 days.

## Analytics

Analytics is page views (Vercel Analytics, no cookies) plus first-party product events in our own database (`analytics_events`, read with `docs/analytics.sql`); nothing goes to a third party beyond the page view. Tracker-free tenants (C-8) would turn third-party analytics off in the real product. The three success metrics we'd track: time to first plan, share of plans built, and blockers resolved before Launch.

## Real vs Simulated
Everything simulated carries the `Simulated` tag in the interface. Full list: `docs/BUILD-SPEC.md` section 1; deviations: `docs/DECISIONS.md`; every PRD Must, row by row: [`docs/COVERAGE.md`](docs/COVERAGE.md).

| Part | Real or Simulated |
|---|---|
| Sign-in (Google, GitHub, email), workspaces, roles, copy-a-link invites | Real |
| Plans (the Blueprint) from Gemini through the gateway, the Build gate, chat changes and the conflict guard | Real |
| Model picker: Gemini and OpenRouter | Real; Claude and GPT are Simulated (answered by Gemini) unless their keys are set |
| **Lyzr Studio agents**: each workspace connects its own Lyzr API key (Connections › Lyzr Studio, stored encrypted). Each agent in a plan is made in that workspace's own Studio when its part is built; saved edits sync; Try it runs it there | **Real** with the workspace's key; without one, Gemini answers and it's labelled "Simulated · connect your Lyzr key to make this real". No user's agents or data go to another account |
| **The demo agent** (Meeting Prep › Research agent): Try it with no key of your own, on the platform's shared Studio agent, 10 runs a day | **Real** (read-only) |
| **Import a repo**: GitHub App install and confirmation, repo, branch and folder lists, reading the files, static analysis (stack, start commands, keys, tests, agents), the plan from the repo with your tests as proof | **Real** (read-only; running the repo and its tests is Simulated) |
| Run as it is, Configure, Port | Simulated |
| Settings › GitHub: installations, the repos they can read, connect, disconnect, Manage on GitHub | **Real** |
| Changes as pull requests, merging into main, the sync banner (?sim=sync), the repo deploy route on Launch | Simulated. The optional real PRs on test repos were not built (Netanya, 9 Oct): they need Contents: Read and write on the GitHub App, which only reads. Settings › GitHub shows the setting off, with that reason |
| Hand-off: Transfer ownership with a note, accept in the project or with an invite link, "You now own …", ownership history | **Real** |
| Sign-in for the app's users (Google, email; SSO with governance), on Launch and in Project settings | **Real** setting (SSO itself is Simulated) |
| Data tab: tables per version, Rows/Columns, filter, Export CSV, the app's sign-ins | Simulated data, seeded from each project's parts |
| Bring your own coding agent: project tokens (stored as hashes, approval under governance), the /docs/mcp spec, the ?sim=byoagent session | Simulated (tokens are real rows, but no MCP server accepts them) |
| Developer view: an imported project's file tree and contents | **Real** (read through the GitHub App) |
| Developer view: Architect's code, Changes, terminal, activity, branch and PR, keys per version | Simulated |
| Agents graph, sample runs, tools and knowledge, Compare; imported CrewAI and LangGraph runtimes | Simulated |
| Build run, checks, fix loop, preview app, deploys, custom domains, test link | Simulated |
| Usage, budgets and the budget pause (on simulated spend) | Real numbers from the database |
| Connect (OAuth) | Simulated consent step |
| Governance layer (policies, approvals, audit) | Simulated (M5) |

## How to start (Sun 4, M1)
1. Finish the setup checklist in `docs/product/11-stack-and-milestones.md` section 4 (Vercel, Supabase, model keys, GitHub App). You add every key yourself.
2. Create an empty **private** repo and copy this folder in. Make it public only when you're ready to submit.
3. Open Claude Code in the repo and give it one milestone at a time:

> Read CLAUDE.md and docs/BUILD-SPEC.md. Plan milestone M1 as a task list, show me the plan, then build it. Stop after each task that changes the database or auth, and show me what changed. Don't push or deploy without asking.

4. At the end of each milestone: deploy a Vercel preview, run the milestone's acceptance checks, then start the next one.

## Prompts for later milestones
- **M2:** "Build M2 from docs/BUILD-SPEC.md and docs/BLUEPRINT-GENERATION.md. Start with the zod schema and the fixture tests for the 3 demo prompts, then the streaming route, then the UI."
- **M3:** "Build M3 from docs/BUILD-SPEC.md and docs/SIMULATOR.md. Start with the timeline builder as a pure function with unit tests, then the settle step, then the UI states on final screens 2, 3, 4, 6, 7 and 16."
- **M4 and M5:** "Build M4 (or M5) from docs/BUILD-SPEC.md. Match final screens 8–13 and 14–15. Everything simulated shows the SimTag."
- **M6:** "Run docs/QA-CHECKLIST.md item by item and report what fails, with screenshots. Fix only what I approve."
