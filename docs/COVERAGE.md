# Coverage: every Must in the PRD

Every **Must** row in section 8 of `docs/product/08-PRD-architect-2.md`, checked against the prototype on 10 Oct 2026 (M5) and again on 11 Oct after the gap analysis (`reviews/m5-gap-analysis-2026-10-11.md`).

- **Done**: it works for real.
- **Simulated**: it works end to end in the interface, but the infrastructure behind it is scripted, and it carries the `Simulated` tag.
- **Doc only**: it's written down and not built.
- **Partly**: the gap is stated in the row.

Where the prototype differs from the spec, `docs/DECISIONS.md` says what and why. The browser tests named here are in `test/e2e/`.

## Baseline (BL)

| ID | Requirement | Status | Where to see it | Notes |
|---|---|---|---|---|
| BL-1 | Sign in (Google, GitHub, email); workspaces and roles | Done | `/login`; Settings › Members (`auth.spec`, `invites.spec`) | All three sign-ins and the roles of section 9 work. Supabase Auth's "Time-box user sessions" is 0 (checked by Netanya, 10 Oct): sessions don't expire on a timer, so they last at least the 7 days asked for, until sign-out |
| BL-2 | Home: one composer (prompt, files, repo import, template, "Help me decide") | Done | `/home`; `/home/decide` (screen 14); templates dialog (screen 15); Add files, agents or tools › Attach a Lyzr Studio agent (`m5-followup.spec`) | Help me decide asks three questions and the gateway (real) returns three ideas. Attach agent lists Studio's agents for real (`GET /v3/agents/`; sample agents, tagged Simulated, without a key), and the plan uses an attached agent as a part. Files: PDFs, CSVs and images. Voice input isn't carried yet: the mic says so |
| BL-3 | Model choice upfront, bring your own key | Done · Simulated (keys) | The model pill on Home and in chat; Governance › Models | Only allowed models are listed. A model that was disallowed shows "This model is no longer allowed · Switch" and is never switched silently. Claude and GPT are real with a key, otherwise Gemini answers and they're tagged Simulated. The own-key setting is a flag only |
| BL-4 | Chat with plan and execute modes; message queue | Done | Chat pane: Talk first, change cards, the queue (`plan.spec`) | Talk first can't change the plan. Queued messages run in order, and each has Edit, which puts it back in the composer. Running tests in plan mode (a Should) isn't built |
| BL-5 | Live build view | Simulated | Build stage (screen 3) (`build.spec`) | Every step names its part, replayed from the run's events on the database clock |
| BL-6 | Live preview: device sizes, click-to-edit, console | Simulated | Preview dock: sizes, Point at something, N problems (`build.spec`) | Point at something attaches the element to chat. The console's errors each have Fix with AI |
| BL-8 | Agent section: graph, inline edit, test playground, traces | Done (Try it, sync) · Simulated (tools, sample runs) | Agents tab (screen 9) (`agents.spec`) | Try it runs each agent on Lyzr Studio for real, and Save updates the Studio agent |
| BL-9 | Connections hub (OAuth, MCP, API keys) | Done (GitHub) · Simulated (other apps, API keys) | `/connections` (Add an API key); Connect on the part; Governance › Apps (MCP servers) (`m5-followup.spec`) | Shows connected, expired or missing, and a missing one marks its parts "Needs connection". An API key is recorded only as Set or Not set, by whom and when: the value is checked and thrown away. Scopes and who may connect follow the app policy |
| BL-11 | GitHub two-way, in the user's org | Done (connect, list, read) · Simulated (PRs, sync) | Settings › GitHub; Import; PR cards (`pull-requests.spec`, `f3-import-to-pr.spec`) | Changes arrive as a branch and a PR into the user's own repo, and nothing is created in a Lyzr org. Real PRs weren't built (Netanya's call, 9 Oct) |
| BL-12 | Environments, promote, rollback, custom domain | Simulated | Launch (screen 4) (`launch.spec`, `launch-fast.spec`) | Test, Team and Live, go back, custom domain and Take offline. Data and keys are per version (Data tab; Keys and passwords) |
| BL-13 | Pre-publish checks | Simulated | Launch checklist | Deploy is held while a must-fix is open: connections, sample data, blocked parts, data a policy doesn't allow to leave, keys missing for Live, calls with a key waiting for an admin. Each row names its part and its fix. The checks that passed are named: Tests passed, Security scan passed, Personal data is hidden in logs |
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
| A-7 | Proof per item, never self-graded | Simulated | Part drawer: the check, written before the code (with the time); proofs; Edit the check (`m5-followup.spec`) | Only the checker marks a part Works, and the builder can't change a check. That holds for a coding agent's change and for a code edit in Developer view. A person can edit a built part's check: the cost shows first, then Re-run the check · ~N credits runs it against the code already built |
| A-8 | Honest data state | Simulated | "using sample data" on the part, in the preview and on Launch | |
| A-9 | Fix-loop guard | Simulated | Blocked after 3 fixes (screen 6); Fix lines in Usage | No fix runs past the budget, or past the org cap |
| A-10 | Readiness view | Simulated | The stepper's progress and Not done · N; the Plan panel; Launch's What's not done and checklist (`m5-followup.spec`) | Each part that doesn't work is listed with its reason, on the stepper and on Launch before every deploy |

