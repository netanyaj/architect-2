# Coverage: every Must in the PRD

Every **Must** row in section 8 of `docs/product/08-PRD-architect-2.md`, checked against the prototype on 10 Oct 2026 (M5).

- **Done**: it works for real.
- **Simulated**: it works end to end in the interface, but the infrastructure behind it is scripted, and it carries the `Simulated` tag.
- **Doc only**: it's written down and not built.
- **Partly**: the gap is stated in the row.

Where the prototype differs from the spec, `docs/DECISIONS.md` says what and why. The browser tests named here are in `test/e2e/`.

## Baseline (BL)

| ID | Requirement | Status | Where to see it | Notes |
|---|---|---|---|---|
| BL-1 | Sign in (Google, GitHub, email); workspaces and roles | Done | `/login`; Settings › Members (`auth.spec`, `invites.spec`) | All three sign-ins and the roles of section 9 work. Supabase Auth's "Time-box user sessions" is 0 (checked by Netanya, 10 Oct): sessions don't expire on a timer, so they last at least the 7 days asked for, until sign-out |
| BL-2 | Home: one composer (prompt, files, repo import, template, "Help me decide") | Done | `/home`; `/home/decide` (screen 14); templates dialog (screen 15) | Help me decide asks three questions and the gateway (real) returns three ideas. "Write the plan for this" starts the project from the same composer path |
| BL-3 | Model choice upfront, bring your own key | Done · Simulated (keys) | The model pill on Home and in chat; Governance › Models | Only allowed models are listed. A model that was disallowed shows "This model is no longer allowed · Switch" and is never switched silently. Claude and GPT are real with a key, otherwise Gemini answers and they're tagged Simulated. The own-key setting is a flag only |
| BL-4 | Chat with plan and execute modes; message queue | Done | Chat pane: Talk first, change cards, the queue (`plan.spec`) | Talk first can't change the plan. Queued messages run in order, and each has Edit, which puts it back in the composer. Running tests in plan mode (a Should) isn't built |
| BL-5 | Live build view | Simulated | Build stage (screen 3) (`build.spec`) | Every step names its part, replayed from the run's events on the database clock |
| BL-6 | Live preview: device sizes, click-to-edit, console | Simulated | Preview dock: sizes, Point at something, N problems (`build.spec`) | Point at something attaches the element to chat. The console's errors each have Fix with AI |
| BL-8 | Agent section: graph, inline edit, test playground, traces | Done (Try it, sync) · Simulated (tools, sample runs) | Agents tab (screen 9) (`agents.spec`) | Try it runs each agent on Lyzr Studio for real, and Save updates the Studio agent |
| BL-9 | Connections hub (OAuth, MCP, API keys) | Done (GitHub) · Simulated (other apps) | `/connections`; Connect on the part | Shows connected, expired or missing, and a missing one marks its parts "Needs connection". Scopes and who may connect follow the app policy |
| BL-11 | GitHub two-way, in the user's org | Done (connect, list, read) · Simulated (PRs, sync) | Settings › GitHub; Import; PR cards (`pull-requests.spec`, `f3-import-to-pr.spec`) | Changes arrive as a branch and a PR into the user's own repo, and nothing is created in a Lyzr org. Real PRs weren't built (Netanya's call, 9 Oct) |
| BL-12 | Environments, promote, rollback, custom domain | Simulated | Launch (screen 4) (`launch.spec`, `launch-fast.spec`) | Test, Team and Live, go back, custom domain and Take offline. Data and keys are per version (Data tab; Keys and passwords) |
| BL-13 | Pre-publish checks | Simulated | Launch checklist | Deploy is held while a must-fix is open: connections, sample data, blocked parts, data a policy doesn't allow to leave, keys missing for Live. Each row names its part and its fix |
| BL-14 | Cost controls and budgets | Done (estimate, gate) · Simulated (spend) | Build · ~N credits; project budget (screen 7); Governance › Budgets | No paid step without an estimate and a click. Org cap: alert at 80%, stop at 100%. Build and running cost are shown separately (running cost on the Live card) |
| BL-15 | Sharing and roles (invites: Must) | Done | Settings › Members; Comment under each plan part | Invite with a role (copy a link: no email service, by decision). Viewers can comment on parts but can't build |

## Blueprint core (A)

