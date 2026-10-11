# Competitor check: how others handle our five problems

_2026-10-02. Secondary research from official docs where available, plus 2026 reviews. Hands-on use of each competitor is still to do._

**Confidence:**
- ✓ = verified in official docs or a launch post
- ~ = from reviews or third-party guides
- ? = not found
- **Architect** = our own audit (`02`–`04`)

## 1. Value propositions: why people choose each one
| Product | Who it's for | Core promise | Why people pick it |
|---|---|---|---|
| **Architect (today)** | Business users, consultants, PMs | "System builder": prompt → plan → agents → app, for apps where "intelligence is the product" | Agents and orchestration built in (Lyzr Studio); an AI consultant; templates and a marketplace |
| **Lovable** | Non-technical founders and teams; growing enterprise use | Fastest route to a polished full-stack web app | Design quality; React + Supabase out of the box; two-way GitHub sync; strong enterprise governance |
| **Replit** | Learners through to pros | Cloud IDE + Agent + hosting in one place | Runs nearly any language; plan and build modes; 450+ connectors; pricing based on effort |
| **Emergent** | Founders, small businesses, agencies | Autonomous multi-agent builder for web and mobile | Agents for plan, front end, back end and tests; mobile support; one LLM key for everything |
| **v0 (Vercel)** | Product, design and go-to-market teams working alongside engineers | "Ship production code" on **your existing repo** | Since February 2026: imports any repo into a sandbox; branch per chat; PRs; previews tied to real deployments |
| **Rocket.new** | Founders, agencies | Prompt or Figma to app | Design-to-code; low cost (little verified detail found) |
| **Cursor** | Professional developers | AI-native IDE plus cloud agents on your repo | Parallel cloud agents, each on its own branch; automated PR preparation; Bugbot code review |
| **Codex (OpenAI)** | Developers, through ChatGPT | Hand coding tasks to cloud agents; get diffs and PRs back | Configurable environments; admin-controlled internet access; trigger with `@codex` on GitHub |
| **Claude Code** | Developers | An agent in your terminal, IDE or CI that works directly in your repo | Fine-grained permission modes, hooks, MCP, GitHub Actions, managed settings; runs on enterprise clouds |

