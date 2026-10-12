# Before M6: answers, final review and the M5.10 prompt (12 Oct 2026)

**Inputs:** Netanya's notes after M5.7–M5.9, the 32 M5.7 screenshots, PRD, docs 10–25.

**Not done:** a live click-through of production. Claude Code's checks in step 10 cover it.

## 1. Answers
| Question | Answer |
|---|---|
| **"Open in Studio" doesn't click for some agents** | Only agents that exist in Lyzr Studio have a Studio ID: the ones you attached from Studio (e.g. Research agent, "from Lyzr Studio · reused"). Agents Architect created in a plan ("new") aren't in Studio yet, so there is nothing to open. The real product would create every plan agent in Lyzr Studio when its part is built. The prototype's build is simulated, so plan agents only exist in our database. Fix: each workspace connects its own Lyzr API key. With a key, built agents are created in that workspace's own Studio and open there. Without one, Studio actions are Simulated and labelled. The platform key is used only for one shared, capped demo agent, so nobody's agents land in your account (step 1) |
| **Collapsed panes reopen on tab change** | The workspace still auto-collapses and expands panes per tab (the v3 rule for full-width tools). Your choice should win: once you collapse or expand a pane, it stays that way across tabs and projects until you change it (step 2) |
| **Plan › Design is misaligned** | It sits outside the plan document's column. Same column, width and left edge as the content above it (step 3) |
| **No way back to Build from Launch** | The stepper steps are clickable but don't look it. Done steps get a hover fill, a pointer and a tooltip ("Go to Build"), and the Launch page gets one quiet line: "Need a change? Go back to Build" (step 4) |
| **Why are chats "Simulated"?** | Chat isn't simulated. Writing the plan and turning chat messages into change cards call Gemini or OpenRouter for real. The build is simulated, and the "Simulated" chip sits on the chat message that reports the build, so the whole chat looks fake. Why the build is simulated: the PRD scoped real code generation out of the prototype. The model call isn't the hard part. Running generated code needs sandboxes, a test runner, preview hosting and deploys, and a multi-minute build doesn't fit the free-tier function time limits or Gemini's free rate limits. It's a scope decision, not just credits. Fix: label the build, not the chat: "Simulated build" on the build card and the preview frame only (step 5) |
| **The terminal looks random** | It shows canned commands with no session or purpose. Today's Architect has a live preview with logs and console errors with "Fix with AI". Redesign it as a proper Developer panel (step 6) |
| **Analytics** | Yes. `@vercel/analytics` with `<Analytics />` from `@vercel/analytics/next` in the root layout gives page views, with no cookies. Turn on Analytics in the Vercel project first (Project › Analytics › Enable). Vercel's custom events (button clicks) need a paid plan, so track product actions in our own Supabase table instead. This is for us only (did reviewers use the features?), so there's no in-app card. It doesn't clash with egress: the events stay in our own database and Vercel Analytics only counts page views of the demo site. Egress rules (C-4) cover the data of the apps people build. In the real product, third-party trackers in the builder would be switched off for tracker-free tenants (C-8), and the README says so (step 7) |
| **Global search?** | Yes, small: ⌘K, plus a "Search" row at the top of the left nav (as Notion does). It finds projects, agents, connections and pages, and runs actions ("New project", "Open Trash", "View as Viewer"). No full-text search of plans (step 8) |
| **Will friends or the recruiter see the demo data?** | Partly. Every new sign-in already gets its own seeded "Acme Ops (Enterprise)" workspace plus an empty "Personal" one, so they see the same projects you do, as Morgan. The friction is elsewhere: sign-up, landing with no guidance, Gemini rate limits if several people write plans at once, test leftovers in the seed ("Expense checker mlight"), and actions that need a second person. Fix: one-click demo access, a short guided tour, a reset, and graceful limits. The "Try the demo" button belongs on the landing page (M6); M5.10 builds what it needs underneath (step 9) |