| ID | Requirement | Status | Where to see it | Notes |
|---|---|---|---|---|
| A-0 | Blueprint first, build on your click | Done | Write the plan → the plan → Build · ~N credits (`plan.spec`) | The Build gate is in the database (`agree_and_build`). A blocking question holds Build |
| A-1 | Prompt → draft blueprint | Done · Partly | The plan's parts, each with "From your words" | Every part quotes the prompt. The acceptance set is 5 prompts × 4 models (20 of 20 passed, 5 Oct), not the PRD's 20 reviewer-marked prompts |
| A-2 | Questions generated from the blueprint | Done | The plan's questions | At most 5, each naming its parts with a default. Only blocking ones hold Build ("the model labels, the server decides") |
| A-3 | Conflict guard | Done | Keep · Set aside · Drop on a part a change would remove or weaken | Dropped parts stay, struck through, with their reason |
| A-4 | Per-item estimate | Done | Under each part: "8–12 cr · 1–2 min · high confidence · mostly …" | The total shows before Build, and setting a part aside updates it at once |
| A-5 | Blueprint versions | Done | Files › the plan: versions and Compare | Build saves a version, and every later change makes a new one |
| A-6 | Live status during the build | Simulated | Plan panel and build stage | Each part that works links to its proof in the part drawer |
| A-7 | Proof per item, never self-graded | Simulated | Part drawer: the check, written before the code; proofs | Only the checker marks a part Works. That holds for a coding agent's change and for a code edit in Developer view |
| A-8 | Honest data state | Simulated | "using sample data" on the part, in the preview and on Launch | |
| A-9 | Fix-loop guard | Simulated | Blocked after 3 fixes (screen 6); Fix lines in Usage | No fix runs past the budget, or past the org cap |
| A-10 | Readiness view | Simulated | The stepper's progress, the Plan panel, the Launch checklist | |

## Open and developer (B)

| ID | Requirement | Status | Where to see it | Notes |
|---|---|---|---|---|
| B-1 | Import a repo | Done | `/import` (screen 10) (`import.spec`) | The GitHub App reads only the repos the person chose; no `repo` OAuth scope. Branch and folder can be chosen |
| B-2 | Understand on import → Blueprint from repo | Done (analysis, plan) · Simulated (test runs) | Import › Understand it; the plan from the repo | The summary lists stack, how it runs, keys, tests and agents. Existing tests become proof on the matching parts |
| B-3 | Run as it is | Simulated | Import: Configure or Port when the stack isn't Node or Python | Nothing is ported without consent |
| B-4 | Changes as PRs | Simulated | PR card in chat; Developer view header | Each build, change or code edit goes on a branch and a PR listing its parts. A push to main needs a click, and an approval under the rule |
| B-6 | Agents in other frameworks run natively | Simulated | Agents › Settings › Runs on (Lyzr Studio, CrewAI, LangGraph) | Imported CrewAI and LangGraph agents keep their framework, and any agent can be set to run on one. Try it is answered by Gemini for them (tagged) |
| B-7 | Bring your own coding agent | Simulated (+ Doc: `/docs/mcp`) | Project settings › Coding agents; `?sim=byoagent` (`coding-agent.spec`) | Lines read "Coding agent: Claude Code (Sam) · via MCP". Marking Works and deploying without approval are both refused, as they would be for Architect's own agent |
| B-8 | Default stack for new projects | Simulated | "Stack: Next.js + Python (Lyzr SDK), the default for new projects" on the plan | |
| B-9 | Developer view | Simulated (code) · Done (an imported repo's real files) | `?dev=1` (screen 8) (`dev.spec`, `code-edits.spec`) | Changes by part, file tree, editor (edits re-run the part's check), terminal, Activity. Download code is in ⋯ |

## Governance (C)

| ID | Requirement | Status | Where to see it | Notes |
|---|---|---|---|---|
| C-1 | Deployment location | Simulated (+ Doc) | Governance › Where it runs (`governance.spec`) | Lyzr Cloud or the customer's AWS VPC, with a picture of where each part runs. Dedicated region and on-prem are shown but disabled, with the reason. Launch says where the app runs |
| C-2 | Model policy | Simulated | Governance › Models | Allowed models, Architect's model, the default for app agents, and a registered private model (answered by Gemini, tagged) |
| C-3 | Connection policy | Simulated | Governance › Apps and MCP servers | An app not on the list puts its part in Needs approval and files a request. Scopes, who may connect, and the MCP servers offered in agent tools |
| C-4 | Data egress policy and data-flow view | Simulated | Launch › Where data goes; Governance › Data and egress (`egress.spec`) | A path that isn't allowed holds the deploy and shows the rule it breaks. Personal data is taken out before anything goes to a model |
| C-5 | Approvals | Done (records) · Simulated (effects) | `/governance/approvals` (screen 11) (`approvals.spec`) | One queue for apps, Live deploys, pushes, tokens, Live keys and cap raises. Approving unblocks what asked, and every decision records who, when and why |
| C-10 | Agent permission modes | Simulated (+ Doc) | Governance › Permission rules; Approvals › Rules (`rules-budgets-keys.spec`) | Live deploys, pushes and Live keys need an approval or a matching allow-rule. The same rules apply to coding agents (`/docs/mcp`) |

## Also asked for in M5

| Item | Status | Where |
|---|---|---|
| BL-17 Human support path: a ticket ID on "Talk to a person" | Done | Help: "Ticket #N is open, with this conversation attached" |
| F9 Move an Architect 1.0 app to 2.0 | Simulated (the 1.0 app) · Done (the import) | Projects: "Ticket triage (Architect 1.0)" › Move to 2.0 → Import with its repo chosen |
| Data tab edits are labelled | Done | Data tab: "Simulated · changes aren't saved" beside Add a row |
