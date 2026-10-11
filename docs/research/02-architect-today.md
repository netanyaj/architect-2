# Architect today: official docs + Netanya's audit

_Sources: Netanya's hands-on audit (2026-10-01), and all 20 pages of the Architect section of docs.lyzr.ai, read in full. The docs are partly stale: they still name GPT-4o, Claude 3.5 Sonnet and Gemini 1.5 Pro, and several features are marked "Soon"._

## 1. What Architect is, in Lyzr's own words
- **"An enterprise-grade Text-to-App platform"** and **"a System Builder"**, not an autocomplete tool. It builds the front end, the agent layer, and the tools/knowledge bases "in a single, deterministic workflow."
- **The core rule:** use it when "intelligence is the product." The test is whether a human does the task with their brain (reading, deciding, summarising, advising, interviewing). Lyzr says it's **not** for static sites, simple CRUD apps, or real-time multiplayer apps.
- **Target user:** "Product Managers, Founders, and Non-Engineering teams" who self-serve internal tools that "sit in backlog for months." The cost claim is about $10 in credits versus $10k+ of engineering hours.
- **Architect is the prototyping engine; Studio is the scaling engine.** Architect gets you to a working app in minutes. Production hardening (switching models, custom authenticated tools, rate limits, observability, governance) happens in **Lyzr Studio**. Architect creates real Studio agents under the hood.

**Netanya's read matches:** "a system builder, not a vibe-coding platform"; "0→1 to a full working prototype is the selling point"; "CustomGPT + n8n + Lovable in one."

## 2. How a build works (docs + audit)
1. **Start**, using one of four entry points:
   - a prompt (the "+" menu can attach files or **existing Studio agents**);
   - the **AI Consultant** ("What should I build?");
   - the **Prompt Library**;
   - **Template Apps**.
   The **Agentlets** marketplace is a fifth place to browse.
2. **AI Consultant (optional).** An interview covering identity, role, pain points ("Where does your time go?") and current tools. It produces **3 Agent Cards** with time-savings estimates, and one click generates a PRD.
3. **Phase 1, Plan.** Architect writes a PRD: user journey, required agents, app UX and wireframe. The user can refine it by chat, then clicks **"Push to Agents."**
4. **Phase 2, Agents.** Builds the backend orchestration: agents, tools and knowledge bases. Clicking an agent to edit it **sends you to Lyzr Studio.**
5. **Phase 3, App.** Generates the React/Next.js front end and wires the UI to the agents' outputs. A **QA Agent** runs the code and rewrites it if it fails.
6. **Live app in the workspace**, with logs while testing (Netanya's observation; logs aren't in the docs).
7. **Refine by chat** at any phase, even after deploy.
8. **Deploy** to `app-name.architect.new`, with an optional custom domain, analytics, and a "Publish to Marketplace" toggle.

## 3. Feature inventory (what 2.0 must keep)
| Area | Today |
|---|---|
| Context | Attach PDF/DOCX (chunked into a vector DB) and CSV/Excel (loaded into a dataframe for a Data Analyst agent) |
| Design | A Theme Engine injects a design system (Tailwind config + fonts); presets such as "Heritage Premium" and "Heritage Dark" |
| Backend | Auto-provisioned **NoSQL** database (collections, e.g. `_users`, `messages`); a Database tab with a live data viewer and schema view |
| Auth (in the generated app) | Sign-in/sign-up UI, bcrypt-hashed passwords, sessions, protected routes |
| Agents | Real Lyzr Studio agents; tools (search, email, API connector, Gmail/HubSpot/Slack/Apollo/Linear/Calendar mentioned); knowledge bases |
| GitHub | Connect, then a repo is created and **every change auto-commits**. **Importing an existing codebase also exists** (confirmed in Netanya's audit; the docs don't cover it) |
| Code export | Frontend in React/Next.js, backend in Python/Lyzr SDK; self-hostable |
| Sharing | Invite by email; collaborators edit the same app, with no roles and no forking |
| Marketplace | Agentlets: browse by category and use case, preview, analyse. "Clone & Modify" is **coming soon** |
| Usage | Credits used per app, plus last-used date |
| Plans | Free; Starter $20/mo ($20 credits); Pro $40/mo ($40 credits); Custom/Enterprise. Annual pricing about 12% off. Paid plans remove the watermark |
| Enterprise | Data isolated and not used for training; **on-prem / private VPC deployment (AWS, Azure, GCP)** for enterprise customers |
| Models | "Model-agnostic"; picks a mix by default. Customised "in Settings" or per agent **in Studio** |
| Support | Help form plus live chat (mascot) |

