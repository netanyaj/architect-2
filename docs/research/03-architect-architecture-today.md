# How architect.new works today (reverse-engineered)

_Sources:_
- _Netanya's HAR capture of a ~50-minute builder session (2026-10-01): 2,090 requests, reduced to metadata, with secrets redacted;_
- _the generated "Briefly" app's code and network calls;_
- _the injected preview script;_
- _the screen recording and the Lyzr docs._

_Everything below was observed unless marked **inferred**._

## 1. The map

```
Browser (www.architect.new, Next.js on Vercel)
  │  auth ─────────────► Memberstack (client.memberstack.com)   [tenant can switch to Keycloak]
  │  REST ─────────────► Architect API  api.beta.architect.new/api/v1  (Google-fronted)
  │  WebSocket ────────► api.beta.architect.new/api/v1/ws   (chat, app state, stream relay)
  │  REST ─────────────► Lyzr Studio services (called directly from the browser)
  │                        agent-prod.studio.lyzr.ai  /v3/agents, /v3/tools/mcp/servers,
  │                                                   /v3/tools/credentials/connected_accounts,
  │                                                   /v3/providers/type  (model catalog)
  │                        pagos-prod.studio.lyzr.ai  /api/v1/usages/current (credits), orgs, keys
  │  iframe ───────────► preview--<slug>.app.architect.new  (nginx "architect-nginx-proxy")
  │                        │ 308 → ?token=<HS256 JWT {user_id, app_id, sandbox_id}, 1h exp>
  │                        ▼
  │                      E2B sandbox  <sandbox_id>.e2b.app
  │                        :3333  generated app's Next.js dev server (+ HMR websocket)
  │                        :8889  "Lyra" agent harness  /capabilities
  ▼
Architect API ──► Redis (sandbox status: running / healthy / pid_alive / timeout_at)
              ──► GitHub org "Lyzr-Apps" (one repo per app)
              ──► deploy target <slug>.architect.space
              ──► per-app Postgres DB (app_<id>)  [via lyzr-architect-pg]
```

## 2. Components and what they do

