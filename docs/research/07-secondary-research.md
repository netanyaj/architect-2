# Secondary user research (in place of interviews)

_2026-10-02. This replaces the 3–5 planned interviews (section 6 of `05`) under time pressure._

## Method
**Sources:**
- **Reddit:** top posts of the past month in r/lovable (40), r/replit (30), r/vibecoding (40, mostly memes, low signal), r/sysadmin (40), r/ExperiencedDevs (40) and r/cybersecurity (40). About 230 posts scanned; **about 60 were relevant**.
- **Trustpilot:** Lovable, 4.2/5 from 1,729 reviews.
- **Surveys:**
  - Retool *State of AI Governance 2026* (n = 307 CTOs, CIOs and CISOs, May 2026)
  - Unseen *State of Shadow AI 2026* (which aggregates PagerDuty, IBM and ISACA data)

**Coding:** each relevant post was tagged with a theme from `05` (T1–T6), and new themes were added where posts didn't fit (N1–N4).

**Limitations:**
- Reddit's search and comment endpoints were blocked, so only post bodies were read, via RSS, with no scores and no comment threads.
- Only the last month is covered.
- **Strong bias towards complaints.** People post when something breaks.
- We can't ask follow-up questions.
- **Use this to rank problems, not to size them.** Links are given so anyone can check the posts.

