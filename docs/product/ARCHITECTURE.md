# Architect 2.0: architecture

_Owner: Netanya Jaison · Draft 2 · 2026-10-12. Companion to the PRD ([`08-PRD-architect-2.md`](08-PRD-architect-2.md)). Diagrams are in [`diagrams/`](diagrams/): PNG and SVG at 2×, with editable sources in `diagrams/src/` (render with `node scripts/render-diagrams.mjs`). The live prototype: [architect2-netanya.vercel.app](https://architect2-netanya.vercel.app)._

_Code names keep two older words: `blueprint` is the plan and `item` is a part (as in `architect/blueprint.yaml` and `update_item`)._

## The 3-minute read
![How Architect 2.0 works in production: the twelve steps from prompt to a live app](diagrams/hero-architecture.png)
_How Architect 2.0 works in production. The numbers are the steps in [section 2](#2-from-prompt-to-live-app). What the prototype runs is in [section 9](#9-what-the-assignment-prototype-implements)._

- **An evolution, not a rewrite.** Today's Architect already has the right foundations: per-project sandboxes (E2B), an agent harness based on the Claude Agent SDK, a WebSocket stream, a preview proxy, multi-tenant configuration and Lyzr Studio's model catalogue and agent registry. 2.0 keeps them and changes what blocks trust, developers, scale and enterprise use.
- **Control plane and data plane are split.** The control plane (accounts, policy, billing, plan IDs and statuses) can stay in Lyzr Cloud while the data plane (sandboxes, agents, models, code, data, launched apps) runs in the customer's own cloud. This one decision makes the sovereign offer possible.
- **The agent loop moves out of the sandbox.** The Architect agent and the verifier run as workers that reach into the sandbox through a small daemon. A crashed sandbox no longer loses work, and keys never sit inside it.
- **Every agent uses the same tool surface.** The sandbox daemon exposes its tools over MCP (Model Context Protocol), so the Architect agent and a user's own coding agent (Claude Code, Cursor) call exactly the same tools under the same policy.
- **One runtime for launched apps everywhere.** Apps move from today's Netlify hosting to a container runtime that runs the same way in Lyzr Cloud, a customer's cloud or on-prem, and supports Python back ends, agent workers and autoscaling.

**What a build costs.** A small build of 6 parts on a mid-tier model costs about $2.80 and sells for about $7 at a 2.5× markup; a small internal app then costs roughly $40–60 a month to run, on its own meter. The arithmetic is in [section 11](#11-cost-per-build).

Everything below is the detail. The deep sections (3.1 to 3.12, 5, 6, 7, 12 and 14) are folded: click a title to open it.

## 1. Starting point: what exists today, and what changes
Based on our network captures and tests of today's Architect ([`docs/research/03-architect-architecture-today.md`](../research/03-architect-architecture-today.md), [`docs/research/04-import-audit.md`](../research/04-import-audit.md)) and a DNS check on 2026-10-03.

| Area | Today | 2.0 | Why |
|---|---|---|---|
| Builder front end | Next.js on Vercel; the browser calls three back ends directly (Architect API, Studio, billing) | **Change:** one API gateway in front of everything | Simpler auth, tenant isolation, and a clean boundary for the customer's-cloud mode |
| Realtime | WebSocket for chat; credits and build status polled (about 52 and 95 times in one session) | **Keep** the WebSocket; **change** polling to pushed events | Parts must turn Works as they happen (NFR-3) |
| Sandboxes | One E2B microVM per app, started at planning and kept alive with keepalive pings | **Keep** E2B; **add** pause and resume, warm pools, Node and Python images, and a provider interface | Cost tracks active work; self-hostable in customer clouds |
| Agent harness | "Lyra", built on or compatible with the Claude Agent SDK (it reports an SDK version), runs **inside** the sandbox in no-approval mode (`bypassPermissions`) | **Keep** the harness; **change** where it runs (workers outside the sandbox) and how it acts (policy-checked) | No lost work (NFR-5), no keys in sandboxes, approvals (C-10) |
| Verification | A QA agent runs code and self-repairs | **Add** a separate verifier that writes checks before code (A-7) | The builder can't grade its own work |
| Models | Studio's catalogue (54 models), chosen per agent after planning | **Keep** the catalogue; **add** a model gateway with policy routing, metering and private endpoints | Model choice upfront, own models, cost per part |
| Preview | nginx proxy; a JWT in the URL query string; injects an element picker and console bridge | **Keep** the proxy and injection; **change** the token to a cookie | Tokens in URLs leak into logs and Referer headers |
| Secrets | API keys passed into the sandbox as environment variables (including a `VITE_` one) | **Change:** an egress proxy injects credentials; sandboxes hold none | Keys can't leak into generated code |
| GitHub | OAuth app with full `repo` scope; app repos reserved in Lyzr's `Lyzr-Apps` org; "Push to GitHub" can only create a new repo; the agent can't push to an existing repo | **Change:** GitHub App per repo, git executor service, PRs to the user's repo | Least privilege; Sam's workflow |
| Launched apps | `*.architect.space`, a wildcard pointing to one Netlify site | **Change:** container runtime with environments and autoscaling | Python back ends, agent workers, same runtime in every deployment mode |
| Tenancy | Tenant config with per-tenant feature flags and Keycloak SSO fields | **Keep**, and build the governance layer on it | Enterprise foundations already exist |
| Trackers | About 15 third-party trackers in the builder | **Change:** none in customer-cloud and on-prem tenants | Sovereign promise (C-8) |

## 2. From prompt to live app
The numbers match the hero diagram above.

1. **Prompt.** Morgan describes the app and attaches a PDF in the web app, which sends it through the API gateway. Attachments go to the project store; PDFs become a knowledge base.
2. **Write the plan.** The plan service asks the model gateway to turn the prompt into parts, each with its check and its cost, plus defaults and questions; the estimator prices each part (PRD section 11). Parts stream to the browser as they're written. If the chosen model refuses on quota, the gateway follows the failover rule: failover goes only to models the organisation's policy pre-approves as fallbacks, and is always announced.
3. **Review, then click Build.** Nothing runs until Morgan clicks **Build · ~N credits**, after answering any question that holds Build. Governance checks the budget and the allowed models first. The plan is saved as version 1.
4. **Start the run.** The run orchestrator starts a durable workflow, resumes the project's sandbox or takes one from the warm pool, and mounts the project's files.
5. **Checks first.** The verifier writes a check for every part and locks it before any code exists.
6. **Build each part.** Architect agent workers build parts in dependency order through the sandbox daemon's tools (over MCP). Anything that leaves the sandbox (a push, a key, a new app) is checked against policy: allowed by rule, sent for approval, or refused.
7. **Prove each part.** The verifier runs the part's check and attaches the proof. A pass marks the part **Works**; a failure starts a fix, up to 3, then the part waits for Morgan.
8. **Agents into Lyzr Studio.** Each agent part that works is created in the workspace's own Lyzr Studio (section 10).
9. **Fix a blocker.** A part waiting for an app shows **Needs you**: Morgan connects the app (sign-in, an API key or an MCP server) and it carries on. Keys go to the vault; the egress proxy injects them on the way out.
10. **Live preview, throughout.** The browser shows the running app through the preview proxy, and every part's status is pushed as it changes.
11. **Launch.** With governance off, it's one step: **Test → Live**. With it on, it's **Test → Team → Live**, and Live waits for an Owner or Admin's approval. Each launch builds an image, runs the pre-publish checks and promotes it; going back is one click.
12. **Run and watch.** The app runs per environment on the app runtime; its agents run on Lyzr Studio. Every decision is in the audit log, and metering feeds Usage and the estimator.

<details>
<summary>The same path as two sequence diagrams (A2): steps 1 to 7, then steps 8 to 12</summary>

Steps 1 to 7, from the prompt to parts that work:

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Arial","fontSize":"15px","primaryColor":"#FFFFFF","primaryBorderColor":"#1A1A19","primaryTextColor":"#1A1A19","lineColor":"#1A1A19","secondaryColor":"#FFFFFF","tertiaryColor":"#FFFFFF","clusterBkg":"#FFFFFF","clusterBorder":"#D6D4CC","edgeLabelBackground":"#FFFFFF","actorBkg":"#FFFFFF","actorBorder":"#1A1A19","actorTextColor":"#1A1A19","actorLineColor":"#A8A69F","signalColor":"#1A1A19","signalTextColor":"#1A1A19","noteBkgColor":"#FFFFFF","noteBorderColor":"#D6D4CC","noteTextColor":"#1A1A19","labelBoxBkgColor":"#FFFFFF","labelBoxBorderColor":"#1A1A19","labelTextColor":"#1A1A19","loopTextColor":"#1A1A19","activationBkgColor":"#F5F4F0","activationBorderColor":"#1A1A19","sequenceNumberColor":"#FFFFFF","textColor":"#1A1A19","titleColor":"#1A1A19","nodeTextColor":"#1A1A19"},"sequence":{"mirrorActors":false,"actorMargin":36,"wrap":true,"width":150}}}%%
sequenceDiagram
  box rgb(255, 255, 255) People
    participant M as Morgan
  end
  box rgb(240, 234, 250) Approvals
    participant PA as Policy and approvals
  end
  box rgb(230, 245, 246) The cell
    participant PL as Plan service
    participant OR as Run orchestrator
    participant V as Verifier
    participant AA as Architect agent
    participant SB as Sandbox
  end
  %% A white card, so ink lines read on GitHub's dark theme too
  rect rgb(255, 255, 255)
    Note over M,PL: 1 · Prompt
    M->>PL: Prompt and a PDF, from the web app through the API gateway
    Note over M,PL: 2 · Write the plan
    PL-->>M: Parts, checks and cost stream in (model gateway)
    Note over M,OR: 3 · Review, then click Build
    M->>PA: Build · ~N credits
    PA-->>OR: Budget and allowed models checked: start the run
    Note over OR,SB: 4 · Start the run
    OR->>SB: Resume the sandbox, or take one from the warm pool
    Note over OR,V: 5 · Checks first
    OR->>V: Write a check for each part
    V-->>OR: Checks locked
    loop 6–7 · Build and prove each part
      OR->>AA: Build the part
      AA->>SB: Edit files, run commands (daemon tools over MCP)
      AA->>PA: Anything leaving the sandbox: allow, ask or refuse
      OR->>V: Run the part's check
      V->>SB: Run the check
      V-->>OR: Pass: Works. Fail: fix, up to 3
      OR-->>M: The part turns Works or Needs you (realtime hub)
    end
  end
```
[PNG](diagrams/A2-prompt-to-live.png)

Steps 8 to 12, from agents in Lyzr Studio to the live app:

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Arial","fontSize":"15px","primaryColor":"#FFFFFF","primaryBorderColor":"#1A1A19","primaryTextColor":"#1A1A19","lineColor":"#1A1A19","secondaryColor":"#FFFFFF","tertiaryColor":"#FFFFFF","clusterBkg":"#FFFFFF","clusterBorder":"#D6D4CC","edgeLabelBackground":"#FFFFFF","actorBkg":"#FFFFFF","actorBorder":"#1A1A19","actorTextColor":"#1A1A19","actorLineColor":"#A8A69F","signalColor":"#1A1A19","signalTextColor":"#1A1A19","noteBkgColor":"#FFFFFF","noteBorderColor":"#D6D4CC","noteTextColor":"#1A1A19","labelBoxBkgColor":"#FFFFFF","labelBoxBorderColor":"#1A1A19","labelTextColor":"#1A1A19","loopTextColor":"#1A1A19","activationBkgColor":"#F5F4F0","activationBorderColor":"#1A1A19","sequenceNumberColor":"#FFFFFF","textColor":"#1A1A19","titleColor":"#1A1A19","nodeTextColor":"#1A1A19"},"sequence":{"mirrorActors":false,"actorMargin":36,"wrap":true,"width":150}}}%%
sequenceDiagram
  box rgb(255, 255, 255) People
    participant M as Morgan
  end
  box rgb(240, 234, 250) Approvals
    participant PA as Policy and approvals
  end
  box rgb(230, 245, 246) The cell
    participant OR as Run orchestrator
    participant EV as Egress proxy and vault
    participant RP as Realtime and preview
    participant RT as App runtime
  end
  box rgb(232, 241, 230) Lyzr Studio
    participant LS as Lyzr Studio
  end
  %% A white card, so ink lines read on GitHub's dark theme too
  rect rgb(255, 255, 255)
    Note over OR,LS: 8 · Agents into Lyzr Studio
    OR->>LS: Create each agent part in the workspace's own Studio
    LS-->>OR: Agent IDs, saved on the parts
    Note over M,EV: 9 · Fix a blocker
    OR-->>M: Needs you: connect the app
    M->>EV: Sign in to the app, or add its key or MCP server
    EV-->>OR: Stored in the vault, never in the sandbox
    Note over EV: The sandbox's calls go out through the proxy, which adds the key
    Note over M,RP: 10 · Live preview, throughout
    M->>RP: Open the Test version
    RP-->>M: The app from the sandbox's dev server, updated as parts work
    Note over M,RT: 11 · Launch
    M->>PA: Launch: Test, Team, then Live
    Note over PA: Live needs an Owner or Admin approval (governance on)
    PA-->>OR: Approved
    OR->>RT: Build the image, run the pre-publish checks, promote
    Note over LS,RT: 12 · Run and watch
    RT->>LS: The app's agents run on Studio
    RT-->>M: Live URL, with audit and metering
  end
```
[PNG](diagrams/A2b-blocker-to-live.png)

</details>

## 3. Components
![The system map in production: people, Lyzr's control plane, the boundary, a cell, Lyzr Studio and outside services](diagrams/system-map-production.png)
_The system map. Lyzr's control plane is global and holds no prompts, plans, code or app data; everything else runs in a cell, in Lyzr Cloud or the customer's own cloud. The same map with what the prototype uses for each box opens [section 9](#9-what-the-assignment-prototype-implements)._

**Agent schedules.** An agent's schedule (a trigger like "weekdays at 8:00") would run in the cell's run orchestrator, as a durable workflow on a timer; in the prototype, schedules are simulated and labelled Simulated.

<details>
<summary><b>3.1 Web app, API gateway and realtime</b></summary>

### 3.1 Web app, API gateway and realtime
- **Web app:** Next.js. It talks to **one** API gateway instead of three back ends. The gateway handles sign-in, tenant routing and rate limits, and forwards to Architect services, Studio and billing.
- **Realtime:** one WebSocket per open project, as today. Workers publish events (part status, logs, cost so far) to a realtime hub, which pushes them to the browser. Credits and build status are no longer polled.
- **Auth:** Google, GitHub and email sign-in for individuals; the tenant config's existing Keycloak support provides enterprise single sign-on.

</details>

<details>
<summary><b>3.2 Plan service</b></summary>

### 3.2 Plan service
- Stores plans, parts, versions, checks and proofs in Postgres, and mirrors each version to `architect/blueprint.yaml` in the project (and the repo, if the user chooses).
- Drafts plans and questions through the model gateway, applies the conflict guard (A-3) as a diff between versions, and runs the estimator: part classification, historical medians per part class, fix allowance, and a 50th–90th percentile range.
- Every build's actual tokens and sandbox minutes flow back from metering to update the estimator.

</details>

<details>
<summary><b>3.3 Run orchestrator and the Architect agent</b></summary>

### 3.3 Run orchestrator and the Architect agent
```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Arial","fontSize":"15px","primaryColor":"#FFFFFF","primaryBorderColor":"#1A1A19","primaryTextColor":"#1A1A19","lineColor":"#1A1A19","secondaryColor":"#FFFFFF","tertiaryColor":"#FFFFFF","clusterBkg":"#FFFFFF","clusterBorder":"#D6D4CC","edgeLabelBackground":"#FFFFFF","actorBkg":"#FFFFFF","actorBorder":"#1A1A19","actorTextColor":"#1A1A19","actorLineColor":"#A8A69F","signalColor":"#1A1A19","signalTextColor":"#1A1A19","noteBkgColor":"#FFFFFF","noteBorderColor":"#D6D4CC","noteTextColor":"#1A1A19","labelBoxBkgColor":"#FFFFFF","labelBoxBorderColor":"#1A1A19","labelTextColor":"#1A1A19","loopTextColor":"#1A1A19","activationBkgColor":"#F5F4F0","activationBorderColor":"#1A1A19","sequenceNumberColor":"#FFFFFF","textColor":"#1A1A19","titleColor":"#1A1A19","nodeTextColor":"#1A1A19"},"flowchart":{"curve":"basis","padding":14,"nodeSpacing":36,"rankSpacing":44}}}%%
flowchart TB
  %% A white card, so ink lines read on GitHub's dark theme too
  subgraph CARD[" "]
    direction TB
    subgraph W["Workers, outside the sandbox"]
      direction LR
      AA["Architect agent<br/>Claude Agent SDK harness<br/>checkpoints after each step"]
      VF["Verifier<br/>its own context<br/>writes checks first"]
    end
    subgraph S["Sandbox, one per project"]
      direction LR
      D["Sandbox daemon<br/>files · commands · ports"]
      T["Check runner<br/>tests · headless browser"]
      APP["The user's stack<br/>Node or Python dev server"]
    end
    AA -- "tool calls" --> D
    VF -- "run checks" --> T
    D --> APP
    T --> APP
    subgraph C["Cell services"]
      direction LR
      MG["Model gateway"]
      PA["Policy and approvals"]
      ST[("Postgres and<br/>object storage")]
      EG["Egress proxy and vault"]
    end
    APP -- "outbound calls" --> EG
    W -. "model calls" .-> MG
    W -. "actions leaving the sandbox" .-> PA
    W -. "state and proofs" .-> ST
  end
  classDef people fill:#FFFFFF,stroke:#D6D4CC,stroke-width:1.5px,color:#1A1A19
  classDef control fill:#EEEAFB,stroke:#C9BEF2,stroke-width:1.5px,color:#1A1A19
  classDef cell fill:#E6F5F6,stroke:#A9DCE0,stroke-width:1.5px,color:#1A1A19
  classDef studio fill:#E8F1E6,stroke:#B7D3B0,stroke-width:1.5px,color:#1A1A19
  classDef outside fill:#F1F0EC,stroke:#D6D4CC,stroke-width:1.5px,color:#1A1A19
  classDef approval fill:#F0EAFA,stroke:#6236AD,stroke-width:1.5px,color:#1A1A19
  class AA,VF,D,T,APP,MG,ST,EG cell
  class PA approval
  style W fill:#FFFFFF,stroke:#A9DCE0,stroke-width:1.5px,color:#1A1A19
  style S fill:#FFFFFF,stroke:#A9DCE0,stroke-width:1.5px,color:#1A1A19
  style C fill:#FFFFFF,stroke:#A9DCE0,stroke-width:1.5px,color:#1A1A19
  style CARD fill:#FFFFFF,stroke:#D6D4CC,color:#1A1A19
```
[PNG](diagrams/A3-run-loop.png)


**How the agent works, step by step**

| Step | What happens |
|---|---|
| **Plan** | The agreed plan sets the order. The orchestrator builds parts in dependency order (data before features, connections before the agents that use them), and the agent writes a short per-part plan into the transcript before touching code |
| **Write code** | The agent edits files through the daemon's file tools (read, write, apply patch, search), one part at a time, so every change maps to a part |
| **Run tools** | It installs packages, runs the dev server, tests and type checks through the daemon's command tools, and reads the output and the preview's console to decide its next step |
| **Recover from errors** | Recovery happens in layers, each with its own owner (below) |

| Failure | Who handles it | What happens |
|---|---|---|
| A command or test fails | The Architect agent, in the same turn | It reads the error and retries; this is normal work and is in the estimate |
| A part's check fails | The orchestrator's fix loop (A-9) | A billed "Fix" run with the failure attached; after 3 failed attempts the part pauses and the user can edit or defer it |
| A worker dies | The workflow engine | Another worker resumes from the last saved turn |
| The sandbox crashes or is lost | The orchestrator | A new sandbox is created from the project store; at most one step is repeated |
| The model is down or rate-limited | The model gateway | Retries with backoff. Failover goes only to models the organisation's policy pre-approves as fallbacks, and is always announced. With no approved fallback, the run pauses and asks (BL-3) |
| The budget runs out | The orchestrator | The build pauses, finished parts stay, and the remaining estimate is shown |

- **Durable workflows.** Each build, fix, test or launch is a workflow in a durable workflow engine (Temporal, which is open source and self-hostable, so it also runs in customer clouds). Each turn of the agent (one model response plus its tool calls) is one workflow step, and the session transcript is saved to the project store after every turn. If a worker dies, a new worker resumes the session from the last saved turn.
- **The agent loop runs in workers, outside the sandbox.** Today the harness runs inside the sandbox, so a sandbox crash or out-of-memory error kills the agent and its progress, and the sandbox needs keys to call models. In 2.0, the Claude Agent SDK-based harness runs in a worker pool. The SDK's built-in file and shell tools are turned off, so the agent can only act through the sandbox daemon's tools; nothing touches the worker's own disk.
- **No lost files.** The daemon commits the project's files to the project store after every tool call that changes them, so losing a sandbox costs at most one step (NFR-5). Each part that reaches Works is also a git commit, which is what checkpoints restore (BL-7).
- **Same tools for every agent.** The sandbox daemon exposes file, command and port tools as an MCP server. The Architect agent uses them, and so does a user's own coding agent through Architect's public MCP server, under the same policy and audit. One tool surface means one set of permissions to get right.
- **Permission modes instead of blanket bypass (C-10).** Inside the sandbox the agent acts freely, since the sandbox is disposable. Anything that leaves it (git push, launch, external calls with credentials, new connectors) goes through the policy service: allowed by rule, sent for approval, or refused.
- **Trade-off.** Every tool call now crosses the network to the sandbox. With hosted E2B, workers run in the cloud region nearest to E2B's, adding roughly 10–40 ms per call; a model response takes seconds, so this is small. In self-hosted cells, workers and sandboxes share a cluster and the hop is shorter still.

</details>

<details>
<summary><b>3.4 Verifier</b></summary>

### 3.4 Verifier
- A separate worker type with its own context and no access to the Architect agent's reasoning.
- Writes each part's check from the plan before the build starts. Checks are stored and locked; the Architect agent can't edit them.
- Prefers deterministic checks: unit and API tests, HTTP status, type checks, and headless-browser runs with screenshots. A rubric review by a model is used only for qualities no test can capture, and is labelled as such.
- Runs checks in the sandbox's check runner and writes the proof (result, logs, screenshot) to the project store.

</details>

<details>
<summary><b>3.5 Sandboxes</b></summary>

### 3.5 Sandboxes
- **Provider:** E2B (Firecracker microVMs) in Lyzr Cloud, as today, behind a `SandboxProvider` interface. In customer clouds and on-prem, the same interface uses self-hosted E2B (its infrastructure is open source; its support for the customer's cloud is checked before committing) or Kubernetes with a hardened container runtime: gVisor on standard nodes, or Firecracker and Kata Containers on bare-metal nodes, which cost more.
- **Why E2B over the alternatives:**

| Option | Isolation | Runs in customer clouds | Verdict |
|---|---|---|---|
| **E2B** | Firecracker microVM per sandbox | Yes: its infrastructure is open source and self-hostable | **Chosen:** strong isolation, pause and resume with memory snapshots, fast starts, and Architect already runs on it, so no migration risk |
| Daytona | Containers (OCI images) by default | Self-hosting status changed in 2026; to be confirmed | Fast warm starts, but container isolation is weaker for untrusted generated code |
| Modal Sandboxes | gVisor | No: managed service only | Good isolation and GPUs, but can't run in a customer's VPC or on-prem |
| Fly Machines | Firecracker microVM | No | Strong isolation, but we'd build the sandbox layer (daemon, snapshots, pools) ourselves |
| Kubernetes + gVisor or Kata | gVisor, or a lightweight VM per pod | Yes | The fallback for customer clouds and on-prem, behind the same interface; more for us to operate |

- **Lifecycle:** created on the first build, not at the first prompt. Paused after 10 idle minutes, with its memory and disk snapshotted; resumed in seconds when the user returns (NFR-2). Deleted after 30 days idle; the project store keeps everything needed to recreate it.
- **Warm pool:** a pool of pre-booted sandboxes per image (Node, Python, default stack) per cell, sized from the last hour's start rate, so new projects start fast.
- **Isolation:** one sandbox per project; no secrets inside; all outbound traffic forced through the egress proxy; CPU, memory, disk and run-time limits per plan.
- **The sandbox daemon:** a small agent inside the sandbox that exposes files, commands, ports and logs to workers, and nothing else.

</details>

<details>
<summary><b>3.6 Model gateway: model-agnostic by design</b></summary>

### 3.6 Model gateway: model-agnostic by design
- **One gateway for all models.** Every model call from every service goes through the gateway, which builds on Studio's existing model catalogue. It exposes both an Anthropic-compatible API (which the Claude Agent SDK harness speaks) and an OpenAI-compatible API, and translates between them, so a non-Claude model can drive the Architect agent if it passes the capability check below.
- **Routing by role and policy.** Each call is tagged with its role: Architect agent, verifier, plan drafting, estimation, or an app agent at run time. The gateway picks the model the user or org chose for that role, limited to the org's allowed list (C-2).
- **Any provider, including the customer's own.** Commercial APIs (Anthropic Claude, OpenAI GPT, Google Gemini and others), the customer's own keys, cloud-hosted models (Bedrock, Azure, Vertex in the customer's account), and self-hosted open-source or in-house models registered as private endpoints.
- **Capability check.** Before a model can be the Architect agent, it must pass a minimum bar for tool use and context length, measured on the benchmark set. This protects build quality on-prem.
- **No silent switching.** Failover goes only to models the organisation's policy pre-approves as fallbacks, and is always announced. With no approved fallback, the run pauses and asks (BL-3).
- **Metering.** Every call is logged with project, part, run, role, model, tokens and cost. This feeds per-part actual cost, budgets and the estimator.

</details>

<details>
<summary><b>3.7 Live preview and the preview proxy</b></summary>

### 3.7 Live preview and the preview proxy
```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Arial","fontSize":"15px","primaryColor":"#FFFFFF","primaryBorderColor":"#1A1A19","primaryTextColor":"#1A1A19","lineColor":"#1A1A19","secondaryColor":"#FFFFFF","tertiaryColor":"#FFFFFF","clusterBkg":"#FFFFFF","clusterBorder":"#D6D4CC","edgeLabelBackground":"#FFFFFF","actorBkg":"#FFFFFF","actorBorder":"#1A1A19","actorTextColor":"#1A1A19","actorLineColor":"#A8A69F","signalColor":"#1A1A19","signalTextColor":"#1A1A19","noteBkgColor":"#FFFFFF","noteBorderColor":"#D6D4CC","noteTextColor":"#1A1A19","labelBoxBkgColor":"#FFFFFF","labelBoxBorderColor":"#1A1A19","labelTextColor":"#1A1A19","loopTextColor":"#1A1A19","activationBkgColor":"#F5F4F0","activationBorderColor":"#1A1A19","sequenceNumberColor":"#FFFFFF","textColor":"#1A1A19","titleColor":"#1A1A19","nodeTextColor":"#1A1A19"},"sequence":{"mirrorActors":false,"actorMargin":36,"wrap":true,"width":150}}}%%
sequenceDiagram
  autonumber
  box rgb(255, 255, 255) People
    participant B as Browser
  end
  box rgb(230, 245, 246) The cell
    participant PX as Preview proxy
    participant SB as Sandbox dev server
  end
  %% A white card, so ink lines read on GitHub's dark theme too
  rect rgb(255, 255, 255)
    B->>PX: Open preview--project.app domain with a one-time code
    PX->>PX: Swap the code for a session cookie (this project only, short-lived)
    PX-->>B: Set the cookie, redirect (no token left in the URL)
    B->>PX: Page and asset requests
    PX->>SB: Forward to the running dev server
    SB-->>PX: HTML
    PX-->>B: HTML, with the element picker and console bridge added
    B-->>PX: Live-reload WebSocket
    PX-->>SB: Passed through
  end
```
[PNG](diagrams/A4-preview-path.png)


- Each project gets a preview domain on a **separate registrable domain** from the builder (as today's `app.architect.new` and `architect.space` are), so generated code can never read or set the builder's cookies. It is served by the preview proxy, which forwards to the dev server running in the sandbox, as today.
- **Access:** the web app gets a one-time code for the preview. The proxy exchanges it for a short-lived, project-scoped cookie (`SameSite=None; Partitioned`, so it works inside the builder's iframe) and redirects, so no token is left in the URL (today it sits in the query string).
- **Injection:** the proxy injects the element picker (click-to-edit) and the console bridge into HTML responses, as today, and passes live-reload WebSockets straight through.
- **Paused sandbox:** if the sandbox is paused, the proxy shows a "waking up" page and resumes it.

</details>

<details>
<summary><b>3.8 Developer view: editor and terminal</b></summary>

### 3.8 Developer view: editor and terminal
- The code editor and terminal in Developer view connect through the API gateway to the sandbox daemon over a WebSocket (a terminal session for the shell, file APIs for the editor), with the same permissions as the Architect agent.
- Per-part diffs come from the git commits made when each part reaches Works.

</details>

<details>
<summary><b>3.9 Egress proxy and secrets</b></summary>

### 3.9 Egress proxy and secrets
- All traffic leaving a sandbox or a launched app goes through the egress proxy.
- **Secrets over HTTP(S):** code refers to a placeholder (for example `SLACK_TOKEN`); the proxy, which the sandbox trusts as an intercepting proxy, swaps in the real credential from the secrets vault on the way out. Generated code, logs and sandboxes never contain real keys.
- **Other credentials:** database connections and signed requests (for example AWS-signed calls) can't be rewritten in flight, so they get short-lived credentials issued per workload instead of long-lived keys.
- **Personal data:** the org's redaction rules (C-4) are applied at the proxy before data leaves.
- **No single point of failure:** the proxy runs on every node in a cell, not as one central box.
- **Policy:** destinations are checked against the org's allow list (C-4). Blocked calls fail with a clear error and are recorded.
- **Data-flow view:** every allowed destination is logged per project, which is what the data-flow view in Governance draws.

</details>

<details>
<summary><b>3.10 GitHub, the git executor, and users' coding agents</b></summary>

### 3.10 GitHub, the git executor, and users' coding agents
```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Arial","fontSize":"15px","primaryColor":"#FFFFFF","primaryBorderColor":"#1A1A19","primaryTextColor":"#1A1A19","lineColor":"#1A1A19","secondaryColor":"#FFFFFF","tertiaryColor":"#FFFFFF","clusterBkg":"#FFFFFF","clusterBorder":"#D6D4CC","edgeLabelBackground":"#FFFFFF","actorBkg":"#FFFFFF","actorBorder":"#1A1A19","actorTextColor":"#1A1A19","actorLineColor":"#A8A69F","signalColor":"#1A1A19","signalTextColor":"#1A1A19","noteBkgColor":"#FFFFFF","noteBorderColor":"#D6D4CC","noteTextColor":"#1A1A19","labelBoxBkgColor":"#FFFFFF","labelBoxBorderColor":"#1A1A19","labelTextColor":"#1A1A19","loopTextColor":"#1A1A19","activationBkgColor":"#F5F4F0","activationBorderColor":"#1A1A19","sequenceNumberColor":"#FFFFFF","textColor":"#1A1A19","titleColor":"#1A1A19","nodeTextColor":"#1A1A19"},"flowchart":{"curve":"basis","padding":14,"nodeSpacing":36,"rankSpacing":44}}}%%
flowchart TB
  %% A white card, so ink lines read on GitHub's dark theme too
  subgraph CARD[" "]
    direction TB
    U["Sam installs the GitHub App on chosen repos<br/>Production: contents and pull requests write, on those repos only<br/>Prototype: read-only contents and metadata"]
    U --> GE["Git executor<br/>short-lived tokens per operation"]
    GE -- "import: clone and analyse" --> AN["Stack · run command · tests · agents"]
    AN --> PL["The plan from the repo<br/>parts that already work are kept"]
    PL --> BLD["Build the changed parts in the sandbox"]
    BLD --> PR["Branch and pull request<br/>listing the plan's parts"]
    PR --> REV["Review on GitHub"]
    REV --> MRG["Merge to main"]
    POL["Governance on: merging to main<br/>needs an Owner or Admin approval"] -.-> MRG
    MRG -- "webhook" --> SYNC["Git executor pulls the merge into the sandbox<br/>and re-runs the affected checks"]
  end
  classDef people fill:#FFFFFF,stroke:#D6D4CC,stroke-width:1.5px,color:#1A1A19
  classDef control fill:#EEEAFB,stroke:#C9BEF2,stroke-width:1.5px,color:#1A1A19
  classDef cell fill:#E6F5F6,stroke:#A9DCE0,stroke-width:1.5px,color:#1A1A19
  classDef studio fill:#E8F1E6,stroke:#B7D3B0,stroke-width:1.5px,color:#1A1A19
  classDef outside fill:#F1F0EC,stroke:#D6D4CC,stroke-width:1.5px,color:#1A1A19
  classDef approval fill:#F0EAFA,stroke:#6236AD,stroke-width:1.5px,color:#1A1A19
  class U people
  class GE,AN,PL,BLD,SYNC cell
  class PR,REV,MRG outside
  class POL approval
  style CARD fill:#FFFFFF,stroke:#D6D4CC,color:#1A1A19
```
[PNG](diagrams/A7-github-flow.png)


- **GitHub App, per repo.** Users install the Architect GitHub App on chosen repos only. The git executor service mints short-lived installation tokens per operation; tokens never enter the sandbox. In production the App needs contents and pull-requests write on those repos; the prototype's App is read-only (contents and metadata), so its PRs are simulated.
- **Import:** clone, analyse (stack, run command, tests, agents), and copy the code into the sandbox. The analysis produces the plan from the repo (B-2).
- **Changes as PRs:** the git executor pushes a branch and opens a PR whose description lists the plan's parts. Nothing is committed to the default branch by Architect; with governance on, merging to main needs an Owner or Admin approval.
- **Two-way sync:** GitHub webhooks tell the git executor about merges and outside commits; it pulls them into the sandbox and re-runs the affected checks.
- **Users' coding agents:** Architect's public MCP server and CLI expose the same tools (`get_blueprint`, `update_item`, `run_in_sandbox`, `run_tests`, `open_pr`, `request_approval`, `get_preview_url`) with a scoped project token. Calls go through the API gateway and the same policy checks as the Architect agent.

</details>

<details>
<summary><b>3.11 Data: project store and event log</b></summary>

### 3.11 Data: project store and event log
- **Postgres** (per cell): projects, plans, parts, checks, runs, policies, approvals, audit log.
- **Object storage:** files, attachments, proofs (screenshots, logs), sandbox snapshots and agent checkpoints.
- **Redis** (per cell, as today): sandbox state, sessions, realtime fan-out.
- **Event log:** every run, model call, approval and data-flow event is written once, then used by metering, the audit log, the analytics behind the success metrics, and the estimator.

</details>

<details>
<summary><b>3.12 Launching users' apps</b></summary>

### 3.12 Launching users' apps
- **Two launch paths.** With governance off (a personal or small-team workspace), Launch is one step, **Test → Live**, and sharing a Team version first is optional. With governance on, it's **Test → Team → Live**, and Live waits for an Owner or Admin's approval (C-5). Both keep every earlier version, so going back is one click.
- **Build:** the orchestrator builds a container image from the project's code with standard Node and Python build packs, on an isolated build runner, then runs the pre-publish checks (tests, security and personal-data scan, secrets, sample data, and the stateless check in NFR-7).
- **Run:** a Kubernetes-based app runtime with scale-to-zero for Test versions and an autoscaling range for Live (at least 2 copies; NFR-8). Front-end assets are served from a CDN.
- **Per environment:** each of Test, Team and Live gets its own database (managed Postgres), object storage bucket, secrets and URL. Agent calls from the app go through a queue and agent workers, so traffic spikes wait instead of crashing the app.
- **App database changes:** the app's database migrations run as a gated step before each promote, and a failed migration stops the promote.
- **Domains:** apps get `<app>.<apps domain>` on a domain separate from the builder's, by default, custom domains with automatic TLS certificates, and rollback to the previous image in under 2 minutes.
- **App agents:** Lyzr agents run on Studio's runtime as today. CrewAI and LangGraph agents run as containers next to the app, behind the standard agent interface (inputs, outputs, tools, traces), and are registered in the shared Studio registry.
- **Migration:** existing apps keep running on Netlify. "Move to 2.0" (flow F9) rebuilds and relaunches them on the new runtime, then moves the domain.

</details>

## 4. Governance, security and where it runs
```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Arial","fontSize":"15px","primaryColor":"#FFFFFF","primaryBorderColor":"#1A1A19","primaryTextColor":"#1A1A19","lineColor":"#1A1A19","secondaryColor":"#FFFFFF","tertiaryColor":"#FFFFFF","clusterBkg":"#FFFFFF","clusterBorder":"#D6D4CC","edgeLabelBackground":"#FFFFFF","actorBkg":"#FFFFFF","actorBorder":"#1A1A19","actorTextColor":"#1A1A19","actorLineColor":"#A8A69F","signalColor":"#1A1A19","signalTextColor":"#1A1A19","noteBkgColor":"#FFFFFF","noteBorderColor":"#D6D4CC","noteTextColor":"#1A1A19","labelBoxBkgColor":"#FFFFFF","labelBoxBorderColor":"#1A1A19","labelTextColor":"#1A1A19","loopTextColor":"#1A1A19","activationBkgColor":"#F5F4F0","activationBorderColor":"#1A1A19","sequenceNumberColor":"#FFFFFF","textColor":"#1A1A19","titleColor":"#1A1A19","nodeTextColor":"#1A1A19"},"flowchart":{"curve":"basis","padding":14,"nodeSpacing":36,"rankSpacing":44}}}%%
flowchart TB
  %% A white card, so ink lines read on GitHub's dark theme too
  subgraph CARD[" "]
    direction TB
    subgraph M1["Lyzr Cloud (default)"]
      direction LR
      c1["Control plane: Lyzr"]
      d1["Data plane: Lyzr, shared cells"]
      s1["Lyzr Studio: Lyzr's,<br/>each workspace's own account"]
    end
    subgraph M2["Dedicated"]
      direction LR
      c2["Control plane: Lyzr"]
      d2["Data plane: Lyzr, single-tenant,<br/>in the customer's chosen region"]
      s2["Lyzr Studio: Lyzr's,<br/>each workspace's own account"]
    end
    subgraph M3["Customer's own cloud (VPC)"]
      direction LR
      c3["Control plane: Lyzr<br/>no customer code, data or prompts"]
      d3["Data plane: the customer's cloud<br/>(AWS, GCP or Azure)"]
      s3["Lyzr Studio runtime and registry:<br/>inside the customer's cell"]
    end
    subgraph M4["On-prem or air-gapped"]
      direction LR
      c4["Control plane: a local copy of<br/>Lyzr's, from signed releases"]
      d4["Data plane: the customer's<br/>own servers"]
      s4["Lyzr Studio runtime and registry:<br/>inside the customer's cell"]
    end
    c1 ~~~ d1 ~~~ s1
    c2 ~~~ d2 ~~~ s2
    c3 ~~~ d3 ~~~ s3
    c4 ~~~ d4 ~~~ s4
    M1 ~~~ M2 ~~~ M3 ~~~ M4
  end
  classDef people fill:#FFFFFF,stroke:#D6D4CC,stroke-width:1.5px,color:#1A1A19
  classDef control fill:#EEEAFB,stroke:#C9BEF2,stroke-width:1.5px,color:#1A1A19
  classDef cell fill:#E6F5F6,stroke:#A9DCE0,stroke-width:1.5px,color:#1A1A19
  classDef studio fill:#E8F1E6,stroke:#B7D3B0,stroke-width:1.5px,color:#1A1A19
  classDef outside fill:#F1F0EC,stroke:#D6D4CC,stroke-width:1.5px,color:#1A1A19
  classDef approval fill:#F0EAFA,stroke:#6236AD,stroke-width:1.5px,color:#1A1A19
  class c1,c2,c3,c4 control
  class d1,d2,d3,d4 cell
  class s1,s2,s3,s4 studio
  style M1 fill:#FFFFFF,stroke:#D6D4CC,stroke-width:1.5px,color:#1A1A19
  style M2 fill:#FFFFFF,stroke:#D6D4CC,stroke-width:1.5px,color:#1A1A19
  style M3 fill:#FFFFFF,stroke:#D6D4CC,stroke-width:1.5px,color:#1A1A19
  style M4 fill:#FFFFFF,stroke:#D6D4CC,stroke-width:1.5px,color:#1A1A19
  style CARD fill:#FFFFFF,stroke:#D6D4CC,color:#1A1A19
```
_The same container images and Helm charts in every mode. Models: commercial APIs, the customer's own, or self-hosted, as policy allows._

[PNG](diagrams/A5-deployment-modes.png)


| Mode | Control plane | Data plane | Who it's for |
|---|---|---|---|
| **Lyzr Cloud** | Lyzr | Lyzr | Individuals, teams, most companies |
| **Dedicated** | Lyzr | Lyzr, single-tenant, in the customer's chosen region | Companies that need data residency without running anything |
| **Customer's own cloud (VPC)** | Lyzr (stores no customer code, data or prompts) | Customer's AWS account first, then Azure and GCP | Regulated enterprises that want data in their account |
| **On-prem or air-gapped** | A local copy of Lyzr's, from signed releases | Customer | Governments, defence, strict data-residency |

- **What stays in the data plane:** code, files, prompts, model calls, app data, secrets, logs and plan content (part titles and descriptions come from prompts, so they can be sensitive).
- **What crosses to the control plane (customer-cloud mode), and nothing else:**
  - usage counts for billing;
  - health and version;
  - plan IDs, statuses and costs (for example "part 7 · Works · 12 credits"), with no titles;
  - policy, config and updates coming in.

  The data-plane agent rejects any message outside this schema, and every message that crosses is recorded in the customer's own audit log. The customer can cut the link at any time; see the next point for what keeps working.
- **If the control plane is unreachable:** customer-cloud data planes keep running launched apps and in-progress builds; new sign-ins use the customer's own identity provider through the data plane, and policy is cached locally, so only billing and new projects wait.
- **Same images everywhere:** every service ships as the same container images with Helm charts, so the modes differ in configuration, not code. A data-plane agent connects outward to the control plane, so customers don't open inbound ports.
- **Models in sovereign modes:** the model gateway runs in the data plane, so the Architect agent and app agents can use the customer's own or self-hosted models without data leaving.
- **Lyzr Studio in sovereign modes:** in VPC and on-prem modes, the Studio runtime and agent registry run inside the customer's cell, next to the model gateway, so agent prompts and data stay in the customer's cloud too.
- **Security controls:**
  - tenant isolation by cell and by namespace;
  - sandboxes with no secrets and forced egress through the proxy;
  - short-lived GitHub tokens;
  - policy checks on every action that leaves a sandbox;
  - an append-only audit log;
  - repos, documents and tool output treated as untrusted data, with prompt-injection defences;
  - no third-party trackers in customer-cloud and on-prem tenants.

### Security and governance path, from the prototype to v3
| Stage | What's in place |
|---|---|
| **The prototype, now** | Row-level security on every table; keys and passwords encrypted in Supabase Vault and never returned to the browser; model and provider keys only in server code; a read-only GitHub App; MCP tests refuse private and local addresses, even after DNS; demo caps and a 7-day cleanup; an append-only audit log of every governance decision |
| **v1** | Keycloak SSO; the policy service checked before anything leaves a sandbox; the egress proxy injecting secrets; short-lived GitHub tokens per operation; approvals for Live, new apps and keys; repos, documents and tool output treated as untrusted data, with prompt-injection defences |
| **v2** | The data plane in the customer's own cloud with its own models; the data-flow view enforced at the proxy; no third-party trackers in sovereign tenants; new services enter the audit scope of Lyzr's existing SOC 2 Type II, ISO 27001:2022 and ISO 42001 programmes (listed on Lyzr's Trust Center, security.lyzr.ai) before general availability |
| **v3** | On-prem and air-gapped installs from signed releases; customer-held keys; new services enter the audit scope of Lyzr's existing SOC 2 Type II, ISO 27001:2022 and ISO 42001 programmes (listed on Lyzr's Trust Center, security.lyzr.ai) before general availability |

<details>
<summary><b>5. Scaling to thousands of users</b>: cells, a capacity sketch, and the likely bottleneck</summary>

## 5. Scaling to thousands of users
```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Arial","fontSize":"15px","primaryColor":"#FFFFFF","primaryBorderColor":"#1A1A19","primaryTextColor":"#1A1A19","lineColor":"#1A1A19","secondaryColor":"#FFFFFF","tertiaryColor":"#FFFFFF","clusterBkg":"#FFFFFF","clusterBorder":"#D6D4CC","edgeLabelBackground":"#FFFFFF","actorBkg":"#FFFFFF","actorBorder":"#1A1A19","actorTextColor":"#1A1A19","actorLineColor":"#A8A69F","signalColor":"#1A1A19","signalTextColor":"#1A1A19","noteBkgColor":"#FFFFFF","noteBorderColor":"#D6D4CC","noteTextColor":"#1A1A19","labelBoxBkgColor":"#FFFFFF","labelBoxBorderColor":"#1A1A19","labelTextColor":"#1A1A19","loopTextColor":"#1A1A19","activationBkgColor":"#F5F4F0","activationBorderColor":"#1A1A19","sequenceNumberColor":"#FFFFFF","textColor":"#1A1A19","titleColor":"#1A1A19","nodeTextColor":"#1A1A19"},"flowchart":{"curve":"basis","padding":14,"nodeSpacing":36,"rankSpacing":44}}}%%
flowchart TB
  %% A white card, so ink lines read on GitHub's dark theme too
  subgraph CARD[" "]
    direction TB
    G["Lyzr control plane<br/>CDN · API gateway · identity · tenant directory · billing · policy authoring"]
    subgraph C3["Cell N (region B, or a VPC)"]
      direction TB
      w3["Workers<br/>autoscale on queue depth"]
      s3["Sandbox fleet and warm pool<br/>about 500 running sandboxes"]
      r3[("Cell Postgres and Redis")]
    end
    subgraph C2["Cell 2 (region A)"]
      direction TB
      w2["Workers<br/>autoscale on queue depth"]
      s2["Sandbox fleet and warm pool<br/>about 500 running sandboxes"]
      r2[("Cell Postgres and Redis")]
    end
    subgraph C1["Cell 1 (region A)"]
      direction TB
      w1["Workers<br/>autoscale on queue depth"]
      s1["Sandbox fleet and warm pool<br/>about 500 running sandboxes"]
      r1[("Cell Postgres and Redis")]
    end
    w1 ~~~ s1 ~~~ r1
    w2 ~~~ s2 ~~~ r2
    w3 ~~~ s3 ~~~ r3
    G --> C1
    G --> C2
    G --> C3
  end
  classDef people fill:#FFFFFF,stroke:#D6D4CC,stroke-width:1.5px,color:#1A1A19
  classDef control fill:#EEEAFB,stroke:#C9BEF2,stroke-width:1.5px,color:#1A1A19
  classDef cell fill:#E6F5F6,stroke:#A9DCE0,stroke-width:1.5px,color:#1A1A19
  classDef studio fill:#E8F1E6,stroke:#B7D3B0,stroke-width:1.5px,color:#1A1A19
  classDef outside fill:#F1F0EC,stroke:#D6D4CC,stroke-width:1.5px,color:#1A1A19
  classDef approval fill:#F0EAFA,stroke:#6236AD,stroke-width:1.5px,color:#1A1A19
  class G control
  class w1,s1,r1,w2,s2,r2,w3,s3,r3 cell
  style C1 fill:#FFFFFF,stroke:#A9DCE0,stroke-width:1.5px,color:#1A1A19
  style C2 fill:#FFFFFF,stroke:#A9DCE0,stroke-width:1.5px,color:#1A1A19
  style C3 fill:#FFFFFF,stroke:#A9DCE0,stroke-width:1.5px,color:#1A1A19
  style CARD fill:#FFFFFF,stroke:#D6D4CC,color:#1A1A19
```
_Each workspace is pinned to one cell, so a busy or failing cell affects only its own workspaces. Capacity grows by adding cells._

[PNG](diagrams/A6-scaling-cells.png)


- **Cells.** The system is split into cells. Each cell has its own workers, sandbox fleet, workflow engine, realtime hub, Postgres and Redis, and serves a set of tenants. Lyzr's control plane (gateway, identity, tenant directory, billing) routes each tenant to its cell. A noisy or failing cell affects only its tenants (NFR-6), and capacity grows by adding cells.
- **Stateless services scale horizontally.** The gateway, plan service and realtime hub run as multiple copies behind load balancers. Workers scale on queue depth.
- **Sandboxes scale with active work, not users.** Paused sandboxes cost storage only.

**Capacity sketch (assumptions, for sizing):**

| Assumption | Value |
|---|---|
| Daily active builders | 10,000 |
| Peak share with a project open | 15% → 1,500 open projects |
| Share of those actively building at once | about one third → **about 500 running sandboxes**; the rest paused |
| Sandbox size | 2 vCPU, 4 GB → about 1,000 vCPU and 2 TB of memory at peak, plus a 10% warm pool |
| Model calls | about one call every 10–20 seconds per active build → **25–50 calls per second** through the gateway |
| Model tokens | about 30k tokens of context per call, mostly repeated and cached → roughly 45–90M input tokens per minute at peak; prompt caching is required to keep this affordable, and the cost per active build-hour is tracked from day one |
| Cells | about 500 active sandboxes per cell → 1–2 cells at this load; NFR-1's 1,000 active sessions fits 2 cells, and 10,000 fits about 20 |

- **Model rate limits and token throughput** are the likeliest bottleneck at peak. The gateway spreads load across provider regions and keys, queues bursts, and reports queueing time in the build view instead of failing.
- **Postgres** per cell carries metadata only; large files live in object storage. The event log is sent to an analytics store for metrics.

</details>

<details>
<summary><b>6. Deploying Architect itself</b>: CI/CD, feature flags, database changes, releases for customer clouds</summary>

## 6. Deploying Architect itself
- **CI/CD:** every service builds a container image; changes go through automated tests, then a staging cell, then a canary cell, then all cells.
- **Feature flags:** the existing per-tenant flags control rollout, so a feature can be enabled for design partners first.
- **Database changes:** backwards-compatible migrations (expand, then contract), applied cell by cell.
- **Customer clouds and on-prem:** releases ship as versioned Helm charts. Customers on their own cloud receive updates from the control plane in maintenance windows they approve; on-prem customers pull signed releases on their own schedule.

</details>

<details>
<summary><b>7. Observability and cost metering</b>: traces, metrics per part and run, health, telemetry in customer clouds</summary>

## 7. Observability and cost metering
- **Traces:** OpenTelemetry traces follow each run across gateway, orchestrator, workers, sandbox and model calls, tagged with project and part.
- **Metrics per part and run:** tokens, sandbox minutes, fix attempts and duration, which power the estimator, budgets, the fix-spend metric and readiness.
- **Health:** per-cell dashboards for sandbox start times (NFR-2), event latency (NFR-3), availability (NFR-4) and model-gateway queueing.
- **In customer clouds,** telemetry stays in the customer's account by default; only billing counters go to the control plane.

</details>

## 8. Key decisions and trade-offs
| Decision | Alternatives considered | Why this one | What it costs us |
|---|---|---|---|
| Split control plane and data plane | One deployable product per mode | One codebase serves cloud, customer cloud and on-prem | Careful boundary design; some features need both planes |
| Agent loop in workers, not in the sandbox | Keep today's in-sandbox harness | No lost work, no keys in sandboxes, verifier separation | Extra network hop per tool call; more moving parts |
| Sandbox daemon speaks MCP | A private protocol | Architect agent and users' coding agents share one tool surface and one policy | MCP's evolving spec to track |
| Keep E2B behind an interface | Build our own sandbox fleet now | Proven, already integrated, self-hostable | Vendor dependency in Lyzr Cloud (mitigated by the interface) |
| Temporal for durable workflows | Queue plus hand-written retries | Resumable builds, visible history, runs on-prem | Another system to operate |
| Own container runtime for launched apps | Stay on Netlify | Python back ends, agent workers, autoscaling, same runtime in every mode | We now run hosting; mitigated by managed Kubernetes in Lyzr Cloud |
| Egress proxy injects secrets | Environment variables in sandboxes (today) | Keys can't leak into code or logs; enables the data-flow view | All outbound traffic goes through one more hop |
| Cells for scale and isolation | One large shared cluster | Contained failures, predictable growth, a customer cloud is just another cell | More environments to operate and monitor |

### Trade-offs: what we chose, and what we gave up
| We chose | We gave up | Why |
|---|---|---|
| **A separate verifier** that writes checks before code | Cost (about 25% more per build) and some time | A builder can't grade its own work; "proof per part" is what makes the plan trustworthy, and trust is the product |
| **A staged launch** (Test → Team → Live with approval) when governance is on | Speed for solo users | Enterprises need someone to sign off on Live. Solo users and personal workspaces keep the fast path, Test → Live in one step |
| **Lyzr Studio as the agent runtime** | Some framework freedom | One runtime, governance and evals, and reuse across apps. Imported CrewAI and LangGraph agents still run as they are; converting them is optional |

## 9. What the assignment prototype implements
![What this repo runs, and on what: Vercel and Supabase in Mumbai](diagrams/prototype-as-built.png)
_What this repo runs, and on what._

<details>
<summary>The system map with what the prototype uses for each box</summary>

![The system map with what the prototype uses for each box: REAL, PART, SIM or NOT BUILT](diagrams/system-map-prototype.png)
_The same system map as [section 3](#3-components), with what the prototype uses for each box: **REAL** works for real, **PART** real records with a simulated effect, **SIM** simulated, **NOT BUILT** design only._

</details>

Part by part: the production design (sections 2–8), what the prototype does, and where. The [decisions log](../DECISIONS.md) records every place the prototype differs from the spec, and why. Every simulated surface carries the **Simulated** label in the product.

**The prototype has no sandbox.** No code is written, run or deployed. The build is a precomputed event timeline replayed on the clock (`src/lib/sim/timeline.ts`, `src/server/sim/run.ts`); the preview is a shell drawn from the plan's parts, or the Meeting Prep sample (`public/preview/`); and the terminal matches six safe commands (`npm test`, `pytest`, `git status`, `git diff`, `ls`, `cat`, plus `clear` and `help`) to reads of the project's own data and never executes anything (`src/lib/terminal.ts`).

| Part | In production (this design) | In the prototype | Real or simulated | Where |
|---|---|---|---|---|
| Web app, sign-in, workspaces | Next.js behind one API gateway; Keycloak SSO for enterprises | Next.js 16; Supabase Auth (Google, GitHub, email); two workspaces per person; roles checked on every server action; row-level security on every table | **Real** | `src/app`, `src/server/workspace.ts`, `supabase/migrations/` |
| Writing the plan | Plan service + model gateway + estimator from metered history | Parts, checks, costs, defaults and questions from a real model through one gateway; the server decides what blocks Build; the conflict guard on changes | **Real** | `src/server/blueprint/`, `src/lib/gateway.ts`, `src/server/estimate.ts` |
| Models | Gateway with policy routing, metering and private endpoints | Gemini and OpenRouter's free model are live; Claude and GPT are real when their key is set, otherwise Gemini answers and the picker says Simulated. On a Gemini quota refusal, OpenRouter answers and the chat says so | **Real** (Claude and GPT simulated without keys) | `src/lib/gateway.ts` |
| Chat and change cards | The same, through the plan service | Questions answered; changes become a card with its price; nothing changes until Apply | **Real** (the change is then built by the simulator) | `src/server/actions/chat.ts` |
| Run orchestrator, workers, sandbox, verifier | Durable workflows; agent workers outside the sandbox; checks before code | A precomputed event timeline per run, replayed on the clock; parts turn Works through Realtime | **Simulated** (Realtime events are real) | `src/lib/sim/`, `src/server/sim/run.ts`, `sim/scenarios/` |
| Live preview | Preview proxy to the sandbox's dev server | A shell drawn from the plan's parts, or the Meeting Prep sample | **Simulated** | `public/preview/` |
| Developer view and panel | Editor and terminal over the sandbox daemon | Code generated from each part (an imported repo's files are real); a terminal of six safe commands that never executes anything; console, build logs and live logs from the simulated run | **Simulated** (imported files are real) | `src/app/p/[id]/dev-view.tsx`, `src/app/p/[id]/dev-panel.tsx`, `src/lib/terminal.ts` |
| Lyzr Studio agents | Agents made in the workspace's own Studio as parts are built; Studio's runtime runs them | The same: each workspace connects its own Lyzr key; agents are made in that Studio when their part works; saved edits sync; Try it runs on Studio; the seeded Research agent is a shared read-only demo agent on our key, 10 runs a day | **Real** | `src/server/lyzr.ts`, `src/server/agents-core.ts`, `src/server/actions/agents.ts` |
| Connections | OAuth, MCP servers and API keys, credentials injected by the egress proxy | MCP servers: a real Test connection (initialize + tools/list, guarded); calling their tools is simulated. Apps' sign-in and API keys are simulated | **Real** (MCP test, Lyzr key) · **Simulated** (apps) | `src/server/mcp-client.ts`, `src/server/actions/mcp.ts`, `src/app/(app)/connections/` |
| Keys and passwords | Vault plus the egress proxy | Values stored encrypted in Supabase Vault and never shown again; no app uses them | **Real** storage | `supabase/migrations/0023_m510_pre_m6.sql`, `src/server/actions/keys.ts` |
| GitHub | GitHub App per repo, git executor, PRs, two-way sync | Read-only GitHub App: install, repo, branch and folder lists, reading files, the import analysis. Branches, PRs and sync are simulated | **Real** (read) · **Simulated** (write) | `src/server/github.ts`, `src/server/import.ts`, `src/server/pull-requests.ts` |
| Governance | Policy service checked before anything leaves a sandbox; approvals; append-only audit | Policies, approvals, allow-rules, budgets and the audit log are stored for real, and the app's own gates enforce them (a disallowed model, a stopped budget, Live waiting for an Owner or Admin's approval). Their effects outside the app are simulated: no egress proxy, no real deploy | **Stored for real, effects simulated** | `src/server/policy.ts`, `src/server/approvals.ts`, `src/app/(app)/governance/` |
| Launch | Container image, pre-publish checks, environments, domains, rollback | Test → Live (governance off) or Test → Team → Live with approval; checklist, domains and going back, all simulated | **Simulated** | `src/server/actions/launch.ts`, `src/lib/launch.ts` |
| Data tab | The app's own database per environment | Sample tables seeded from the parts; your uploaded CSV or Excel becomes the Test version's data | **Simulated** | `src/lib/app-data.ts` |
| Your coding agent over MCP | Architect's public MCP server and CLI | Project tokens are real records; the server is a spec page (`/docs/mcp`); sessions are scripted | **Simulated** | `src/lib/mcp.ts`, `src/app/docs/mcp/` |
| Demo access | Not in the product | One-click anonymous sign-in with its own seeded workspace; 5 plans a day; deleted after 7 days by the daily cron | **Real** | `src/server/actions/auth.ts`, `src/server/demo.ts`, `src/app/api/cron/purge/` |
| Analytics | Event log into an analytics store | Vercel Analytics for page views; first-party product events in `analytics_events`, insert-only | **Real** | `src/server/analytics.ts`, `docs/analytics.sql` |
| Hosting | Cells per region; a customer's cloud is another cell | Vercel (region `bom1`) and Supabase (`ap-south-1`), **both in Mumbai** | **Real** | `vercel.json` |

**Why Mumbai for both.** The person demoing and building it is in India, and a server action makes several database round trips: keeping the app and the database in the same region keeps each round trip around a millisecond instead of a cross-region hop of 100 ms or more.

## 10. Lyzr Studio integration
- **Each workspace connects its own Lyzr key** (Connections › Lyzr Studio, Owners and Admins). It's checked with Lyzr, stored encrypted, and never returned to the browser. No workspace's agents or data go to another account.
- **Agents are created in that Studio when their part is built.** When an agent part reaches Works, Architect creates it in the workspace's Studio with its name, instructions, model settings and tools, and keeps its Studio id. If Studio can't be reached, the part still works and the agent shows "Not in Studio yet · Retry".
- **Saved edits sync both ways.** Saving an agent's settings in Architect updates it in Studio; in the product, an edit made in Studio comes back through the shared agent registry (the prototype syncs Architect → Studio on save).
- **In VPC and on-prem modes, Studio runs inside the customer's cell.** The Studio runtime and agent registry are deployed into the customer's cell (section 4), so a built app's agents never send prompts or data out of the customer's cloud. In Lyzr Cloud and Dedicated, it's Lyzr's shared Studio with each workspace's own account.
- **Imported CrewAI and LangGraph agents stay in their framework.** They run as containers behind the standard agent interface. Converting one to a Studio agent, or wrapping it as a tool other agents call, is optional and shows its cost first.
- **Why this is the moat:**
  - **One runtime.** Every app's agents run on the same Studio runtime, so they're operated, scaled and observed one way.
  - **Governance and evals.** The organisation's model policy, approvals and audit apply to agents as well as code, and Studio's evals measure them over time.
  - **Reuse across apps.** An agent built for one app can be attached as a part of the next one, instead of being rebuilt.
  - **No context switch.** The same agent is visible and editable in Architect and in Studio.

## 11. Cost per build
The arithmetic from PRD section 11, for a small build of 6 parts on a mid-tier model ($3 per million input tokens, $15 per million output, repeated context cached at 10% of the input price). These are assumptions, to be replaced by metered actuals in beta:

| Cost line | Arithmetic | Cost |
|---|---|---|
| Architect agent | 1.0M input tokens: 0.2M fresh × $3 + 0.8M cached × $0.30 = $0.60 + $0.24; 80k output × $15 = $1.20 | ≈ $2.04 |
| Verifier | 25% of the Architect agent's cost | ≈ $0.51 |
| Sandbox | about 20 active minutes; idle time is paused | ≈ $0.05 |
| Fixes | 2 of 6 parts need one fix, each about 30% of that part's cost: 2 × 0.3 × ($2.04 ÷ 6) | ≈ $0.20 |
| **Total cost** | | **≈ $2.80** |

At a 2.5× markup (about 60% gross margin) that build sells for about $7. Today's Architect charged about $2.88 for a comparable small build, so either today's builds use far fewer tokens than assumed, or verification forces a price rise or cheaper models for checks: metering in the beta decides it.

**Running cost is a separate meter.** For a small internal app on Lyzr Cloud (two small instances, a small managed Postgres, about 1,000 agent runs a month on a small model), we assume roughly $40–60 a month, shown on the app's own budget. The prototype itself runs on free tiers: Vercel, Supabase, Gemini's free quota and OpenRouter's free models.

<details>
<summary><b>12. What breaks first at scale, and the fix</b>: sandboxes, model rate limits, verifier cost, Lyzr Studio, the egress proxy</summary>

## 12. What breaks first at scale, and the fix
| What breaks first | Why | Fix |
|---|---|---|
| **Sandboxes** | Hundreds of builds start at once; cold starts and idle sandboxes cost money and time | Pause after 10 idle minutes and resume from a snapshot; warm pools per image sized from the last hour's start rate; cells that add capacity without a redesign (section 5) |
| **Model rate limits** | At peak, 25–50 calls a second through the gateway (section 5); free and even paid quotas run out | Spread load across provider regions and keys; queue bursts and show the wait; prompt caching. Failover goes only to models the organisation's policy pre-approves as fallbacks, and is always announced. (The prototype does this for Gemini → OpenRouter, said in chat.) |
| **Verifier cost** | A second agent on every part can cost a quarter of the build (section 11) | Deterministic checks first (tests, HTTP, types, screenshots); a model rubric only where no test can judge; a cheaper model for checks; checks re-run only for the parts a change touches |
| **Lyzr Studio availability** | Every built app's agents run on Studio, so a Studio outage stops them all, across every app | Agent calls go through a queue with retries, so a short outage delays answers instead of failing them; in sovereign modes Studio runs per cell, so an outage stays in one cell; Studio's status shows on each Live app and in the build view, and agent creation retries later ("Not in Studio yet · Retry") |
| **The egress proxy** | Every outbound call from every sandbox and app passes through it | Run it on every node in a cell, not as one box; pool connections; cache allow-list decisions; let large package downloads go through a verified mirror instead |

</details>

## 13. Phased plan
| Phase | Scope | Concurrency target | Where it runs |
|---|---|---|---|
| **v1 · design-partner beta** (about 2 quarters) | The plan core (A-0 to A-10), the baseline the core loop needs, connections with MCP, governance basics | 200 concurrent build sessions; 1 cell | Lyzr Cloud; AWS VPC for one partner in quarter 2 |
| **v2 · GA** (quarter 3) | Every remaining Must; Enterprise and the sovereign tier; metered estimates | 1,000 active build sessions (NFR-1); 2 cells | Lyzr Cloud, Dedicated, AWS VPC |
| **v3 · scale and sovereign** | Shoulds, two-way sync, GitLab and Bitbucket, Azure and GCP VPC, air-gapped installs | 10,000 active build sessions; about 20 cells | Every deployment mode |

<details>
<summary><b>14. Sources</b>: our research, the PRD and vendor documentation</summary>

## 14. Sources
- Our own research, in [`docs/research/`](../research/): [today's Architect, audited](../research/02-architect-today.md); [how today's system works](../research/03-architect-architecture-today.md), from our network captures and a DNS check on 2026-10-03; [the import audit](../research/04-import-audit.md); [the product comparison](../research/06-competitor-matrix.md) (Lovable, Replit, v0, Cursor, Emergent and others); [forum and survey research](../research/07-secondary-research.md).
- The [PRD](08-PRD-architect-2.md), the [decisions log](../DECISIONS.md) and [what each PRD Must does in the prototype](../COVERAGE.md).
- Vendor documentation: Lyzr Studio's Agent API (docs.lyzr.ai), the Model Context Protocol specification (modelcontextprotocol.io), E2B, Temporal, Supabase (Vault, Realtime, row-level security) and Vercel.

</details>