## 2. Final UX review (whole product)
### What works
- **Plan first and cost before spend** are visible everywhere: the composer line, Parts ("2 of 5 parts work · 34 of ~80 credits"), "Launch · 3 to fix".
- **The agents graph** (dot canvas, glyphs, dashed tool links) and the Agent detail with Settings / Runs / Try it / Checks.
- **The 1.0 → 2.0 migration row** ("Move to 2.0") tells the upgrade story in one line.
- **Empty states:** one picture, one line, one primary action.
- **Honest labels.** Status as icon plus word; moss never on buttons.

### Fix before sharing
| # | Finding | Severity | Fix |
|---|---|---|---|
| U1 | Test leftovers in the seeded demo ("Expense checker mlight", "llight") | 🔴 | e2e tests run in their own workspace; remove junk from the seed and from your account |
| U2 | First visit has no guidance; the product has many features | 🔴 | Guided tour card (step 9) |
| U3 | "Simulated" on chat messages makes real AI look fake | 🔴 | Step 5 |
| U4 | Agent detail: the model select is truncated ("C… Sim"), and "Model used on Studio: Gemini 3.1 Flash Lite" contradicts the selected Claude | 🟡 | Show the full name; when Studio's model differs, say "Studio runs Gemini 3.1 Flash Lite; this changes it on Save" |
| U5 | "v1 · agreed" in Parts is jargon | 🟢 | "Plan v1" |
| U6 | "Open in Studio" disabled without a reason | 🟡 | Step 1 |
| U7 | Pane state, Design alignment, way back to Build | 🟡 | Steps 2–4 |
| U8 | Terminal | 🟡 | Step 6 |
| U9 | Phone width not checked since M3 | 🟡 | In M6 visual QA |

## 3. Final product review
- **The story holds:** describe it → see the plan and its cost → build with proof per part → fix blockers → launch through governance, with agents first-class on Lyzr Studio. The Loom should follow exactly this, and so should the tour.
- **Biggest risk: reviewers don't find the good parts.** That's the tour, the demo access and ⌘K.
- **Second risk: a demo-day failure from Gemini quota.** When the free tier refuses, fall back to OpenRouter automatically and say so in one line: "Gemini is busy; used Llama 3.3 instead". Keep a per-user daily cap on plan drafts.
- **Lyzr stack:** make sure the README and the tour show Try it with a real Studio agent. It answers the "not using their own stack" concern.
- **Measure it:** the README should name 3 success metrics the product would track (time to first plan, share of plans built, blockers resolved before Launch). Step 7's events table records exactly these, which is good evidence of PM thinking.
- **Security before going public:** anonymous sign-in has to be rate-limited and cleaned up; scan git history for keys before making the repo public (already planned).