| Component | Evidence | Role |
|---|---|---|
| **Builder front end** | `www.architect.new`, Next.js chunks, `_vercel/insights` | UI. Talks to three back ends directly: the Architect API, Lyzr Studio, and Memberstack |
| **Tenant config** | `GET /api/v1/tenant/config?domain=…` (no auth) | **Multi-tenant / white-label.** Returns the auth provider (`memberstack`, with Keycloak fields for enterprise SSO), branding, **feature flags** and every service URL. Flags include `marketplace_clone`, `voice_enabled`, `snyk_scan`, `coolify_https_git`, `project_transfer_enabled`, `new_studio`, `require_architect_invite`, `hide_watermark`. Service URLs: agent, RAG, billing ("pagos"), crawler, assets, voice (LiveKit), metrics websocket. `credits_divisor: 100` |
| **Auth** | `client.memberstack.com/member`; tenant `auth_provider` | Memberstack for SaaS. Keycloak fields show enterprise tenants can bring their own identity provider (IdP) |
| **Architect API** | `api.beta.architect.new/api/v1/*` | Apps, plan, messages, bookmarks, build-status, init, import-codebase, refresh-capabilities, databases/collections, design-systems, slides, sandboxes/state |
| **Realtime channel** | `wss://…/api/v1/ws` | Auth by bearer token, then `subscribe {app_id}`. Events: `chat_message` → `chat_response {status: streaming}` → many `chat_stream` frames (each one wraps an SSE line from the harness), `state_snapshot`, `update_app_state`, `check_active_stream` (resumes a stream after reload). Also CRUD verbs (`create_app`, `create_repository`, …) |
| **Plan mode** | `POST /apps/{id}/plan/turn` → `text/event-stream`; `plan/keepalive`; `PATCH /plan` | A separate planning session (`session_id: plan-…`) streamed as SSE events (`plan_turn_started`, `message_received` partial tokens). **The selected design system is injected into the user's message as a large system block** ("USER DESIGN SYSTEM — ACTIVE… SOURCE OF TRUTH…"). Keepalive returns the sandbox ID, so the sandbox exists from the planning stage onward |
| **Plan → build handoff** | WebSocket `chat_message`: "Build the application from the materialized plan handoff. Read `plan-handoff/manifest.json` and `plan-handoff/prd.md`… the materialized files are authoritative" | **The plan is written into the sandbox as files**, and the build agent is told to treat those files, not the chat, as the source of truth |
| **Sandbox** | `3333-<id>.e2b.app`, `8889-<id>.e2b.dev`; `POST /sandboxes/state` (status from **Redis**: running, healthy, `pid_alive`, `timeout_at`); `init` → `already_running` | **E2B**, one per app, created at the start of planning. Port 3333 runs the generated app's **dev server** (HMR over a websocket); port 8889 runs the harness |
| **Agent harness ("Lyra")** | `init` response: `lyra_capabilities` at `:8889/capabilities`; `claude_agent_sdk_version: "harness-go"`, `min_claude_agent_sdk: "0.2.0"`; `plan_mode_supported`; features `env_management, git_manual_controls, git_churn_exclusions, git_sync_integrity, unified_agent_thread, maintenance_prune`; build-marker mismatch reported | **The coding agent runs inside the sandbox.** It's built on (or compatible with) the **Claude Agent SDK**, wrapped in a Go harness. In the build log, an orchestrator ("Architect") delegates to sub-agents (Agent Creator, UI Generator) |
| **Capabilities refresh** | `POST /refresh-capabilities` → `models_count: 54 (live)`, `tools_count: 50`, `mcp_count: 0`, `voice_providers: 4`, `harness_reloaded` | The harness is told which models, tools, MCP servers and voice providers exist for this user, and it can hot-reload |
| **Model catalog** | `agent-prod…/v3/providers/type?provider_type=lyzr-llm`; provider logos for Anthropic, OpenAI, Google, Groq, Perplexity, xAI | **The model-agnostic layer belongs to Lyzr Studio.** Each model has cost and speed ratings, a context window, capabilities (`web_search`, `reasoning`), parameter schemas and an "intelligence_index" |
| **Generated app's agents** | Studio `/v3/agents/{id}` (role, instructions…); in-app `/api/agent` → `task_id` → polling | Agents are **Lyzr Studio agents**. The generated app reaches them through its own server route, using a tenant-aware base URL |
| **Integrations** | `/v3/tools/credentials/connected_accounts?user_id=…` → `[]`; `/v3/tools/mcp/servers` → `[]` | OAuth accounts and MCP servers live in Studio, **per user**. Nothing was connected, which matches the PRD dropping integrations |
| **Data** | `GET /databases/{id}/collections`, `/collections/_users`, `/collections/briefs` | A per-app Postgres DB, browsed through the Architect API |
| **Git** | App record: `repository_url: github.com/Lyzr-Apps/<slug>`, `repository_initialized: false`; `GET /import-codebase` → `import_source: null` | Every app gets a repo **in Lyzr's own GitHub org**. Import is tracked per app |
| **Deploy** | `deployment_url: <slug>.architect.space`; `deploy_attempt_count` | Production hosting on `architect.space`. **Confirmed by DNS (2026-10-03): every `*.architect.space` subdomain is a CNAME to one Netlify site**, so deployed apps are served by Netlify |
| **Billing** | `pagos-prod…/usages/current`: plan "Community", 2,000 recurring credits, `credits_divisor 100` | Credits metered by Lyzr's billing service. **Polled about 52 times in one session** |
| **Preview proxy** | nginx 1.25.5 behind a Google load balancer; 308 redirect adds a JWT `?token=`; injects `/__architect/picker.js` | Authenticates the preview per user, app and sandbox. Injects the element picker and a console bridge |
| **Third-party scripts in the builder** | PostHog (711 requests), Microsoft Clarity, Mixpanel, Meta pixel (via Cloud Run gateway), LinkedIn, Taboola, Reddit, Bing, Google Ads/Analytics, G2, OneSignal, Tawk.to, hCaptcha, FingerprintJS, Cookiebot | Product analytics and ad attribution. About 950 of the 2,090 requests went to third parties |