## Results by theme
| Theme | Signal | Evidence (paraphrased; links below) |
|---|---|---|
| **Cost you can't predict or control** (part of T4) | **Strongest by far: about 20 posts** | **Lovable:** credits burned by new sub-agents; credits spent just reading files; prompt ping-pong on small changes; database costs jumping once real users arrived. **Replit:** "$100+ for a couple of prompts"; a free mode that escalates to max mode (a $200 surprise); credits lost to a platform fault; charges continuing after cancelling; **the model switched mid-task without consent** |
| **N1, the "debug tax": paying for the AI's own mistakes** | **Strong** | One Replit user broke down a $247 bill: **55% was agent retry and debug loops**. Another: "spending more on defect fixes than the build". Lovable: having to "tell it two or three times". A review: reruns burn free credits before the project is finished |
| **Is it real and safe? Is it production-ready?** (T4) | **Strong: about 10 posts** | "How did you know it was ready for real users?"; checklists of failure tests to run before taking payments (users editing IDs to read other users' data); people who cancelled Stripe still having access; N+1 query problems; a community-built scanner for Supabase tables readable by anyone; `.env` committed to the repo; "beta users humbled me: 7 hours of fixes"; Lovable **retiring its test environments** (users angry: no safe place to test) |
| **Intent lost: instructions ignored or drifting** (T1) | **Moderate: about 6 posts** | Repeating instructions two or three times; "70% there, then the last 30% burns credits"; users **writing the spec in ChatGPT first** to avoid wasted prompts (they want a contract and have to make one themselves); developers: juniors' AI code "meets the acceptance criteria" but ignores real integration contracts |
| **N2, using the platform only as a host** | **Moderate but telling: 4 posts** | Lovable: "use ANY agent (ChatGPT, Codex) on the GitHub repo, push to main, click Publish: zero credits". Replit: do planning and debugging in **Claude through the Replit connector** and keep a local copy synced. Power users route *around* the builder's agent and keep its hosting and runtime |
| **Continuity, git and the handoff** (T2/T3) | **Moderate** | Replit: "7 hours into making the GitHub integration work", with permissions confusion between a non-technical owner and the developer. Lovable: confusion about handing a site over to a client; teams moving to their own VPS or TanStack after outgrowing the platform |
| **Morgan → Sam handoff** (T6, personas) | **Small in count, but a perfect example** | r/sysadmin: a **non-technical COO built a dashboard with AI as one HTML file and wants the sysadmin to review and maintain it**. r/ExperiencedDevs: **5,000+ line PRs that nobody understands**, and reviewers pressured not to slow the team down; "the output has to be human-reviewable and you're still accountable" |
| **Governance and shadow AI** (T6, Jordan) | **Strong, from surveys** | **93%** of tech and security leaders are concerned about AI-generated tools in production; 38% rank them a *top* risk; **only 8%** have strong governance; **91%** put security and data-access controls first; **55% want governance in a central platform, not in each app**; 44% have no clear accountability; 22% had an incident in 12 months (Retool). 66% of office workers have used AI they believed wasn't allowed; 88% have shared work data with public AI tools; the median organisation uses 73 AI services (Unseen/PagerDuty). Reddit: an employee pasting documents into personal ChatGPT; an AI agent recording a client's calls that nobody knew existed |
| **N3, life after launch** | **Moderate** | Database and hosting costs once there are real users; needing staging, backups and rollback; credits needed just to keep a built app running |
| **N4, platform trust and support** | **Moderate** | No human support (AI-only chat); production down for 72 hours; billing disputes. Positive counterpoint: Replit's clearer billing controls were praised |
| **T5, agents cut from apps** | **Not observable** in forums | Remains an audit-only finding (n = 2) |

**Praise (Trustpilot and Reddit):** speed from idea to working app for non-developers; less need to hire developers; "a door that was locked opened". People value the core promise. **The pain starts after the first demo.**

## What this changes
1. **Direction A is confirmed, and cost belongs inside it.** The top two problems are *unpredictable cost* and *"is it real or ready?"*. The Build Contract should carry, per item:
   - estimated cost before building;
   - actual cost afterwards;
   - **a clear split of the debug tax.** Fixes for items that failed their own acceptance check aren't charged to the user, or are capped.
   - Users already hand-write specs elsewhere to protect their credits; the contract makes that native.
2. **Direction B gets a sharper developer story: let *their* agent in.** Power users already use Claude, ChatGPT or Codex on the repo and treat the builder as a host. Architect 2.0 should be **open by design**:
   - an **MCP server and CLI** so Claude Code or Cursor can read the contract, run the sandbox, and open PRs against the same project.
   - This is the honest answer to the form question *"Why would a Claude Code, Codex or Cursor user pick Architect?"*: they keep their agent, and Architect adds the runtime, agents, integrations, hosting and governance.
3. **Direction C is confirmed by the buyer data.** 55% of leaders want governance in a central platform, and only 8% have strong governance today. The Morgan → Sam handoff (the COO dashboard, the unreviewable PRs) is real.
   - **Reviewability is a governance feature:** small PRs linked to contract items, readable diffs, and an owner on record.
4. **New baseline items (N3):**
   - preview, staging and production environments with separate data;
   - backups and rollback;
   - running costs shown separately from build costs;
   - a deployed app keeps running even when build credits run out.
5. **New trust item (N4):** **never switch models or plans without consent.** Show the model and the cost on every action.

## Decision rule check (from `05`, section 6)
| Direction | Confirmed by users? | Poorly solved by competitors? (`06`) | Can we demo it? |
|---|---|---|---|
| A, the Build Contract (+ cost and debug-tax split) | ✓ Strong (cost, readiness, intent) | ✓ No one does it | ✓ |
| B, repo-native (+ open to external agents) | ✓ Moderate (workarounds, git pain) | ~ Partly (v0) | ✓ (mostly simulated) |
| C, sovereign governance plane | ✓ Strong (surveys) | ~ Admin features yes, sovereignty no | ✓ (as flows) |

**Recommendation:** lock **A as the core**, **B (open to external agents) as the developer pillar**, and **C (sovereignty-led) as the governance plane**, all on top of the expanded baseline.

## Sources
**Reddit (r/lovable):**
- [sub-agent credit burn](https://www.reddit.com/r/lovable/comments/1wlku1c/genuinely_screw_lovable/)
- [consumption / plan in ChatGPT first](https://www.reddit.com/r/lovable/comments/1wc94m5/consumption_is_kicking_my_butt/)
- [70% there](https://www.reddit.com/r/lovable/comments/1wm0e6g/lovable_gets_me_70_there_but_how_do_you_handle/)
- [use any agent, host on Lovable](https://www.reddit.com/r/lovable/comments/1wtavx0/most_of_you_shouldnt_migrate_off_lovable/)
- [how did you know it was ready](https://www.reddit.com/r/lovable/comments/1w86tx8/if_you_built_an_app_with_ai_how_did_you_know_it/)
- [failure tests before payments](https://www.reddit.com/r/lovable/comments/1w57xbl/if_your_lovable_app_works_run_these_failure_tests/)
- [test environment retired](https://www.reddit.com/r/lovable/comments/1wgfyyc/lovable_to_retire_the_test_environment_feature/)
- [DB costs with real users](https://www.reddit.com/r/lovable/comments/1w5d0o2/lovable_cloud_database_costs_suddenly_went_crazy/)
- [after production](https://www.reddit.com/r/lovable/comments/1wjfa5l/what_happened_after_you_actually_took_your/)

**Reddit (r/replit):**
- [credits mapped: 55% debug tax](https://www.reddit.com/r/replit/comments/1wh2sj1/replit_credits_dont_vanish_they_go_to_4_places_i/)
- [defect fixes cost more than build](https://www.reddit.com/r/replit/comments/1w60ztr/spending_more_of_defect_fixes_than_the_actual/)
- [model switched mid-task](https://www.reddit.com/r/replit/comments/1wajglc/i_will_be_suing_replit_they_are_robbing_you/)
- [free mode escalates](https://www.reddit.com/r/replit/comments/1whrr4o/replit_free_mode_doesnt_finish_the_whole_task/)
- [GitHub integration pain](https://www.reddit.com/r/replit/comments/1wjmc30/replits_github_integration_is_a_whole_new_level/)
- [Claude connector workflow](https://www.reddit.com/r/replit/comments/1wkt30v/the_claude_replit_connector_has_been_a_game/)

**Reddit (other):**
- [COO's AI dashboard handed to sysadmin](https://www.reddit.com/r/sysadmin/comments/1wngmab/nontechnical_coo_discovered_ai_coding_generated/)
- [5,000-line PRs nobody understands](https://www.reddit.com/r/ExperiencedDevs/comments/1waqhwv/how_do_you_handle_coworkers_who_dont_really/)
- [AI ignores integration contracts](https://www.reddit.com/r/ExperiencedDevs/comments/1w85of9/how_do_you_make_juniors_accountable_without/)
- [docs pasted into personal GPT](https://www.reddit.com/r/cybersecurity/comments/1wjr7xn/saw_a_lady_near_me_paste_a_bunch_of_docs_into/)

**Reviews and surveys:**
- [Trustpilot: Lovable](https://www.trustpilot.com/review/lovable.dev?page=4)
- [Retool State of AI Governance 2026](https://retool.com/blog/ai-governance-report-2026)
- [Unseen State of Shadow AI 2026](https://www.unseensecurity.ai/shadow-ai-report)
