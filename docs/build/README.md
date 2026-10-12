# Build pack

The app was built with Claude Code from this spec pack: the instructions it worked from (`CLAUDE.md`), the build spec with its milestones, the data model, the plan-writing design, the simulator, the design notes and the QA checklist. `notes/` keeps the review notes between milestones.

| File | What it is |
|---|---|
| `CLAUDE.md` | The rules and conventions Claude Code followed (the repo root's `CLAUDE.md` imports it) |
| `BUILD-SPEC.md` | What to build, milestone by milestone, with routes and acceptance checks |
| `DATA-MODEL.md` | The database, table by table |
| `BLUEPRINT-GENERATION.md` | Writing the plan: the prompt, the schema and the estimator |
| `SIMULATOR.md` | How the build is simulated: a precomputed event timeline |
| `DESIGN.md`, `12-design-brief.md` | The Soft Tray design system's intent and the screen brief |
| `QA-CHECKLIST.md` | What "done" meant for each task |
| `11-stack-and-milestones.md` | The stack and the milestone plan |
| `notes/` | Review notes between milestones (brand layer, polish, fixes before M6) |

## How the build was run
Each milestone was one prompt to Claude Code, in order, with a stop before anything that changed the database or auth:

> Read CLAUDE.md and docs/build/BUILD-SPEC.md. Plan milestone M1 as a task list, show me the plan, then build it. Stop after each task that changes the database or auth, and show me what changed. Don't push or deploy without asking.

- **M2:** "Build M2 from docs/build/BUILD-SPEC.md and docs/build/BLUEPRINT-GENERATION.md. Start with the zod schema and the fixture tests for the 3 demo prompts, then the streaming route, then the UI."
- **M3:** "Build M3 from docs/build/BUILD-SPEC.md and docs/build/SIMULATOR.md. Start with the timeline builder as a pure function with unit tests, then the settle step, then the UI states on final screens 2, 3, 4, 6, 7 and 16."
- **M4 and M5:** "Build M4 (or M5) from docs/build/BUILD-SPEC.md. Match final screens 8–13 and 14–15. Everything simulated shows the SimTag."
- **M5.x and M6:** review notes in `notes/`, then QA (see `docs/QA-REPORT.md`).