## 3. Prompt to live app, as observed
1. **Create app.** Architect gets an app ID and a slug (`brief-forge-smart-link-z98w`). An **E2B sandbox** is started and its status is tracked in Redis. A GitHub repo is reserved under `Lyzr-Apps`.
2. **Plan.** `plan/turn` streams Q&A and the PRD from the planning agent. The design system is injected into the message. A keepalive holds the sandbox. The PRD and mockup are editable (`PATCH /plan`).
3. **Handoff.** The plan is materialised as files in the sandbox (`plan-handoff/manifest.json`, `prd.md`).
4. **Build.** A WebSocket `chat_message` reaches the in-sandbox harness (Lyra, Claude Agent SDK). The orchestrator delegates:
   - **Agent Creator** calls Lyzr Studio to create the agent and the `workflow.json`;
   - **UI Generator** writes the schema, migrations, routes and UI, then typechecks and self-repairs.
   
   Progress streams back over the WebSocket.
5. **Preview.** The dev server on `:3333` is proxied through `preview--<slug>.app.architect.new`, with a JWT gate, picker injection and the console bridge. Changes arrive over HMR.
6. **Verify and commit.** The harness runs API probes (register → create → read) and creates a commit (revertible). "Optional feature test" is offered.
7. **Deploy.** The app goes live at `<slug>.architect.space`.

## 4. What this means for the Architect 2.0 architecture doc
- **We aren't designing from zero.** The sandbox (E2B), harness (Claude Agent SDK based), streaming protocol, preview proxy, multi-tenancy and model catalog already exist. 2.0's architecture should read as an **evolution with reasons**:
  - keep what works;
  - change what blocks scale, enterprise use or developers.
- **Things worth addressing:**
  1. **The agent loop runs inside the sandbox.** That's simple, but a crash or out-of-memory inside the sandbox can take down the agent too. A known pattern is to run the loop in the control plane and reach into the sandbox through a daemon. This is a trade-off to argue, not a default.
  2. **Secrets reach the sandbox as environment variables.** `init` posts `LYZR_API_KEY` and also `VITE_LYZR_API_KEY`; a `VITE_` prefix is normally bundled into client code. An egress proxy that injects credentials keeps keys out of generated code. *(Worth verifying whether the VITE_ key reaches the browser bundle in Vite-based apps; it didn't apply to this Next.js app.)*
  3. **The preview token travels in the URL query string**, so it can end up in logs and Referer headers. A cookie set by the proxy after a one-time code is the usual fix.
  4. **One sandbox per app from the planning stage**, held by keepalives and a timeout. Cost and scale depend on hibernation and warm pools.
  5. **Repos live in Lyzr's GitHub org.** Developers would expect their own org, which means a GitHub App installed on their account.
  6. **The browser calls 3+ back ends directly** (Architect API, Studio, billing). A backend-for-frontend or gateway would simplify auth, enable tenant isolation, and make a VPC deployment cleaner.
  7. **Polling in hot paths** (credits about 52×, sandbox state 26×) could go over the existing WebSocket.
  8. **Sovereignty angle (H5):** the builder loads about 15 third-party trackers. That's fine for SaaS growth, but an enterprise or VPC tenant would need a tracker-free build. Tenant feature flags already exist to support this.
- **What already favours enterprise:**
  - tenant config with Keycloak SSO;
  - feature flags (Snyk scan, Coolify git, project transfer);
  - SSO built into generated apps;
  - a tenant-aware agent URL.
  
  The platform is clearly designed for white-label and enterprise tenants.

## 5. Not observed / unknown
- The build pipeline that pushes an app to Netlify. (DNS on 2026-10-03 also shows the builder front end on Vercel and the API and preview proxy on AWS IP ranges.)
- How the import flow processes a repo (`import_source` was null; no import was run).
- Where the per-app Postgres is hosted.
- Which LLM the builder agent itself uses (the harness is Claude Agent SDK based; the model wasn't visible).
