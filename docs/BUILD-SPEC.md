# Build spec

The visual source of truth is the **"Architect 2.0 – Modern direction"** canvas, page "Final screens · Soft Tray" (17 screens; PNGs and HTML in `docs/screens/`), and the **Architect 2.0 · Soft Tray** design system (`design-system/`). Requirement IDs (BL-, A-, B-, C-) refer to the PRD (`docs/product/08-PRD-architect-2.md`).

## 1. Real vs Simulated
| Real (must actually work) | Simulated (scripted, tagged `Simulated`) |
|---|---|
| Sign-in (Google, GitHub, email), workspaces, roles, invites | Build run: statuses, checks, proofs, fix loop, readiness |
| Home composer, projects, settings, usage numbers from the DB | Preview app (a pre-built "Meeting Prep" app in an iframe) |
| **Blueprint generation**: items, defaults, blocking questions, conflict guard, estimates, versions, the Build gate | Environments, pre-publish checks, deploy, rollback, custom domain |
| Model picker through the gateway: Gemini and an OpenRouter free model are real; Claude and GPT are real when their key is set, otherwise tagged Simulated and answered by Gemini | PRs, two-way sync, developer view code/terminal content |
| Chat: requests become proposed changes with estimates; Plan mode; message queue | Agents tab sample runs, graph, tools and knowledge; CrewAI/LangGraph runtime |
| Agents › Try it: each plan agent runs as its own Lyzr Studio agent (Real with `LYZR_API_KEY`; otherwise Gemini answers, tagged Simulated) | |
| GitHub App connect, repo list, branch list, import analysis | Coding-agent (MCP) activity; MCP server (spec page only) |
| Budgets stored and enforced on the simulated spend | The whole governance layer (policies, approvals, audit, data flow) |
| Support bot answers from a short Architect FAQ via the gateway | "Talk to a person" ticket (creates a DB row, no email) |

## 2. Routes and screens
Screen numbers refer to the final canvas. Interface words follow the design-system README: **plan** (the Blueprint), **part** (an item), **works**, **Test version / Team version / Live** (preview / staging / production).

| Route | Screen | Notes |
|---|---|---|
| `/login` | n/a | Supabase Auth UI in our styles; the prompt typed on Home survives sign-in |
| `/home` | 1 · Home, 14 · Help me decide, 15 · Templates and prompts | Composer with context pills inside (Add files, agents or tools · Import a repo · Templates and prompts · Help me decide); action row: Talk first · model · voice · **Write the plan**. "Continue where you left off" rows show the next action. Help me decide is the AI Consultant (3 questions, then 3 ideas). Templates, Agentlets and Prompts open in a dialog |
| `/projects` | 12 · Projects, 17 · empty | Tray rows: name, owner · updated · credits used, tools, the next action, "⋯" (Open, Duplicate, Download code, Share, Delete). Filters: All · Needs you · Live · Drafts |
| `/p/[id]` | 2 · Plan ready, 16 · Plan error, 3 · Building, 6 · Part blocked, 7 · Paused at budget | The workspace. The stage follows project state; `?view=app\|agents\|data\|files\|code\|terminal`; `?dev=1` for Developer view |
| `/p/[id]?view=files` | 5 · Files, full plan, look and feel, sharing | The plan document (versions, compare, edit), uploads, what Architect made, theme presets. Share opens a popover |
| `/p/[id]/launch` | 4 · Launch | Test → Team → Live cards, the checklist (fixes are inline actions), sign-in, web address, keys and passwords, badge, Marketplace listing, version history, usage, download |
| `/p/[id]?dev=1` | 8 · Developer view | Dark theme by default (a user setting). Code opens on **Changes**: every changed file vs main, grouped by part, unified diff, terminal, Activity (checker, Architect agent, coding agents via MCP, GitHub commits) |
| `/p/[id]?view=agents` | 9 · Agents | The graph is the default (labelled hand-offs, dashed tools and knowledge). A node opens Settings · Runs · Try it · Checks on the right. Save or Discard |
| `/p/[id]?view=data` | 13 · Data | Tables per version (Test data by default), Rows/Columns, sign-in users, filter, Export CSV; Live is read-only |
| `/import` | 10 · Import a repo | Stepper: Choose repo → Understand it → Plan from repo |
| `/governance/approvals` and the other governance pages | 11 · Approvals | Master–detail; reason required to reject; other governance sections reuse the pattern |
| `/connections`, `/usage`, `/settings`, `/agents`, `/marketplace` | same patterns (SideNav + tray rows) | Settings holds members, invites, roles, budgets, theme |
| `/docs/mcp` | n/a | MCP tool spec (B-7): `get_blueprint`, `update_item`, `run_in_sandbox`, `run_tests`, `open_pr`, `request_approval`, `get_preview_url` |

