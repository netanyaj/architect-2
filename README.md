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
| `docs/product/` | PRD, architecture, flows, stack and milestones (for context) |
| `.env.example` | The keys you add yourself |

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
