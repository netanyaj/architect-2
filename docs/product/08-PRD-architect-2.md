# PRD: Architect 2.0

_Owner: Netanya Jaison · Draft v5 · 2026-10-03. Live prototype: [architect2-netanya.vercel.app](https://architect2-netanya.vercel.app) · Repo: [github.com/netanyaj/architect-2](https://github.com/netanyaj/architect-2) · Architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md). Supporting material: Appendix E._

**At a glance**
1. **One prompt becomes a full Blueprint (the app's PRD), and one click builds all of it.** The Blueprint always comes first, with defaults filled in and costs shown; nothing is built until the user clicks Build.
2. **The Blueprint is the core**: every request becomes plain-language items, each with an automatic proof, a cost estimate before work and the actual cost after.
3. **Open by default**: import your repo, get changes as PRs, and bring your own coding agent through MCP; app agents stay in Lyzr Studio.
4. **Governance is an enterprise layer** in the same app, with deployment in the customer's own cloud as Lyzr's enterprise unlock.
5. **Fix attempts are billed but capped and visible**; estimates include them and fixing pauses after 3 failed attempts.


## 1. Summary
**Architect 2.0 turns one prompt into a working agentic app you can trust: what you asked for, proven working, at a known cost, on infrastructure you control.**

| Layer | What it is | Who it serves |
|---|---|---|
| **Baseline** | What any modern AI app builder must do, working as promised: prompt → app, auth and database, live preview, click-to-edit, GitHub, connections, environments, deploy, model choice, cost controls | Everyone (parity with Lovable, Replit, v0) |
| **A. Blueprint (core)** | One prompt builds the whole system by default. The request becomes a blueprint of plain-language items, each with a status, an automatic proof, a cost estimate before work and the actual cost after. Nothing is dropped silently | Morgan (business builder); Sam reviews |
| **B. Open by default** | Import a real repo (Node and Python run as they are in v1), agents in other frameworks, changes as PRs to the user's repo, and the user's own coding agent (Claude Code, Cursor, Codex) through Architect's MCP server and CLI | Sam (builder-engineer) |
| **C. Governance layer (enterprise)** | Switched on when an enterprise adopts Architect: where it runs (Lyzr Cloud, the customer's own cloud account (VPC), or on-prem), allowed models and connections, data egress, approvals, audit. Same app, same UI | Org admins (IT, security) and the enterprise buyer |

**Product principles**
1. **One prompt, whole system, your call.** One prompt produces the complete Blueprint; one click builds every item. The user always sees and can edit the plan before anything is built or spent.
2. **Say what you'll do, show what you did.** Every promise is a blueprint item that ends with proof or a stated reason.
3. **Never silently drop, switch or simulate.** Scope changes, model changes and sample data are always visible.
4. **Cost before commitment.** Estimates before paid work; fixes shown separately.
5. **Same truth, different depth.** One project, one blueprint, one repo; builders and engineers get different views, not different systems.
6. **Open by default.** Your repo, your stack, your coding agent, your cloud.
7. **Governed by design.** Policy is checked on every action; approvals are part of the flow.

## 2. Problem
AI app builders produce impressive first demos, but users can't tell whether the app does what they asked, what it will cost, or how to hand it to engineering and IT to run for real. So AI-built apps stay demos: business builders drift to cheaper prototyping tools, and the enterprise buyer, Lyzr's market, bans them.

| Pain | Evidence |
|---|---|
| **Intent gets lost** | In our Architect test, six questionnaire clicks turned a detailed meeting-prep prompt (Calendar, Gmail, Slack, a PDF) into a generic research tool, with no warning. Users write specs in ChatGPT first to protect their credits |
| **Can't tell what's real, ready or what it costs** | Architect runs on sample data by default and shows cost only afterwards. Cost was the most frequent complaint in forum posts we coded (about 20 of 60); fix loops are a recurring cause |
| **Developers can't keep working on their own code** | Architect rebuilds imports in its own template and couldn't push a branch to the user's repo. Power users route around builders with their own coding agents |
| **Control is all or nothing** | Models are chosen only after planning, integrations are guessed, and agents are edited in a separate product |
| **Enterprises can't govern AI-built apps** | 93% of tech and security leaders are concerned and 8% have strong governance (Retool, State of AI Governance 2026, n = 307). Architect has enterprise plumbing (tenants, SSO, a VPC option) but shows none of it |

_Sources: our audit of Architect ([`docs/research/02`](../research/02-architect-today.md), [`04`](../research/04-import-audit.md)), forum and survey research ([`07`](../research/07-secondary-research.md)). The forum sample is complaint-biased, so it ranks problems rather than sizing them._

## 3. Market context
**Why now**
- The pain has moved from "can it build?" to "can I trust and run it?": readiness, cost and handoff complaints dominate 2026 forums.
- Repo-native building is now expected (v0 has imported any repo and opened PRs since February 2026), so "rebuild in our template" is a liability.
- Enterprise demand is ahead of tooling: 55% of leaders want one central platform to govern AI-built apps (Retool 2026).

**Competitors**
| Product | Why people pick it | Gap we target | Why the gap persists for them |
|---|---|---|---|
| Lovable | Polished full-stack apps fast; strong enterprise admin | No import; no proof per requirement; no self-hosting | Built around its own React + Supabase stack and its cloud |
| Replit | Any language; plan mode; cost confirmation and budgets | Plan is not linked to proof; no sovereign deployment | General-purpose IDE, not agent-first |
| Emergent | Multi-agent builder, mobile | Fix loops drain credits; thin governance | Optimised for speed to first demo |
| v0 | Any repo, branch per chat, PRs | Few agentic features; Vercel cloud only | Front-end and Vercel-centric |
| Cursor / Codex / Claude Code | Agents in your own repo, full control | No hosting, managed integrations or business-user view | Developer tools by design |
| Architect today | Agents built in (Lyzr Studio) | Drops intent, sample data by default, no push to user repos | Prototyping engine; hardening left to Studio |

**Wedge, moat and unlock**
- **Wedge:** proof per item. It wins the first build, but a competitor could copy it within a quarter.
- **Moat:** what Lyzr already has and app builders don't: a production agent runtime (Studio) shared with Architect, so built apps run real agents from day one, and enterprise distribution through Lyzr's existing customers.
- **Enterprise unlock:** deployment in the customer's own cloud or data centre with their own models. Cloud-only builders can't offer this without re-architecting, and it is what turns a team's adoption into an enterprise contract.

## 4. Goals and non-goals
| # | Goal | Measure (targets in section 10) |
|---|---|---|
| G1 | Users get what they asked for, proven, and keep using it | North Star (confirmed blueprints proven within 7 days), paired with apps still used at 30 days |
| G2 | Nothing is silently dropped or simulated | Zero silent drops; zero Production deploys on sample data |
| G3 | Cost is predictable | Estimate error per blueprint; no item exceeds 3 fix attempts without pausing |
| G4 | Developers keep working on their own project | Imported repos running as they are; changes delivered as PRs |
| G5 | Enterprises can adopt it under their own rules | Time from signed deal to first governed production app; a VPC design partner |

**Non-goals (v1)**
| Non-goal | Why it's out |
|---|---|
| Native mobile app builds (web and installable web apps only) | Separate toolchain and stores; no evidence it's a top pain for our personas |
| Real-time multiplayer co-editing (comments and presence only) | Expensive (real-time merge of simultaneous code edits); the handoff problem is asynchronous |
| Replacing Lyzr Studio | Studio remains the deep agent workbench. Architect embeds what builders need and links out |
| Fine-tuning or hosting custom models | We *route* to self-hosted endpoints; training is a separate product |
| Running every language and framework | v1 publishes a supported-stack list; anything else falls back to an offered port |
| Being a full IDE | Developers keep their own tools; Architect connects to them through MCP, CLI and git |

## 5. Users
Evidence-labelled personas are in Appendix E (`personas/`); none comes from interviews.

| Persona | Job to be done | Top needs | Switches from |
|---|---|---|---|
| **Morgan, business builder** (ops, consulting, PM) | "Get a working agentic tool on our real systems without waiting for engineering" | Everything in one go; certainty about what's real; no surprise bills; easy handoff | Lovable, Replit, Emergent, spreadsheets |
| **Sam, builder-engineer** | "Use AI speed on our codebase without losing control" | Their repo and stack; PRs and tests; choice of model and agent framework; their own coding agent | Cursor, Claude Code, Codex, v0 |

**Main journey:** Morgan builds → Sam adopts and extends (F8) → it goes live → it is maintained.

**Enterprise governance is a layer, not a third persona.** When an enterprise adopts Architect, an org admin role (IT or security) sets deployment location, models, data controls and approvals inside the same app, and Morgan's and Sam's work flows through those rules. It is shown as a simulated flow in the prototype.

## 6. User stories
**Morgan (business builder)**
1. As a business builder, I want one prompt to produce the whole app (screens, agents, integrations, data), and to be asked only questions that genuinely block it, so that I get a working system rather than pieces to assemble. *(A-0, A-2)*
2. As a business builder, I want to know what will be built and what it will cost before spending, and for spending to stop at my budget or after repeated failed fixes (keeping finished items), so that cost never surprises me. *(A-1, A-4, A-9, BL-14)*
3. As a business builder, I want to be told when a choice removes something I asked for, so that nothing I need disappears silently. *(A-3)*
4. As a business builder, I want each feature marked as proven, on sample data or needing a connection, with the build carrying on past a missing connection, so that I never demo something fake by accident. *(A-6 to A-8, A-10, BL-9)*

**Sam (builder-engineer)**
1. As an engineer, I want to import our repo and have it run in its own stack, or be told why not and offered a choice, so that I keep working on our code instead of a rewrite. *(B-1 to B-3)*
2. As an engineer, I want every change to land as a PR on our repo, linked to the items it implements, so that I can review it like any other change. *(B-4)*
3. As an engineer, I want to use my own coding agent (Claude Code, Cursor) on an Architect project through MCP, so that I keep my tools and still get Architect's runtime, connections and hosting. *(B-7)*
4. As an engineer, I want our existing CrewAI or LangGraph agents to run as they are, so that I don't rewrite working agents. *(B-6)*

**Org admin (governance layer)**
1. As an org admin, I want to set once where Architect runs and which models and connectors are allowed, so that company data stays in our environment without reviewing every app. *(C-1 to C-3)*
2. As an org admin, I want Production deploys, new connectors and coding-agent tokens to come to one approval queue under the same rules for every agent, so that nothing risky goes live without sign-off. *(C-5, C-10, B-7)*
3. As an org admin, I want to see where each project's data goes, so that I can block leaks before deploy. *(C-4)*

## 7. Core concepts
| Object | What it is |
|---|---|
| **Project** | One app: blueprint, repo, agents, environments |
| **Blueprint** | What Architect commits to deliver: an ordered list of items plus open decisions. It is not the prompt: the prompt is what you said; the blueprint is what will be built, how each part is proven and what it costs. Stored in `architect/blueprint.yaml` and the database |
| **Item** | One promise in plain language, e.g. "Brief includes the last email thread with the attendee", with a type (feature, integration, agent, data, quality), status, proof, cost estimate and actual, and the prompt text it came from |
| **Item status** | `Proposed → Agreed → Building → Built ✓ / Sample data / Needs connection / Needs approval / Failed check / Deferred / Dropped (reason)`. Items become Agreed when the user clicks Build |
| **Project store** | Persistent storage for everything about a project (blueprint, files, context, chat) from the first prompt, before any repo exists |
| **Repo** | The user's own repo, imported or created in their org. Optional until connected |
| **App agent** | An agent that runs inside the built app (role, tools, model, guardrails). Lives in the Lyzr Studio registry shared with Architect; Lyzr is the default runtime, CrewAI and LangGraph also run natively |
| **Coding agent** | An AI that writes the app's code: the **Architect agent** (Architect's own), or the user's (Claude Code, Cursor, Codex) connected through MCP (Model Context Protocol, the standard way coding agents connect to tools). Coding agents build app agents; they are not stored in Studio |
| **Connection** | An authorised integration (OAuth, API key or MCP server), scoped per project |
| **Environment** | Preview, Staging or Production, each with its own data, secrets and URL |
| **Run** | One unit of agent work (plan, build, fix, test) with model, cost and who started it (user, fix, coding agent) |
| **Policy · Approval** | Org rules (models, connections, data leaving the environment (egress), approvals, budgets, location) and the recorded decisions they trigger |

## 8. Requirements
Priority: **Must** (v1 isn't viable without it) · **Should** (fast follow) · **Could** (if time allows). Prototype fidelity: **Real** (working) · **Sim** (scripted flow) · **Doc** (documented only). Everything today's Architect does is kept (Appendix A); non-functional targets are in Appendix B.

### 8.1 Baseline
| ID | Requirement | Acceptance criteria (summary) | Pri | Proto |
|---|---|---|---|---|
| BL-1 | Sign in (Google, GitHub, email); workspaces and roles | All three sign-ins work; sessions last 7 days; roles as in section 9 | Must | Real |
| BL-2 | Home: one composer (prompt, files, repo import, template, "Help me decide") | Every way of starting a project begins from one composer; recent projects listed | Must | Real |
| BL-3 | Model choice upfront, bring your own key | Runs use the selected model; only allowed models listed; failover goes only to models the organisation's policy pre-approves as fallbacks, and is always announced | Must | Real |
| BL-4 | Chat with plan and execute modes; message queue | Plan mode can't write or deploy; queued messages run in order and can be edited | Must (plan mode running tests: Should) | Real (chat → proposed changes) / Sim (execution) |
| BL-5 | Live build view | Every step names its blueprint item; updates within 2 s | Must | Sim |
| BL-6 | Live preview: device sizes, click-to-edit, console | Element selection attaches to chat; console errors shown within 2 s | Must | Sim |
| BL-7 | Checkpoints per completed item | Restoring reverts code and resets later item statuses | Should | Sim |
| BL-8 | Agent section: graph, inline edit, test playground, traces | Edit an app agent without leaving Architect; edits sync to Studio | Must | Sim |
| BL-9 | Connections hub (OAuth, MCP, API keys) | Each shows connected / expired / missing; missing ones mark items "Needs connection" | Must | Real (GitHub) / Sim |
| BL-10 | Database and auth for built apps | Data tab views and edits rows; SSO toggle works | Should | Sim |
| BL-11 | GitHub two-way, in the user's org | Changes arrive as branches and PRs; no repo is created in a Lyzr-owned org | Must | Real (connect, list) / Sim |
| BL-12 | Environments, promote, rollback, custom domain | Separate data and secrets per environment; rollback in under 2 minutes | Must | Sim |
| BL-13 | Pre-publish checks (tests, security and personal-data scan, secrets, sample data) | Deploy blocked while a must-fix finding is open; each finding names its item and fix | Must | Sim |
| BL-14 | Cost controls and budgets | No paid build or change starts without an estimate and the user's click; alert at 80%, stop at 100%; build and running cost shown separately | Must | Real (estimate) / Sim |
| BL-15 | Sharing and roles | Invite with a role; Viewers can comment but not build | Should (invites: Must) | Sim |
| BL-16 | App analytics | Visitors, agent runs, errors and running cost for 30 days | Could | Doc |
| BL-17 | Human support path | Any error state can request a human and gets a ticket ID | Could | Doc |

### 8.2 A: Blueprint (core)
Why proof per item: users don't ask for "proof" by name, but they keep asking whether an AI-built app is real and ready. Examples from our research: a r/lovable post asking "how did you know it was ready for real users?", community checklists of failure tests to run before taking payments, and builders who get "70% there" and can't tell what's missing. In our own Architect test, a finished-looking app was running on sample data. Proof per item is our answer; the beta validates it (open question 7).

| ID | Requirement | Acceptance criteria | Pri | Proto |
|---|---|---|---|---|
| A-0 | **Blueprint first, build on your click.** A prompt produces the full Blueprint (the app's PRD): items, defaults applied to every question, per-item estimates and the total. It streams in and is readable and editable straight away. Nothing is built until the user clicks **Build · ~N credits**; after that one click every item is built without further prompting | The Blueprint for a prompt appears within 60 s and shows every item, the defaults chosen and the total; no build, fix or paid step starts before the user clicks Build, whatever their budget settings; the user can edit any item, default or question before clicking. Every question has a recommended default, already applied in the Blueprint; a **blocking** question (its default would remove or weaken an item the prompt asked for (A-3), or it needs an input with no safe default, such as which Slack workspace) must be answered before Build is enabled | Must | **Real** (Blueprint + defaults + Build gate) / Sim (build) |
| A-1 | **Prompt → draft blueprint.** Parse the prompt (and attachments) into Items grouped as Features, Data, Integrations, Agents, Quality | On a fixed set of 20 test prompts with reviewer-marked requirements, ≥ 95% of marked requirements map to an item; every item shows the prompt text it came from | Must | **Real** (LLM) |
| A-2 | **Questions generated from the blueprint**, not a generic form | Every question names the items it affects and has a recommended answer; at most 5 questions per blueprint; no question is asked whose answer wouldn't change any item; each question is marked defaulted or blocking, and only blocking ones hold the Build button (A-0) | Must | **Real** (LLM) |
| A-3 | **Conflict guard.** If an answer, default or plan change removes or weakens an item, show a decision card: "Your prompt asked for X. This removes it. Keep / Defer / Drop (reason)" | No item leaves the blueprint without a recorded Keep / Defer / Drop decision; Dropped items stay visible with their reason. A default that would remove an item becomes a blocking question that must be answered before Build | Must | **Real** (diff logic) |
| A-4 | **Per-item estimate** (method in section 11) | Each item shows a credit range, a time range, a confidence level and its main cost driver; the total appears before the build starts; deferring an item updates the total immediately | Must | **Real** (estimate model) |
| A-5 | **Blueprint versions** | Starting a build saves the blueprint as a numbered version; any later change creates a new version; the user can compare any two versions and see items added, changed and removed | Must | Real (DB) |
| A-6 | **Live status during the build**: Building → Built ✓ / Needs connection / Failed check | Status changes appear in the build view within 2 s; each Built ✓ item links to its proof | Must | Sim |
| A-7 | **Proof per item, fully automatic, never self-graded.** (1) **Check before code:** each item's check is written from the Blueprint item when the Blueprint is agreed, before any code exists. (2) **Separate verifier:** a verifier agent, separate from the builder and without access to its reasoning, writes and runs the checks. (3) **Deterministic first:** API and UI tests (with screenshots), type checks, HTTP status and agent eval samples wherever possible. A rubric-based AI review is used only for qualities no test can capture (e.g. "the brief reads clearly"). No item waits for a human sign-off | Every item's check exists and is timestamped before its build starts; the builder can't edit a check; an item can be marked Built ✓ only with a passing check attached, and the check type is shown; otherwise it shows Failed check with the reason; the user can open any proof but is never asked to approve one. If the user disagrees with a result, they **edit the item** (its wording or its check); that re-runs the build and check for that item as a user change, with an estimate first | Must | Sim |
| A-8 | **Honest data state.** Sample data is per item and labelled in the app and the blueprint | Any item running on sample data shows a banner in the preview ("Running on sample data: connect Gmail to go live") until resolved; the pre-publish check flags it | Must | Sim |
| A-9 | **Fix-loop guard** (fixes are billed; see section 11) | Each item's estimate includes an expected allowance for fixes; fix runs are labelled "Fix" and shown as a separate line in Usage; after 3 failed fix attempts on an item, the build pauses on that item and offers Edit item or Defer; no fix attempt runs past the user's budget | Must | Sim (billing UI) |
| A-10 | **Readiness view** | Shows X of Y items Built ✓ with proof, Z needing action, and a "What's not done" list with the reason per item; visible on the project and before every deploy | Must | Sim |
| A-11 | **Iteration via blueprint** | A chat request after the first build becomes new or changed items with estimates before any work starts; no change starts until the user applies it | Should | Real (proposal) / Sim (build) |
| A-12 | **Blueprint export** | The owner can create a read-only link showing every item, its status and proof; the link works without sign-in and can be revoked | Could | Doc |

### 8.3 B: Open by default
| ID | Requirement | Acceptance criteria | Pri | Proto |
|---|---|---|---|---|
| B-1 | **Import a repo** (any language can be imported and analysed; Node and Python run as they are in v1) through a GitHub App installed on chosen repos only; branch and subfolder | The install grants access only to the repos the user selects; the full `repo` OAuth scope is never requested; branch and subfolder can be chosen | Must | **Real** (connect, list, read tree) |
| B-2 | **Understand on import** → a **"Blueprint from repo"** (current behaviour as items, with tests as proof where they exist) | The import summary lists the stack, how it runs, the secrets needed, the tests and the agents found; existing tests appear as proof on the matching items | Must | **Real** (static analysis + LLM) / Sim |
| B-3 | **Run as it is** in the sandbox with the detected run commands; porting to the default stack is **optional** | For a repo on the supported-stack list, the preview runs the user's own stack; otherwise Architect says why and offers "configure" or "port"; nothing is ported without consent | Must | Sim |
| B-4 | **Changes as PRs** | Each session or item produces a branch on the user's repo and a PR whose description lists the items it implements; tests run on the PR; nothing is committed to the default branch directly; a push needs user approval | Must | Sim (Real optional) |
| B-5 | **Two-way sync** | A commit pushed to the tracked branch outside Architect appears in the project within 1 minute; checks for affected items re-run and statuses update | Could | Sim |
| B-6 | **Agents in other frameworks run natively** behind one standard agent interface (I/O schema, tools, guardrails, traces). v1: Lyzr (default), CrewAI and LangGraph; more frameworks later; conversion is optional | An imported CrewAI agent runs in the sandbox without conversion and appears in the Agents section with traces; a new agent can be created in Lyzr, CrewAI or LangGraph | Must | Sim |
| B-7 | **Bring your own coding agent**: MCP server plus CLI with scoped project tokens. Tools: `get_blueprint`, `update_item`, `run_in_sandbox`, `run_tests`, `open_pr`, `request_approval`, `get_preview_url` | Claude Code connected with a project token can read the blueprint, run tests and open a PR; its runs appear in the activity log as "Coding agent: Claude Code (Sam)"; an attempt to deploy without approval is refused just as it would be for Architect's own agent | Must | Sim (+ Doc: MCP tool spec) |
| B-8 | **Default stack for new projects**: Next.js + Postgres + auth, in the user's org | New projects without a repo use the default stack, and the blueprint says "Stack: default" | Must | Sim |
| B-9 | **Developer view**: file tree, editor, diffs per item, terminal, logs, env vars | The same project can be opened in developer view with no export; a diff can be viewed per blueprint item | Must | Sim |

### 8.4 C: Governance layer (enterprise; simulated in the prototype)
Switched on per organisation. Admins get a Governance area; everyone else sees its effects ("Needs approval", allowed models only).

| ID | Requirement | Acceptance criteria | Pri | Proto |
|---|---|---|---|---|
| C-1 | **Deployment location** (per org): Lyzr Cloud / Dedicated region / **Customer VPC** / **On-prem or air-gapped** | The admin sees where each component runs (Architect agent, its model, sandboxes, agent models, data, deployed apps) for the chosen location; in VPC and on-prem modes every component, including the Architect agent's model, can run inside the customer's environment. v1 ships Lyzr Cloud and customer VPC on AWS; dedicated regions, Azure, GCP and on-prem or air-gapped follow (section 14) | Must | Sim (+ Doc) |
| C-2 | **Model policy**: allowed providers and models, covering both the **organisation's own trained models** and **open-source models hosted in its environment**, as well as commercial APIs; applies to the Architect agent's model and to app agents; default per role; bring your own key | Model pickers for the Architect agent and app agents show only allowed models; an admin can register a private endpoint (own model or self-hosted open-source) and set it as the Architect agent's model, the agent default, or both | Must | Sim |
| C-3 | **Connection policy**: approved connectors and MCP servers; who can add them; scopes | A non-approved connector puts its item in "Needs approval" and creates an approval request | Must | Sim |
| C-4 | **Data egress policy and data-flow view** | When a project would send data to a destination not on the org's allow list (model, connector or host), deploy is blocked and the data-flow view highlights that path and the rule it breaks; PII redaction rules apply before data leaves | Must | Sim |
| C-5 | **Approvals**: rules → approver queue → recorded decision | Requests from rules (production deploy, new connector, external-agent token, budget over X) appear in one queue; approving unblocks the item or PR; every decision records who, when and why | Must | Sim |
| C-6 | **Audit log** | Every run, change, approval and data access is logged; filterable by project, user and agent (Architect's or a user's coding agent); exportable as CSV | Should | Sim |
| C-7 | **Budgets at org level** | Org admins set caps per team and per project; alerts fire at 80%; paid actions stop at 100% until an admin raises the cap | Should | Sim |
| C-8 | **Tracker-free tenant** | A network capture of a VPC or on-prem tenant's UI shows no requests to third-party analytics domains | Should | Doc |
| C-9 | **Policy as code; single sign-on and automatic user provisioning (SSO/SCIM)** | Policy can be exported and imported as a versioned `policy.yaml`; applying it changes the same settings as the UI and is logged; SSO and SCIM work with Okta and Entra ID | Could | Doc |
| C-10 | **Agent permission modes**: never blanket bypass | Any action that leaves the sandbox (push, deploy, external call with a secret) runs only with an approval or a matching allow-rule; the same rule applies to users' coding agents | Must | Doc + Sim |

## 9. Experience: flows, information architecture and roles
Flows, screens and diagrams are in [10-IA-and-flows.md](../build/10-IA-and-flows.md), an early design document:
F1 Onboard · F2 One prompt → full build → proof → deploy · F3 Import a repo · F4 Bring your own coding agent · F5 Connect an integration that needs approval · F6 Enterprise setup and approval queue · F7 Iterate after launch · F8 Hand off from Morgan to Sam · F9 Move an existing Architect app to 2.0.

In every project the Blueprint is a fixed left panel, the canvas (Preview, Agents, Data, and Code and Terminal in Developer view) sits in the centre, and chat sits on the right. Deploy is the only primary button.

| Role | Can do |
|---|---|
| **Owner** | Everything, including billing and deleting the workspace |
| **Admin** | Everything except billing, including Production deploys. With the enterprise layer on, Owners and Admins are the org admins who use Governance |
| **Builder** | Create and build projects; deploy to Preview and Staging; request a Production deploy |
| **Viewer** | Read projects and comment on blueprint items |

Each project also has an owner (its creator by default), who can transfer it to another member or team; this is how Morgan hands a project to Sam (F8).

## 10. Success metrics
Measured from the event log (runs, items, approvals). Baselines are unknown, so targets are hypotheses to recalibrate after month 1.

| Type | Metric | Target | Stretch |
|---|---|---|---|
| **North Star** | Of all blueprints confirmed in a week, the share with ≥ 90% of their items Built ✓ within 7 days, deployed or not (items dropped after confirmation count as not built) | 60% | 75% |
| Companion | Deployed apps still live and used at 30 days | 40% | 55% |
| Leading | Builds that run without the user answering a question | 70% | 85% |
| Leading | Median time from Blueprint shown to Build clicked (long means the Blueprint is hard to read) | < 3 min | < 90 s |
| Leading | Blueprints abandoned before Build | < 30% | < 20% |
| Leading | Median time from prompt to first preview | < 8 min | < 5 min |
| Leading | Imported Node or Python repos running as they are | 70% | 85% |
| Leading | Repo projects with a user's coding agent connected | 10% | 20% |
| Guardrail | Items dropped without a recorded decision; Production deploys with sample data or open security findings | 0 | 0 |
| Guardrail | Check strength: share of a weekly human-audited sample of Built ✓ items that really work | ≥ 95% | ≥ 98% |
| Cost | Median estimate error per blueprint | < 25% | < 15% |
| Cost | Share of build spend on fix attempts, and fix success by attempt number | Falling monthly | |
| Lagging | Repo projects delivering changes as PRs to the user's repo | 90% | 95% |
| Lagging | Time from signed deal to first governed production app | < 30 days | < 14 days |

## 11. Pricing, fixes and estimates
**Pricing.** Credits stay. Tiers: **Free** (small monthly credit) → **Pro** (more credits, custom domains) → **Team** (roles, shared budgets) → **Enterprise** (governance layer, dedicated or VPC/on-prem), priced per governed app per month (a hypothesis; open question 1). Every build starts on one click of Build, which confirms the total; running costs after launch are a separate meter with its own budget.

**Decision: fix attempts are billed like any other agent work.** Deciding whose fault each failure was would turn every fix into a billing dispute and put unbounded cost on the hardest items, so, like Replit, we bill all agent work. What users object to is unpredictable spend, so each estimate includes an expected allowance for fixes, fixes show as their own line in Usage, and fixing pauses after 3 failed attempts on an item. Every run is tagged, so a goodwill credit can be added later if fix spend or support tickets call for it.

**How the build estimate is made (A-4)**
1. Each blueprint item is classified by type and size (for example "integration: read Gmail", "agent: summariser", "screen: list with filters").
2. Its estimate is the historical median of tokens and sandbox minutes for that class, priced at the selected model's rates and adjusted for repo size and the number of integrations and agents involved.
3. An expected fix allowance is added: that class's historical fix rate × the average cost of a fix.
4. The range shown is the 50th to 90th percentile of past actuals; confidence is lower for classes with little history.
5. Before launch, each item class (about 40 at first) is seeded with at least 10 benchmark builds; every real build's actuals then update the model. The separate 20-prompt set in A-1 tests blueprint drafting, not cost.

**Unit economics: one worked example (assumptions, to be replaced by metered actuals in beta)**
A small build of 6 items, using a mid-tier model at an assumed list price of $3 per million input tokens and $15 per million output tokens, with repeated context cached at 10% of the input price:

| Cost line | Assumption | Cost |
|---|---|---|
| Architect agent | 1.0M input tokens (80% cached) and 80k output tokens | ≈ $2.04 |
| Verifier | Assumed 25% of the Architect agent's cost: deterministic checks are cheap, rubric reviews are not | ≈ $0.51 |
| Sandbox | About 20 active minutes; idle time is paused | ≈ $0.05 |
| Fixes | 2 of 6 parts need one fix, each about 30% of that part's Architect agent cost: 2 × 0.3 × ($2.04 ÷ 6) | ≈ $0.20 |
| **Total cost** | | **≈ $2.80** |

At a 2.5× markup (about 60% gross margin) that build is priced at about $7. Today Architect charged about $2.88 for a comparable small build, so either today's builds use far fewer tokens than assumed, or verification forces a price rise or cheaper models for checks. Metering in the beta settles this before pricing is fixed. Enterprise pricing carries the operating cost of deployments in the customer's own cloud.

## 12. Go-to-market
| | Plan |
|---|---|
| **Who first** | Ops, consulting and product teams at mid-size to large companies building internal agentic tools, whose engineers must adopt the result; and Lyzr's existing enterprise customers in regulated industries (banking, insurance, healthcare) |
| **Wedge** | "Get the agentic tool you asked for, proven working, at a known cost." Free tier for builders |
| **Sovereign offer** | For regulated enterprises: Architect, the Architect agent's model and the built apps run in the customer's own cloud or data centre, with their own models and no third-party trackers. Led with the data-flow view ("see exactly where your data goes") and sold through Lyzr's existing sovereign-AI accounts, systems integrators and cloud marketplaces (AWS first) |
| **Motion** | Product-led for builders (Free → Pro → Team); sales-led for Enterprise through Lyzr's accounts and partners. A team that adopts bottom-up becomes the enterprise lead, and the sovereign offer closes it |
| **Launch phases** | 1) Design-partner beta: 5 teams, 2 of them Lyzr enterprise customers, one on AWS VPC. 2) Public beta on Lyzr Cloud. 3) GA with the Enterprise and sovereign tiers |
| **Enablement** | One-click move for current users (F9); demo projects per industry; an IT one-pager on where data goes; MCP and CLI docs for developers |
| **Signals to watch** | First proven deploy, Free → Pro conversion, team invites per project, enterprise and VPC pilots opened |

## 13. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Defaults guess wrong on something important | Defaults are shown in the Blueprint before Build and are editable; a default that removes a requested item becomes a blocking question; checkpoints allow cheap rollback |
| The verifier passes broken work, fails good work, or adds too much cost and time | Deterministic checks first; each item's check runs as soon as that item finishes; weekly human audit of Built ✓ items; users can edit an item or its check |
| Estimates are wrong, which erodes trust | Ranges and confidence shown; actuals update the model after every build; budgets cap the overrun |
| Users still pay for fix loops | Fix allowance in estimates, separate Usage line, pause after 3 failed attempts, budgets |
| Imported repos run untrusted code; prompt injection through repos, documents or MCP servers | Isolated sandboxes with no secrets inside; an egress proxy injects credentials and enforces allowed destinations; content is treated as data; actions leaving the sandbox need approval (C-10) |
| Sovereign deployment is costly, and open-source models running the Architect agent on-prem build worse apps | Same container images in every mode; start with AWS VPC; publish a minimum Architect-agent model bar and allow a commercial Architect agent's model with self-hosted app agents |
| Existing users and apps don't migrate | Today's apps keep running; a one-click move (F9) imports them as a blueprint from their repo |
| Scope is too big for v1 | MVP cut and kill signals (section 14) |

Further risks are in Appendix C.

## 14. Scope, phasing and dependencies
**Phasing** (team estimate: about 6 engineers, 1 designer and 1 PM, building on today's sandbox, harness and Studio; the MVP is sized at roughly 2 quarters because the verifier, cost metering and the VPC deployment are new systems)
| Phase | Scope | Exit criteria |
|---|---|---|
| **MVP, design-partner beta** (about 2 quarters) | Blueprint core A-0 to A-10. Baseline the core loop depends on: BL-1 to BL-6, BL-8, BL-9, BL-12, BL-13, BL-14 and invites from BL-15. Open: B-1, B-4, B-7. Governance: C-5, and C-1 with Lyzr Cloud in quarter 1 and AWS VPC for one partner in quarter 2 | North Star ≥ 50% with 5 design partners; estimate error < 35% |
| **v1 GA** (quarter 3) | Remaining Must items | Section 10 targets; first Enterprise contract |
| **Next** | Should items, two-way sync, GitLab and Bitbucket, Azure and GCP VPC | |
| **Later** | Could items, air-gapped installs, blueprint templates in the marketplace | |

**Kill or pivot signals (end of beta)**
- North Star below 30%: proof per item isn't landing; simplify to readiness checks. Between 30% and 50%: extend the beta and fix the weakest item types first.
- More than 50% of Blueprints abandoned before Build: the Blueprint isn't convincing or is too long to read; simplify it.
- No design partner wants the governance layer: sell Architect without it and keep C on the roadmap.

**Dependencies**
| Dependency | Affects | Risk |
|---|---|---|
| Sandbox images for Node and Python | B-3, B-6 | Medium |
| GitHub App registration | B-1, B-4 | Low |
| Model gateway with per-run cost metering | BL-3, BL-14, A-4, A-9 | Medium: estimates need history |
| Shared Studio agent registry (edits already sync both ways) | B-6, BL-8 | Low |
| Enterprise deployment packaging (VPC, on-prem) | C-1, C-2 | High: start with AWS VPC only |

**What the assignment prototype builds**
- **Real:** auth (Google, GitHub, email); workspaces and projects; Blueprint generation with defaults, questions, the conflict guard and the Build gate, on a real model (Claude, GPT or Gemini) through a model-agnostic gateway; per-item estimates; chat after a build that turns requests into proposed Blueprint changes with estimates; GitHub connect, repo listing and import analysis.
- **Simulated:** build stream, preview, checks and proofs; PRs (optionally real); environments and deploy; coding-agent activity; the whole governance layer (location, policies, approval queue, data-flow view).
- **Documented:** the architecture doc and diagram (sandboxes, harness, model gateway, proxy, GitHub App, deploy, scaling, sovereign modes).

## 15. Open questions
| # | Question | Owner | Needed by |
|---|---|---|---|
| 1 | Enterprise pricing unit: per governed app, per agent, or per seat? | Product + Sales | Before GA |
| 2 | Verifier cost and latency budget per build, measured on real builds | Engineering | Mid-beta |
| 3 | Minimum Architect-agent model quality for on-prem, and how we measure it | Engineering + Product | Before the VPC partner goes live |
| 4 | Migration: do existing `Lyzr-Apps` repos transfer automatically or on request? | Product + Legal | Before public beta |
| 5 | Which stacks come after Node and Python? | Product (from import data) | GA |
| 6 | Support for GitHub Enterprise Server and GitLab for enterprise partners | Engineering | Before GA |
| 7 | Do users value per-item proof itself, or only the readiness summary it produces? No user asked for proof by name; it is our answer to "is it real and ready?" | Product (beta interviews and usage) | End of beta |

---

## Appendix A. Everything Architect does today, kept
The brief requires 2.0 to keep every feature of today's Architect.

| Today's feature | Where it lives in 2.0 |
|---|---|
| Prompt with attachments (PDF/DOCX into a knowledge base, CSV/Excel into a data agent), existing Studio agents attachable | BL-2 composer; attachments feed A-1 |
| AI Consultant ("Help me decide"), Prompt Library, Template Apps, Agentlets (Lyzr's agent marketplace) | BL-2: one composer with these as entry points rather than five separate starts |
| Plan stage: clarifying questions, editable PRD, app mockup, workflow diagram | A-0 to A-5: the blueprint replaces the one-off PRD; the PRD document and mockup stay as views of it |
| Plan and execute modes; message queue during a build | BL-4 |
| Agents stage: real Lyzr agents with tools, knowledge bases, per-agent model and parameters | BL-8, BL-3, B-6 (Lyzr stays the default runtime) |
| QA agent that runs and fixes the code; "Fix with AI" error recovery | A-7 (proof per item), A-9 (fix-loop guard) |
| Live app with console and logs; feature testing | BL-6, A-7 |
| Theme engine and design presets | Kept as is, set from the composer or project settings |
| Postgres with data viewer and schema; auth in generated apps; SSO toggle | BL-10 |
| MCP servers and custom tools added mid-build | BL-9 |
| Environment variables, file tree, download code, duplicate app | B-9 developer view; duplicate and download stay in the project menu |
| GitHub connect, auto-commit, codebase import | BL-11, B-1 to B-4 (now on the user's own repo, running their own stack) |
| Deploy to `*.architect.space` (Netlify today), custom domain, app analytics, publish to marketplace | BL-12 (Deploy drawer, including Publish to marketplace), BL-16 |
| Invite collaborators | BL-15 (now with roles) |
| Credits per app, plans | BL-14, section 11 |
| Enterprise: data isolation, VPC and on-prem | C-1, C-2 (made visible and configurable) |
| Help form and live chat | BL-17 |

## Appendix B. Non-functional requirements (scale, performance, reliability)
What the system must sustain; the how lives in the architecture doc. Lyzr publishes no performance or uptime figures for Architect, so "Architect today" comes from our audit and Lyzr's docs. Targets are v1 hypotheses to recalibrate in beta.

**Platform (Architect itself)**
| ID | Requirement | Architect today | Target for 2.0 | Why this target | Pri |
|---|---|---|---|---|---|
| NFR-1 | Concurrent build sessions | Not published. One sandbox per app, started at planning and kept alive with keepalive pings | 1,000 active build sessions, each with its own sandbox; grows to 10,000 by adding capacity, not redesigning | The brief asks for scaling to thousands of users. Idle sandboxes are paused, so active sessions are a fraction of users; designing for 10× avoids a rebuild later | Must |
| NFR-2 | Sandbox start | Sandbox stays running from planning onward; resume time not measured | Resume a paused project in < 5 s for 95% of resumes (p95); cold start in < 30 s p95 | Pausing idle sandboxes only saves cost if reopening feels instant. Restoring a saved snapshot of a lightweight virtual-machine sandbox makes seconds achievable | Must |
| NFR-3 | Live feedback | Preview has live reload. Build status and credits are polled (~95 and ~52 times in one session) | Preview reflects a saved change in < 3 s p95; build status reaches the UI in < 2 s | The Blueprint promise depends on seeing items turn green as they happen. Pushing over the existing WebSocket is faster and cheaper than polling | Must |
| NFR-4 | Availability | Not published. One preview failed because of a stale platform cache | Control plane 99.9% monthly; a sandbox or model-provider outage affects one project, never the platform | 99.9% (about 43 minutes of downtime a month) is the baseline enterprise buyers expect from SaaS. Outages were a trust complaint in research (`07`) | Must |
| NFR-5 | No lost work | Agent runs inside the sandbox; git commits allow reverts | Project store and Blueprint survive sandbox loss; nothing lives only inside a sandbox | Sandboxes are disposable by design. A crash or pause should cost seconds, never the user's work | Must |
| NFR-6 | Isolation | Multi-tenant config and per-tenant flags exist; isolation guarantees not published | One tenant's load or failure can't slow or expose another tenant's projects | The governance layer and white-label tenants depend on it, and it is a precondition for the VPC story | Must |

**Apps built on Architect**
| ID | Requirement | Architect today | Target for 2.0 | Why this target | Pri |
|---|---|---|---|---|---|
| NFR-7 | Scale-ready by default | Not shown. Lyzr's docs leave production hardening to Studio | Generated apps are stateless (sessions, files and jobs in the database, object storage and a queue); the pre-publish check flags in-memory state | Horizontal scaling only works when no state lives in an instance. Enforcing it when code is generated is far cheaper than refactoring later | Must |
| NFR-8 | Horizontal scaling | Not shown in the product | Production runs at least 2 instances behind a load balancer and autoscales between a user-set minimum and maximum; agent runs go through a queue | Two instances remove the single point of failure. Agent calls take seconds, so a queue absorbs spikes instead of letting them crash the app | Must |
| NFR-9 | Vertical scaling | Not shown | Instance size and database tier can be changed per environment from Deploy settings, without a rebuild | Some workloads (database-heavy, large agent context) scale up rather than out. Keeping it a setting avoids a rebuild | Should |
| NFR-10 | Expected load as a Blueprint item | Not shown | Users can state expected load ("500 concurrent users"); it becomes a Quality item proven by a load test on Staging | Applies the Blueprint principle to scale: a claim the platform proves, not one it assumes | Should |
| NFR-11 | Sovereign deployments | VPC and on-prem claimed in docs; not configurable in the product | The same scaling settings map to the customer's own clusters in VPC and on-prem modes | The governance layer promises the same product wherever it runs | Should |

## Appendix C. Further risks
| Risk | Mitigation |
|---|---|
| The blueprint feels like paperwork to non-technical users | Collapsed to a readiness bar by default; plain language; editing optional |
| Supporting more stacks explodes the support surface | Published supported-stack list; detect early; offer a port as the fallback |
| Users' coding agents bypass quality or policy | Scoped tokens; every write passes policy; PRs required; audit log |
| Personas aren't interview-validated | Assumptions listed per persona; 5 interviews per persona before GA |
| The rubric review used for subjective items favours its own model family | Deterministic checks first; switch the reviewer model if quality metrics show bias |

## Appendix D. Hand-in form answers (draft)
- **Why a non-technical user picks Architect 2.0 over Replit, Lovable or Emergent:**
  - One prompt builds the whole thing: screens, agents and integrations, with no stitching.
  - You see what you'll get and what it costs before you spend.
  - Nothing you asked for disappears silently.
  - Every feature is proven working (or tells you why not).
  - Fix loops can't run away: after 3 failed attempts on an item, Architect stops and asks.
- **Why a technical user picks Architect 2.0 over Claude Code, Codex or Cursor:**
  - Keep your agent and your repo. Architect connects through MCP and the CLI and adds what those tools don't have:
    - a sandboxed runtime for your Node or Python stack;
    - app agents in Lyzr, CrewAI or LangGraph, with traces (more frameworks later);
    - managed integrations;
    - environments and hosting;
    - a governance layer your security team will approve.
  - Business teammates can drive the same project through its blueprint.

## Appendix E. Supporting material
- Document codes used in this PRD (all in [`docs/research/`](../research/)):
  - `02` = [`02-architect-today.md`](../research/02-architect-today.md) (feature audit and test build)
  - `03` = [`03-architect-architecture-today.md`](../research/03-architect-architecture-today.md) (how today's system works)
  - `04` = [`04-import-audit.md`](../research/04-import-audit.md) (repo import and build test)
  - `06` = [`06-competitor-matrix.md`](../research/06-competitor-matrix.md) (products compared), `07` = [`07-secondary-research.md`](../research/07-secondary-research.md) (forum and survey research)
  - Our research synthesis, which ties these together, isn't published.
- Personas: `personas/` (Morgan, Sam, and a reference profile of the org-admin role). IA and flows: [10-IA-and-flows.md](../build/10-IA-and-flows.md). Diagrams: `diagrams/`.
- Today vs 2.0 (scale, performance, reliability, security): `sheets/architect-today-vs-2.0.xlsx`.