## Open and developer (B)

| ID | Requirement | Status | Where to see it | Notes |
|---|---|---|---|---|
| B-1 | Import a repo | Done | `/import` (screen 10) (`import.spec`) | The GitHub App reads only the repos the person chose; no `repo` OAuth scope. Branch and folder can be chosen |
| B-2 | Understand on import → Blueprint from repo | Done (analysis, plan) · Simulated (test runs) | Import › Understand it; the plan from the repo | The summary lists stack, how it runs, keys, tests and agents. Existing tests become proof on the matching parts |
| B-3 | Run as it is | Simulated | Import: Configure or Port when the stack isn't Node or Python | Nothing is ported without consent |
| B-4 | Changes as PRs | Simulated | PR card in chat; Developer view header | Each build, change or code edit goes on a branch and a PR listing its parts. A push to main needs a click, and an approval under the rule |
| B-6 | Agents in other frameworks run natively | Simulated | Agents › Settings › Runs on (Lyzr Studio, CrewAI, LangGraph) | Imported CrewAI and LangGraph agents keep their framework, and any agent can be set to run on one. Try it is answered by Gemini for them (tagged) |
| B-7 | Bring your own coding agent | Simulated (+ Doc: `/docs/mcp`) | Project settings › Coding agents; `?sim=byoagent` (`coding-agent.spec`) | Lines read "Coding agent: Claude Code (Sam) · via MCP". Marking Works and deploying without approval are both refused, as they would be for Architect's own agent |
| B-8 | Default stack for new projects | Simulated | "Stack: Next.js + Python (Lyzr SDK) + Postgres + sign-in, the default for new projects" on the plan | Also on Import and in a new project's README |
| B-9 | Developer view | Simulated (code) · Done (an imported repo's real files) | `?dev=1` (screen 8) (`dev.spec`, `code-edits.spec`) | Changes by part, file tree, editor (edits re-run the part's check), terminal, Activity. Download code is in ⋯ |

## Governance (C)