## 2. Matrix: the five problems plus the baseline
| Capability | Architect | Lovable | Replit | Emergent | v0 | Cursor / Codex / Claude Code |
|---|---|---|---|---|---|---|
| **P1 Intent preserved** (plan → build → app, nothing dropped silently) | Plan mode and an editable PRD; a generic questionnaire can override the prompt with no reconciliation; the plan is a one-time artifact | ~ Chat/plan mode before building | ✓ Plan mode is **read-only, can't run code**; tasks with priorities; a checkpoint per task | ~ Planning agent | ? | Plan modes and spec files (`AGENTS.md`, `CLAUDE.md`); intent lives in issues and PRs |
| **Persistent requirement → proof link** | ✗ | ✗ | ✗ (tasks, but no link to tests) | ✗ | ✗ | ✗ (only through the user's own tests or CI) |
| **P2 Real vs sample made visible; verification** | Sample Data **on by default**; browser testing disabled; API probes in the log | ✓ Quick and deep **security scans**; **PII scanning**; can **block publishing** with findings | ~ App testing during builds | ~ A testing agent | ~ Previews are real deployments | ✓ Bugbot reviews; tests run in CI and cloud agents |
| **Cost shown before spend; budgets** | ✗ Shown afterwards only; credits polled | ✓ Per-member credit limits; ~ forecasting is hard | ✓ **Asks for confirmation before paid actions**; budget caps and alerts; cost per checkpoint | ✗ ~ "Debugging is the credit sink" | ? | Usage dashboards (varies) |
| **P3 Import an existing repo and keep working** | Imports from GitHub, but **ports it into Next.js**; the original stack is not run | ✓ **Cannot import**; export only | ✓ Imports and **runs common stacks**; Agent works on it; **push-back not documented** | ? | ✓ **Imports any repo** into a sandbox runtime; pulls env vars | ✓ Native: they work *in* your repo |
| **Changes back to the user's repo as branch or PR** | ✗ Agent blocked; can only create a new repo; repos sit in the `Lyzr-Apps` org | ✓ Two-way sync, branch picker, PRs (only for projects created in Lovable) | ? | ~ One-way GitHub sync | ✓ **Branch per chat, PRs against main, deploy on merge** | ✓ Branch or worktree per agent; PRs |
| **Stack flexibility** | Next.js template only | React + Supabase only | ✓ Most languages | ? | Any repo (Vercel-oriented) | Any |
| **P4 Control at the point of decision** (model, integrations, framework) | Model per agent, after planning only; integrations guessed from the prompt; agents edited in Studio; other frameworks converted or wrapped | ~ Limited model choice | ✓ Connectors panel; ~ model choice | ✓ Universal LLM key | ? | ✓ Full control (models, MCP, config files) |
| **Agents inside the generated app** | ✓ **Core strength**: Lyzr agents, KB, tools, voice (but cut in our tests) | ~ AI features | ✓ "AI integrations" (models without your own key); agent services | ~ AI model integrations | Roadmap: "end-to-end agentic workflows" in 2026 | N/A (developers build it themselves) |
| **Integrations hub** | ✗ No UI; connected accounts and MCP live in Studio | ✓ Workspace-level **connector controls** | ✓ **Connectors panel**, 450+ integrations, Enterprise custom OAuth | ~ Payment, auth, email | ✓ Snowflake and AWS data connections | ✓ MCP |
| **Approvals before risky actions** | ✗ The agent runs in `bypassPermissions` | ✓ Block publishing; "ask before sending" PII guard | ✓ Confirmation before paid actions | ? | ~ Deployment protection | ✓ Permission modes (ask, accept edits, plan, bypass), hooks |
| **P5 Governance and enterprise** | Underneath: tenants, Keycloak, SSO in generated apps, VPC claim. On top: about 15 trackers | ✓ **SSO/SCIM, roles, audit logs (90 days), security centre, ZDR models, GitHub Enterprise Server, no self-hosting** | ~ SSO, Enterprise tier | ~ Enterprise custom | ✓ Audit trails, credential management, access controls | ✓ Managed settings; Codex admin internet controls; Claude Code on enterprise clouds |
| **Self-hosted / sovereign deployment** | ✓ Claimed (VPC, on-prem); invisible in the product | ✗ | ~ | ? | ✗ (Vercel cloud) | Partial: local CLIs; Claude Code via customer cloud providers |

## 3. What the matrix tells us
1. **Direction A (the Build Contract) is open territory.** Everyone has *some* plan mode. **No one keeps a living link from each requirement to proof (a test or a running feature) to status through to production.** Replit and Architect both have plan modes that **can't run anything**. Per-item cost before spending is also unclaimed: Replit confirms cost per action, not per requirement.
2. **Direction B (repo-native) is quickly becoming expected, not a differentiator.**
   - **v0 has imported any repo and opened PRs since February 2026**, aimed at non-engineers.
   - Developer tools (Cursor, Codex, Claude Code) are native to the repo by design.
   - Lovable can't import, and Architect ports and then can't push.
   - So B belongs in the **baseline we must match** (v0 is the benchmark).
   - Our *extra* on top of v0: **agents in any framework, run natively behind one agent contract**, plus contract-linked PRs.
3. **Direction C (governance) has a strong incumbent: Lovable Enterprise.** It has connector controls, PII scanning, publish blocking, SSO/SCIM, audit logs and ZDR models. Admin toggles alone won't stand out. What Lovable and v0 *can't* offer is **sovereign deployment** (customer VPC or on-prem, zero data egress, choice of where models are hosted). That's Lyzr's edge, so C should lead with sovereignty, not just settings.
4. **Agentic apps remain Architect's natural edge.** Competitors either have AI features (Lovable, Replit, Emergent) or have it on the roadmap (v0). But our audit shows Architect cuts it first. **Delivering on the agents promise belongs in the baseline.**
5. **Cost pain is everywhere** ("credit drain" for Lovable and Emergent). Replit's confirm-before-paid-action plus budgets is the bar to beat.

## 4. Proposed baseline: what Architect 2.0 must match (parity list)
| # | Baseline capability | Benchmark |
|---|---|---|
| 1 | Prompt → working full-stack app with auth and a database | Lovable, Replit |
| 2 | Plan mode with an editable plan; checkpoints and rollback per task | Replit |
| 3 | Click-to-edit in a live preview; device sizes | Lovable, v0, Architect (already has it) |
| 4 | **Import any repo; run it as it is in a sandbox**; a default stack for new projects | v0, Replit |
| 5 | **Two-way GitHub: branch per session, PRs, deploy on merge**, on the user's own org or repo, through a GitHub App | v0, Lovable |
| 6 | Connectors panel (OAuth) + MCP + secrets, managed in one place | Replit, Lovable |
| 7 | Model choice per project and per agent; bring your own key | Emergent, Cursor |
| 8 | **Cost confirmed before paid actions; budgets and alerts** | Replit |
| 9 | Security and PII scan before publishing; can block publishing | Lovable |
| 10 | Deploy with custom domain, environments, rollback | All |
| 11 | Teams: roles, sharing, SSO/SCIM, audit log | Lovable Enterprise |
| 12 | **Agents in the app actually created and connected** (no silent cuts) | Architect's own promise |

**Differentiators on top (our directions):** the A Build Contract; B+ any-framework agents run natively behind one contract; C sovereign governance plane (VPC, on-prem, zero egress, model-hosting policy, data-flow view).

## Sources
- Lovable: [GitHub sync](https://docs.lovable.dev/integrations/github), [Lovable for Enterprise](https://docs.lovable.dev/introduction/lovable-for-enterprise), [Superblocks review](https://www.superblocks.com/blog/lovable-enterprise)
- Replit: [Plan vs Build mode](https://docs.replit.com/learn/plan-vs-build-mode), [AI billing](https://docs.replit.com/billing/ai-billing), [Import from GitHub](https://docs.replit.com/getting-started/quickstarts/import-from-github), [Integrations](https://docs.replit.com/features/integrations/overview)
- v0: [Introducing the new v0 (Feb 2026)](https://vercel.com/blog/introducing-the-new-v0)
- Emergent: [Geekflare review](https://geekflare.com/guides/emergent-ai-review/)
- Cursor: [Cursor 3 cloud agents](https://skills-hub.ai/blog/cursor-3-cloud-agents-2026)
- Codex: [Codex cloud](https://developers.openai.com/codex/cloud)
- Claude Code: [Permission modes guide](https://thepromptshelf.dev/blog/claude-code-permission-modes-complete-guide-2026/)
- Market data: [Hostinger vibe-coding statistics](https://www.hostinger.com/blog/vibe-coding-statistics/)
  - Trust in AI code fell to 29% (Stack Overflow 2025)
  - 96% don't fully trust its correctness (SonarSource)
  - 63% of vibe-coding users aren't developers (Vercel)
  - 45% of AI code samples fail the OWASP Top-10 (Veracode)