**Workspace layout:**
- **Header on the canvas:** ← Projects · project tile and name · **Stepper** (Plan · Build · Launch, with the current stage's progress inside it) · Help "?" · Share · "⋯" (Developer view, version history, duplicate, download code, GitHub, settings) · the stage action.
- **Plan panel (340px, tray):** Needs you → In progress → Works → Up next.
- **Stage (fills the rest):** App · Agents · Data · Files segmented, with the app labelled "Test version" and the floating dock (size · Point at something · N problems).
- **Chat (344px).**
- **Collapsing:** the Plan and Chat panels collapse to 56px rails on full-width views.
- **The stage action by state:**
  - **Plan:** **Build · ~N credits**, disabled while a question is open, with "Answer 1 question to build · 1,240 credits available" beside it.
  - **Build:** Launch, disabled with its reason. The main button on screen is the first Needs-you fix ("Connect Google account").
  - **Launch:** "Share with your team", disabled until the checklist is clear.
  - **Rule:** a fix on screen is always the primary, and the blocked stage action is a secondary with its reason.

## 3. Milestones
### M1 · Foundation (Sun 4)
- Scaffold:
  - Next.js, Tailwind v4 with `src/app/tokens.css`, Figtree and Geist Mono, shadcn base;
  - the `ax` components listed in `docs/DESIGN.md`: Button, Pill, Stepper, Segmented, SideNav, PlanPanel, NeedsYouCard, StatusMark, PreviewDock, Composer, ChangeCard, Drawer, StageBanner, ListRow, TemplateCard, VersionCards, Toggle, DataTable, HelpPanel, EmptyState, SimTag (AgentGraph and CodeDiff land in M4).
- Supabase: migrations; Auth (Google, GitHub, email); workspace on first sign-in; roles Owner/Admin/Builder/Viewer; invites by email link (BL-1, BL-15).
- Pages: Home (composer, recent projects, templates), Projects, Connections (list with statuses), Usage (ledger), Settings (members, invites, budgets).
- An empty workspace shell for a project.
- Help: the support panel with a gateway-backed bot and "Talk to a person" (ticket row).
- **Acceptance:**
  - sign in with each provider;
  - invite a second account as Viewer, who can't click Build;
  - a project opens with the three panes;
  - deployed on Vercel.

### M2 · Blueprint and chat, real (Mon 5)
- `POST /api/blueprint` streams items to the Blueprint pane (A-1). Defaults are applied and listed (A-0); blocking questions appear as cards in the conversation (A-2); conflict guard cards (A-3); estimates per item and total (A-4); versions with compare (A-5).
- The **Build gate**: Build is disabled until blocking questions are answered. Clicking Build saves version 1, marks items Agreed and starts the simulator.
- Model picker in the composer, limited to the allowed models (BL-3). Switching mid-project asks first. Models without a key show a `SimTag` and a tooltip: "Answered by Gemini in this prototype".
- Chat (BL-4): a Plan toggle and a message queue. With Plan off, a request returns a ChangeCard with an estimate; **Apply** creates a new version and queues it (A-11). With Plan on, Architect never changes items.
- Blueprint tab: the document view; Files tab: the Blueprint first, then uploads (FileList).
- **Acceptance:**
  - the 3 demo prompts each produce a valid Blueprint in under 60 s on Gemini and on the OpenRouter model; Claude and GPT work through the simulated route;
  - a 429 from a free tier shows the paused banner, not a crash;
  - no build starts without a click;
  - a chat request returns a change card;
  - the schema tests pass.

### M3 · Build to deploy, simulated (Tue 6)
- The simulator (`docs/SIMULATOR.md`) plays the scenario over the real items and writes `events`; Realtime updates the item rows, header progress, activity lines and proof strip (BL-5, A-6, A-7).
- **Fix loop:** up to 3 attempts, each a Usage line (A-9). After 3 failures the part is **Blocked**: screen 6, a drawer with the check, the 3 attempts, the suggested fix (primary), Edit this part, Try once more (cost), Set aside for now, Ask a person.
- **Sample data** shown on the part ("using sample data") and in the Launch checklist (A-8); progress in the stepper and the Plan panel (A-10).
- **Budgets:** the build pauses at the project budget (screen 7). Finished items are kept, and the user chooses what happens next (BL-14).
- **Preview:** the full app in an iframe labelled "Test version", with the dock: device sizes, Point at something (attaches the element to chat), N problems (opens the console, each error has Fix with AI) (BL-6). The selected part is outlined, never isolated. "Test the app" runs every check plus a browser pass.
- **Checkpoints:** every part that works is a restorable point; "History and go back" in the part drawer and on Launch (BL-7).
- **Connections:** the Needs-you card's Connect button flips the part to Works after the simulated OAuth (BL-9).
- **Launch (screen 4):** Test → Team → Live, the checklist with inline fixes, share with your team, go live, version history and go back (BL-12, BL-13). Building an applied change (F7).
- **Launch options (added 5 Oct, `reviews/deploy-flow-review-2026-10-05.md`), all simulated:**
  - the workspace's governance setting (Settings): on, Test → Team → Live with approval for Builders; off, Test → Go live with the team version optional;
  - "Who can open it": anyone with the link · signed-in people at your domain · invited people only;
  - Marketplace: your workspace or Public Agentlets, with today's listing form (category, description, a 160-character short description, up to 8 tags);
  - "Live is behind · Update live" after a change; a deploy-failed state (see SIMULATOR "Deploys"); custom domain steps; a confirmation before going back;
  - also: a view-only test link, running cost on the Live card, an analytics toggle and a success state.
- **Acceptance:**
  - flow F2 runs from prompt to a live URL;
  - F7 (change after launch) works;
  - every state on screens 2, 3, 4, 6, 7 and 16 is reachable.

### M4 · Developers and agents (Wed 7)
- **Import (real):** GitHub App install link, repo and branch list, tree read, then static analysis plus the gateway turn it into a "Blueprint from repo" (B-1, B-2). Run as it is (B-3, simulated preview).
- **PRs (simulated)**, with an optional real PR on a test repo (B-4). Sync banner (B-5). GitHub panel in Settings (BL-11).
- **Developer view (screen 8):** Changes grouped by part with a unified diff, All files tree, read-only editor (Monaco is fine), terminal, Activity feed, PR link (B-9).
- **Agents (screen 9):** the graph by default; the node drawer with Settings (model + Compare + more settings, instructions, tools and MCP, knowledge, Save), Runs (expandable input, tool calls, output), Try it (real call through the gateway), Checks. Studio sync line (BL-8). CrewAI and LangGraph agents listed from import (B-6).
- Coding-agent activity lines labelled "Coding agent: Claude Code (Sam) · via MCP"; `/docs/mcp` spec page (B-7). Default stack line (B-8). Data (screen 13) with tables per version and sign-in users; the sign-in setting on Launch (BL-10).
- **Acceptance:** F3 (import), F4 (bring your own coding agent, shown via activity) and F8 (handoff Morgan → Sam) can be shown.
- **Status (10 Oct 2026): done and accepted on production.** F3 (import → plan from repo → build → PR), F4 and F8 pass on production, and so does the full browser suite (35 passed, 2 skipped by design). One change from this list: PRs stay simulated with no real-PR option, Netanya's call on 9 Oct (a real PR would also need Contents: Read and write on the GitHub App). Details and deviations: DECISIONS.md "M4" and "M4 acceptance".

### M5 · Governance layer and remaining flows (Thu 8)
- **Org setting:** governance on/off. The Governance nav appears for admins only.
- **Sections:** where it runs (C-1, with a diagram per mode), models (C-2), connectors and MCP (C-3), data and egress with the data-flow view (C-4), approval queue with the timeline and decision (C-5), audit log with filters and CSV export (C-6), org budgets (C-7). Permission rules on push, deploy and secrets (C-10).
- **Effects inline:** "Needs approval" on items, allowed models only in pickers, a Production deploy waiting for approval.
- **Migration flow (F9):** "Move to 2.0" on a legacy app opens import with the repo pre-selected.
- **Acceptance:** F5, F6 and F9 can be shown, and every Real/Sim row in the PRD is done.
- **Status (11 Oct 2026): done and accepted on production.** F5, F6 and F9 pass on production, and so does the full browser suite (50 passed, 2 skipped by design). Every PRD Must, row by row: `docs/COVERAGE.md`. Details and deviations: DECISIONS.md "M5" and "M5 acceptance".

### M6 · QA and submission (Fri 9)
- Work through `docs/QA-CHECKLIST.md`.
- README with a Real vs Simulated table; architecture PDF; absolute image links in ARCHITECTURE.md; PRD links filled in.
- Loom (3–5 min); submission form.