## 4. Prompt for Claude Code (M5.10)
> M5.10: fixes before M6. **Don't remove any feature.** Order: steps 9, 5, 1–4 and 7 are must-haves; steps 6 and 8 come after. Show me any migration before applying it.
>
> 1. **Agents in Lyzr Studio, per workspace (no shared Lyzr account):**
>    - **Your own Lyzr key, per workspace:** Connections › Lyzr Studio › "Connect with your Lyzr API key".
>      - Store it encrypted at rest (Supabase Vault or AES with a server-only secret). It is never sent to the browser after saving; show only the last 4 characters. Only Owners and Admins can add or remove it.
>      - Show me the migration first.
>    - **Stop using the platform `LYZR_API_KEY` for user actions.** Creating agents, syncing, and listing agents for "Attach Studio agent" use only the workspace's own key. Without one:
>      - those actions run Simulated, labelled "Simulated · connect your Lyzr key to make this real";
>      - "Attach Studio agent" shows no list, only the connect prompt. A user must never see another account's Studio agents.
>    - **When a workspace has a key:** when an agent part reaches Works in a build, create the agent in that workspace's Lyzr Studio through the Lyzr API (name, instructions, model, tools) and store the Studio ID. Saved edits sync to Studio. If the call fails, the part stays Works and the agent shows "Not in Studio yet · Retry".
>    - **"Open in Studio":** enabled for agents with a Studio ID. Others show it disabled with the reason ("Connect your Lyzr key" or "Created in Lyzr Studio when this part is built").
>    - **The seeded demo agent** (Research agent) stays a shared, read-only demo agent on the platform key, so reviewers can see a real Lyzr call without a key:
>      - Try it only (no edits or sync), labelled "Demo agent";
>      - capped at 10 runs per user per day.
>    - **Project "Keys and passwords":** encrypt values at rest, never show them again after saving, and add one line: "Demo environment: use test values, not real secrets."
>    - **DECISIONS line:** the build is simulated; agents are real in the workspace's own Lyzr Studio when a key is connected; no user's data goes to another account.
> 2. **Pane state:** the Parts and Chat panes keep whatever state the user last chose, across tabs, projects and reloads (saved per user). Auto-collapsing for full-width tabs applies only until the user has touched that pane.
> 3. **Plan › Design:** align it to the plan document's column (same max width, left edge and spacing).
> 4. **Way back to Build:**
>    - Done stepper steps get a hover fill, a pointer, a focus ring and the tooltip "Go to Build".
>    - The Launch page gets one quiet line under its title: "Need a change? Go back to Build".
> 5. **Simulated labels:**
>    - Remove "Simulated" from chat messages.
>    - Label the build card and the preview frame "Simulated build".
>    - Plan drafting and change cards are real model calls. Show the model name small on the plan message ("Written by Gemini 3.5 Flash Lite").
>    - When Gemini refuses (quota or rate limit), fall back to the OpenRouter model automatically and say so in one line.
> 6. **Developer panel** (replaces the current terminal), with four tabs:
>    - **Terminal:** starts with a prompt line (`~/expense-checker (main) $`) and one welcome line, with no canned commands. A Sessions dropdown lists earlier sessions, read-only, saved per project. Has Clear, Copy and Download.
>    - **Console:** errors, warnings and logs from the preview, with level filters and counts, and "Fix with AI" on each error, which creates a change card.
>    - **Build logs:** per part, from the simulator, collapsible.
>    - **Live logs:** runtime logs for Test / Team / Live with an environment selector.
>    The panel has one "Simulated" label and uses Geist Mono on the dark surface in both themes.
> 7. **Analytics (for us only, no UI):**
>    - Install `@vercel/analytics` and add `<Analytics />` from `@vercel/analytics/next` to the root layout.
>    - Add an `analytics_events` table, insert-only through a server function with no client reads, recording: plan written, build started, blocker resolved, launch, view as role, tour step and demo reset. Each event stores the user id, workspace, project, whether the user is a demo user, and the timestamp, with no personal content.
>    - Add a saved SQL query in `docs/analytics.sql` that I can run in Supabase to see usage per user.
>    - No in-app metrics card.
>    - README: one line that analytics is page views plus first-party events in our own database, and that tracker-free tenants (C-8) would turn third-party analytics off.
> 8. **Search:** ⌘K / Ctrl K command palette, plus a "Search" row at the top of the left nav. It searches projects, agents, connections and pages, and offers actions (New project, Open Trash, View as Viewer, Switch workspace). Keyboard first; results grouped.
> 9. **Demo access** (the "Try the demo" button itself goes on the landing page in M6; build what it needs now):
>    - A server action `startDemo()` that does a Supabase anonymous sign-in and seeds the same Acme Ops workspace. For now, call it from a small "Just looking? Try the demo" link on the sign-in page; M6's landing page will reuse it. I'll turn on anonymous sign-ins in Supabase; tell me where.
>    - Cap anonymous users at 5 plan drafts a day.
>    - Delete anonymous users and their data after 7 days, in the existing daily cron.
>    - A **guided tour card** on Home, dismissible, with 5 steps that deep-link: write a plan (prefilled prompt) → build → fix a blocker (connect an app) → launch with approval (approve it yourself as Admin) → Governance and the audit log. Progress is saved.
>    - **Settings › Reset demo data** restores the seed for that workspace.
>    - Remove test leftovers from the seed, and make e2e use its own workspace.
>    - Rename "v1 · agreed" to "Plan v1".
>    - Fix the truncated model select in Agent detail and explain a Studio model mismatch.
> 10. Check everything in both themes and at 390px width. Send screenshots of the tour, the demo link, the Developer panel and ⌘K before pushing.