## 4. Where the claims and the experience diverge (audit findings)
| Claim (docs) | Experience (Netanya) |
|---|---|
| Model-agnostic, customisable in Settings | No model choice before prompting and none in Settings. **Per-agent model config does exist inside Architect**, at the Agents stage and again in the App stage. Model choice is per agent, after the plan, never up front |
| Integrates Gmail, Slack, Teams, Notion, GitHub, Calendar… | No central place to connect or manage integrations (unlike Claude's Connectors). Tools are **inferred from the prompt** and attached to agents |
| One unified product | Four or five separate starting points (Consultant, Prompt Library, Templates, Agentlets, prompt) |
| Database is NoSQL (docs) | Hands-on build provisioned **Postgres**, with a viewer for entries and schemas (the docs are out of date) |

## 4b. Hands-on build: "Briefly" (Meeting Prep test prompt, 2026-10-01)
**Flow observed:**
1. **Plan.** It asks clarifying questions while working out the project. The output is an **editable PRD plus a sample mockup** of the app.
2. **Agents.** Generated agents can be clicked and their configuration edited, including model and model parameters.
3. **App.** The app builds with a **console/terminal view** (errors, logs) alongside it. From this stage you can:
   - edit agents and preview the app;
   - connect GitHub or deploy directly;
   - set **environment variables**, browse the **file tree**;
   - **duplicate** or **share** the app, run **feature testing**.

**Also present:**
- **Postgres** database viewer (entries and schemas);
- iterative **rebranding**;
- **Plan mode vs Execute mode** in chat;
- adding **assets, MCP servers and custom tools mid-build**.

**Generated app (from the outside):**
- A Next.js app called "Briefly — Personal research workspace" with sign-in, sign-up and forgot-password.
- It exposes `/api/auth/me` and `/api/sso-config` (`{"enabled":false}`). That means **SSO is a built-in, toggleable capability of generated apps**.

**Preview infrastructure (observed in network calls and the injected script):**
- The preview URL pattern is `preview--<app-slug>.app.architect.new`. Responses show `server: nginx/1.25.5` and `via: 1.1 google` (a Google Cloud load balancer in front). CORS is `*`, and there are rate-limit headers.
- The preview runs a **Next.js dev server** (webpack dev chunks), i.e. live code running in a per-app environment.
- **`architect-nginx-proxy`** sits in front of every preview host and uses nginx `sub_filter` to **inject `/__architect/picker.js`** into the HTML. That script is a click-to-select **element picker**:
  - The builder arms it over `postMessage`.
  - Clicking an element sends back its selector, source file, React component names, styles and an HTML snippet, with **secret-pattern redaction** and size budgets. This gets attached to the next chat message.
  - The design is adapted from Orca (MIT).
  - The script is served from the preview's own origin so it passes the generated app's CSP and can reach the cross-origin iframe's DOM.
- There is a separate **console bridge** (`{source:"vite-app"}` postMessages) that streams the preview's console to the builder. This explains the in-builder console.
- What's observable today is a Google-fronted nginx proxy.


**Inside the generated app (signed in, 2026-10-02):**
- **Result versus the prompt:** the app is **"Briefly — personal research workspace."** You type any research question, pick a depth (Concise / Standard / Deep), and get a structured brief: executive summary, findings tagged Fact / Inference / Uncertain with confidence levels, conflicting viewpoints, risks, next steps, and a source list.
- **Not present:**
  - Google Calendar, Gmail and Slack;
  - any schedule ("every morning", "30 minutes before");
  - meeting- or attendee-specific briefs;
  - any use of the Ledgerline one-pager.
  
  Nothing in the UI or the client code references them. *Open question: was this narrowed during planning Q&A or the PRD, or did it drift silently?*
- **A "Sample Data" toggle is on by default.** `/api/seed` seeds 4 example research threads on first load, so the app looks populated before it has done any real work.
- **Agent wiring:**
  - **One** Lyzr Studio agent, with its ID hardcoded in the page (`AGENT_ID`).
  - The client builds a prompt string, then calls `POST /api/agent`. That returns a `task_id`, which the client **polls with adaptive backoff**.
  - The agent returns typed JSON, which is validated client-side before it's saved to `/api/messages` and `/api/briefs`.
- **Platform code shipped inside every generated app:**
  - **`lyzr-architect-pg`**: Architect's own Postgres client SDK.
  - **A global fetch interceptor** for Lyzr Agent API calls. It shows an error modal with a **"Fix with AI"** button, feeding runtime errors back to the builder.
  - The agent base URL is **tenant-aware** (`NEXT_PUBLIC_LYZR_AGENT_BASE_URL`, falling back to SaaS). This is consistent with multi-tenant / white-label deployments.
  - An `/api/upload` helper exists in the lib, but no upload UI is exposed.
- Other routes: `/api/research-threads`, `/api/share-invitations`, `/api/access-check`, `/api/auth/*`, `/api/sso-config`. Share is invite-only and view-only. There's a "Built with Architect" badge.

**Where the scope changed (from the screen recording and the generated PRD):**
- **The planning questionnaire was generic multiple choice**, not built from the prompt. It asked:
  - primary use case (AI assistant / SaaS dashboard / productivity tool / customer portal);
  - capabilities (agent-generated answers / **file uploads** / **third-party data integrations** / team collaboration);
  - persistence;
  - how to build it (**default Lyzr agents in Studio** vs **"Workbench UI with GitAgent (beta)": the agent lives in its own GitHub repo and the app becomes a full AgenticOS workbench**);
  - then "primary job" (★ recommended: **Research and briefing**);
  - then collaboration model (★ recommended: share by invite).
- **The selected answers** were AI assistant, agent answers, collaboration, accounts, default Lyzr agents, research and briefing, share by invite. **File uploads and third-party integrations were not selected**, though the prompt depended on both. *(To confirm: were the ticks Netanya's clicks, or pre-selected defaults?)*
- **Planner's reasoning:** "I recommend a focused workflow rather than a general chatbot". It then confirmed "a focused research assistant that creates sourced briefs…".
  - **It never reconciled the answers with the prompt.** No message said "your prompt asked for Calendar, Gmail, Slack, a PDF and a schedule; these are now out of scope."
  - The PRD says "No third-party account integration is required for the first release."
  - **Collaboration and sharing were added though the prompt never asked for them.**
- **Net effect:** a detailed prompt was overridden by six generic clicks. The PRD is accurate to the clicks, not to the prompt.

**The build, as shown in the chat (it narrates every step):**
- **Orchestrator → specialist agents.** "Architect" delegates to **Agent Creator** (builds the Studio agent and workflow), then to **UI Generator** (schema, routes, UI).
- **Handoff artifacts on disk:** `plan-handoff/manifest.json`, `plan-handoff/prd.md`, `workflow.json`, `workflow_state.json`, and a response schema `response_schemas/briefly_research_agent.json`.
- **Agent created by API:** "Briefly Research Agent", `anthropic/claude-sonnet-4-6`, temperature 0.2, top_p 0.9, native web search, a strict JSON response schema.
  - It noticed the API returned default temperature/top_p and **corrected them to the plan's values**.
  - It checks a "live model catalog" before creating.
- **Database:** provisions a Postgres app DB (`app_…`), writes the schema, applies migrations, and checks for "drift".
- **Self-correction loop:** repeated TypeScript typecheck → patch → rerun, guided by the `lyzr-architect-pg` package's type definitions.
- **Verification:**
  - registers a test user (200), creates a thread (201), retrieves history (200);
  - "zero runtime errors";
  - **"Automated browser testing was disabled."**
- **Finish:** a **commit card** ("Update generated app", with **Revert to this version**), an **"Optional feature test"** button, and a run summary: **"4 steps · 138.6k tokens."**
- Each session is labelled `NEW SESSION <id>`. A **Plan toggle** sits in the composer.

## 5. Observations for discovery (hypotheses, not conclusions)
- **H1 (weakened by the audit). Today, developers are sent elsewhere.** The app stage has per-agent model config, env vars, a file tree, a console and MCP, and planning offers a GitAgent "Workbench" path (an agent in its own repo). The documented path for anyone wanting control is "go to Studio." That suggests 2.0's developer story is mostly about **not leaving**, rather than adding a code tab.
- **H2. Architect decides for the user, invisibly.** Models, tools and integrations are inferred. That's good for non-technical users, but opaque for everyone: you can't see what was decided or change it in place.
- **H3. Architect stops at "prototype."** Its own docs position it as the prototyping stage, with production in Studio. 2.0 could own the prototype→production path in one place.
- **H4. ~~GitHub is one-way~~ (corrected: import exists).** To audit next: what import does with a repo it didn't generate (stack detection? agents found? does it run?), and whether changes sync back.
- **H5. Enterprise data control already exists, but nobody can see it.** VPC/on-prem is in the FAQ but invisible in the product. This links to the parked sovereignty angle.
- **H7. The output can quietly diverge from the request.** The prompt asked for Calendar + Gmail + Slack + web + a PDF on a schedule. The app delivered a generic on-demand research tool with sample data switched on. **Confirmed mechanism:** a generic planning questionnaire overrode the specific prompt, and nothing reconciled the two. That's not exactly a silent cut: the PRD states the new scope. But Architect never told the user what it had dropped from their own words.
- **H6. Two audiences in Lyzr's own funnel.** Self-serve credit plans (individuals) plus a Custom/Enterprise tier with VPC deployment. Netanya's read is that the beta is open to independents while an enterprise version matures.

## 6. Open audit questions
- ~~Settings → model preference~~: none found. Per-agent model config at the Agents/App stages.
- ~~Integrations / one-pager / schedule~~: none present in the app (see 4b). **Still open:** where were they dropped — in planning Q&A, in the PRD, or during the build?
- What do the logs show: agent calls, tool calls, errors, cost?
- Credits consumed for the build?
- Network-tab HAR export (for the architecture mapping).