| ID | Requirement | Status | Where to see it | Notes |
|---|---|---|---|---|
| C-1 | Deployment location | Simulated (+ Doc) | Governance › Where it runs (`governance.spec`) | Lyzr Cloud or the customer's AWS VPC, with a picture of where each part runs. Dedicated region and on-prem are shown but disabled, with the reason. Launch says where the app runs |
| C-2 | Model policy | Simulated | Governance › Models | Allowed models, Architect's model, the default for app agents, and a registered private model (answered by Gemini, tagged) |
| C-3 | Connection policy | Simulated | Governance › Apps and MCP servers | An app not on the list puts its part in Needs approval and files a request. Scopes, who may connect, and the MCP servers offered in agent tools |
| C-4 | Data egress policy and data-flow view | Simulated | Launch › Where data goes; Governance › Data and egress (`egress.spec`); seeded Lead scorer, held on api.hubapi.com | A path that isn't allowed holds the deploy and shows the rule it breaks. Personal data is taken out before anything goes to a model. Approving an app can allow its host for data in the same step (ticked by default) |
| C-5 | Approvals | Done (records) · Simulated (effects) | `/governance/approvals` (screen 11) (`approvals.spec`) | One queue for apps, Live deploys, pushes, tokens, Live keys and cap raises. Approving unblocks what asked, and every decision records who, when and why |
| C-10 | Agent permission modes | Simulated (+ Doc) | Governance › Permission rules; Approvals › Rules; Launch (`rules-budgets-keys.spec`, `m5-followup.spec`) | Live deploys, pushes, Live keys and **external calls with a key** need an approval or a matching allow-rule. Coding agents ask for every one of them through `request_approval` and never do them themselves; `?sim=byoagent` shows all four refusals and writes them to the audit log (`/docs/mcp`) |

## Also asked for in M5

| Item | Status | Where |
|---|---|---|
| BL-17 Human support path: a ticket ID on "Talk to a person" | Done | Help: "Ticket #N is open, with this conversation attached" |
| F9 Move an Architect 1.0 app to 2.0 | Simulated (the 1.0 app) · Done (the import) | Projects: "Ticket triage (Architect 1.0)" › Move to 2.0 → Import with its repo chosen |
| Data tab edits are labelled | Done | Data tab: "Simulated · changes aren't saved" beside Add a row |

## From the gap analysis (11 Oct): today's Architect, and the demo

| Item | Status | Where | Notes |
|---|---|---|---|
| Attach existing Studio agents | Done (the list) | Home › Add files, agents or tools | See BL-2 |
| Agentlets marketplace | Simulated (listing) | `/marketplace`: each card says "Use as a starting point" and opens Home with its prompt | Publishing your own is simulated |
| Prompt library | Done | Templates and prompts › Prompts (screen 15) | |
| Plan-stage app mockup and workflow | Simulated | Before Build: Plan · Mockup · Workflow | Mockup is the preview shell from the plan; Workflow is the Agents graph. Nothing is built |
| Theme engine and presets | **Not built** | — | The workspace has Light and Dark for Architect itself; presets for the app's own look (screen 5) aren't built |
| PDF into a knowledge base; CSV into a data agent | Simulated | Home › Add files; the plan; Agents | A PDF adds "Knowledge base from <file>", a CSV "Data analyst for <file>", when the plan doesn't already use the file. Excel: export as CSV |
| Duplicate an app | Done | ⋯ › Duplicate, in the project and on Projects (`workspace.spec`) | Built in M1 |
| Plans and billing; badge removal | Simulated | Settings › Plan; Launch › Show "Built with Architect" | Free, Starter, Pro, Enterprise; no payment. Paid plans can hide the badge. The seeded demo is on Enterprise |
| Credits per app and last used | Done | Projects: "Owner · edited when · N credits" on each row | |
| App analytics | Partly | Launch › Built-in analytics (a setting) | The setting is saved; there's no visitors view yet |
| Voice input | Not carried yet | The mic on Home says so | |
| Demo: an egress block | Simulated | Seeded Lead scorer, held on api.hubapi.com | |
| Demo: a key missing for Live | Done | Import netanyaj/ticket-triage, build, Launch: ZENDESK_WEBHOOK_SECRET (`f3-import-to-pr.spec`) | From the repo's real `.env.example` |
| Demo: the coding-agent audit filter | Simulated | `?sim=byoagent`, then Governance › Audit log › Coding agent | |
