# Decisions log

Where the prototype differs from the spec, or fills a gap the spec left open. One line each: what the spec said, what we did, and why. Approved by Netanya unless marked **open**. Spec references: BUILD-SPEC, DATA-MODEL, BLUEPRINT-GENERATION (BG), the PRD (`docs/product/08-PRD-architect-2.md`) and ARCHITECTURE.

## Pattern used throughout
**The model labels, the server decides.** Wherever a model output decides something that matters (what blocks Build, what counts as weakening a part, prices), the model only labels it and deterministic server code makes the call. Model output varies between runs and models; the rules that protect the person must not.

## M1 · Foundation

| Area | The spec said | We did | Why |
|---|---|---|---|
| Workspaces | DATA-MODEL: seed one workspace, "Acme Ops", with the demo user as Owner | Every new sign-in gets its own seeded workspace; accepting an invite adds a second membership | Each reviewer gets a clean workspace, and nobody overwrites anyone else's demo |
| Workspace names | "Acme Ops" | "<First name>'s Acme Ops" (migration 0003) | Identical names made the workspaces table and invites ambiguous |
| Reset demo data | Not in the spec | Settings › Reset demo data (Owner only) re-runs the seed; people, invites, tickets and the audit log are kept; uploaded files are removed | Reviewers can start again without a new account |
| Meeting Prep seed status | Screens 1 and 12 showed it building at 7 of 12; DATA-MODEL says live, 12 of 12 | Live, 12 of 12; screens 1 and 12 updated on the canvas | Launch, Share and version history need one finished app; "building" comes from the reviewer's own project |
| Sam and Jordan | Seeded teammates | Seeded as invited members (no accounts); Sam is ticket-triage's display owner (`projects.owner_display_name`) while the signed-in person is the real owner | They can't sign in, so they can't own rows; the F8 hand-off (M4) makes Sam the real owner |
| Email | Invites "by email link" | No email service: "Confirm email" is off, and invites are a link the inviter copies and sends | Supabase's built-in mailer sends a few emails an hour, only to project team members. A mail provider needs a verified domain; declined for the take-home |
| Invite links | "Invite by email link" | The link only works for the invited email; signed out, it asks you to sign in first | A forwarded link can't be used by someone else |
| Sign-in account chooser | Not specified | Google and GitHub always show their account chooser (`prompt=select_account`); sign-in is a full-page redirect, not a popup | People with more than one account can pick; redirects work on phones and aren't popup-blocked |
| Supabase URL check | Not specified | The build fails if `NEXT_PUBLIC_SUPABASE_URL` isn't `https://<ref>.supabase.co` | Production login broke once on the dashboard address; it now can't ship that way |
| "People online" by Help | Screen 12 shows "People online" | Not shown | Nobody staffs support in the prototype; showing it would be false |
| Talk to a person | Real ticket row (BUILD-SPEC: simulated column) | A real ticket with the conversation; labelled Simulated | The ticket is saved, but nobody answers it |
| Disabled controls | Every disabled button says why | Controls for later milestones say which one, e.g. "(M3)" | Honest about what isn't built yet. **To remove in M6** as each milestone lands |
| Phone layout | No horizontal scroll at 390 px | The side nav folds into a bar with a Menu button | The full nav filled the first screen on phones |

## M2 · Plans and chat

| Area | The spec said | We did | Why |
|---|---|---|---|
| Model | BG: Gemini on the free tier | `gemini-3.5-flash-lite`, and Gemini is the default everywhere (Home, new projects: migration 0006) | `gemini-3.8-flash` allows 20 free requests a day, used up quickly by plans, chat, Help and reviewers. Gemini is the fastest (2–7 s a plan) |
| OpenRouter speed | BG: under 60 s on the OpenRouter model | A 45 s limit for OpenRouter in the gateway (plans, chat, Help); past it the plan pauses with the paused banner and Switch model, keeping what was written and charging nothing. The picker labels it "Free · can be slow". Its acceptance check is "a valid plan, or a clean pause within the limit" | Free models run on shared capacity: the same plan took 19–148 s across runs |
| OpenRouter model | BG: "a `:free` model" | `nvidia/nemotron-3-super-120b-a12b:free` | Timed the free models with structured output on the Meeting Prep plan: nemotron 25.6 s and valid; qwen3.8-27b 167 s (over the 60 s target); gemma-4-31b gave no structured output |
| OpenRouter allowed | DATA-MODEL: Claude, GPT, Gemini allowed | OpenRouter added to the seeded model policy (migration 0004; kept by Reset demo data) | M2 acceptance requires the demo prompts on OpenRouter |
| Structured output | BG: `streamObject()` with the Blueprint schema | `streamText` + `Output.object()` (AI SDK 7's replacement), with a relaxed draft schema; the strict schema is enforced by the server afterwards | AI SDK 7 replaced `streamObject`. Gemini rejects the strict schema as too complex ("Request contains an invalid argument") |
| Server tidying | BG: on validation failure, retry once with the errors | Keys are tidied into valid unique keys, and quotes over 120 characters are cut at a word boundary, without a retry; anything else retries once | Keys are internal ids, and a quote's opening words are still the person's exact words. Retries cost time and quota |
| Blocking questions | BG schema: the model sets `blocking` | The model labels `default_effect` (keep, reduce, remove, none); the server blocks Build for reduce, remove and none (migration 0005), then applies rules a and b below | The model over-flagged questions that had a recommended answer, holding Build for no reason |
| Rule a: services already there | Not specified | A question labelled reduce, remove or none doesn't block when it asks about a kind of service (calendar, email, CRM, tickets, files, chat) that the request already names ("my calendar", "email thread") or Connections already has | The plan can use that service, so there's nothing to wait for. Only this deterministic half: "are the options genuinely different?" was too fuzzy to trust |
| Rule b: requested channels (safety) | Not specified | If the request asks to send by SMS, WhatsApp, Microsoft Teams, Discord or Telegram and that service isn't connected, a "Which … service?" question always blocks: the model's own, marked blocking whatever its label, or one the server adds. Naming the channel never unblocks it | A model once picked an SMS service silently; nothing would have stopped the build. This is the case that must never slip through |
| Slack workspace | A blocking question when there's no safe default | Decided by the server: blocks only when the request asks for Slack and names no channel; a named channel, or Slack the planner chose itself, is a default | Without it the demo's key moment (the Slack question holding Build) depended on the model's mood |
| Conflict guard: weaken | A-3: removing or weakening a part needs Keep / Defer / Drop | Every change carries a kind (add, modify, weaken, remove); weaken and remove both get the card. The server also marks a change as weaken if it cuts a part's acceptance lines or drops one, whatever the model said | The same pattern: the model labels, the server decides |
| Weaken decisions | Keep / Defer / Drop | Keep = the part stays as asked; Defer = set aside; Drop = the stronger version goes and the part is built as changed, with the reason saved on it | The three words from the PRD, applied to a weakening |
| System prompt | BG: the prompt text given | The spec's rules kept word for word, plus a field guide: key format, item classes, providers, `default_effect`, plain-word titles | The model needs the field rules to fill the schema reliably |
| How the plan reaches the page | BG: the client renders from Realtime on `items` | The page renders from the streamed response; parts are saved as they arrive, and Realtime follows a plan written in another tab or after a reload | Same result with less delay; Realtime still keeps tabs in step |
| Images | BG: images "captioned by the same model" | Images are passed to the model as images | One call fewer, and nothing lost in a caption |
| Uploads | Attachments go to the project store | Supabase Storage, private `uploads` bucket. The browser uploads straight to the bucket through signed slots; the server reads PDFs and lists the files | Vercel caps request bodies at 4.5 MB (server actions at 1 MB), so files can't pass through our server |
| Build before M3 | BUILD-SPEC: clicking Build "starts the simulator" | Build agrees the plan through the database's Build gate (`agree_and_build`) and queues a run started by the person | The simulator is M3; it will play queued runs |
| Edits before Build | A-5: any later change creates a new version | Wording, answers and defaults change the draft in place; chat Apply always makes a new version | Versions mark agreed changes; small edits before Build would make dozens |
| Apply after a build | A-11: Apply starts building the change | Apply makes the new version and starts a run through the same Build gate. Fixed in M3: the run's kind is `change` (see M3) | The gate had no run-kind setting in M2 |
| Viewers in chat | PRD: Viewers read and comment | Viewers can chat with Talk first only; it never changes the plan | Matches "comment, don't build" |
| Fixtures | BG: `tests/fixtures/prompts/` | `test/fixtures/prompts/` and `test/fixtures/blueprints/` (recorded real output) | Matches the existing test folder |
| Fixture prompts | The 3 demo prompts | The 3 demo prompts, plus "SMS reminder" (must block: no SMS service) and "vendor list" (must not block); recorded from all four models (20 fixtures) | Pins down both sides of the blocking rule on every model |
| Live checks use the demo Connections | Not specified | The live check runs the rules with the seeded workspace's Connections (Google Calendar and Slack connected) | Rules a and b depend on Connections; this matches what a reviewer's workspace has |

## M3 · Build, preview, launch

| Area | The spec said | We did | Why |
|---|---|---|---|
| `?sim=budget` | SIMULATOR: the budget variant sets a 100-credit project budget | The variant sets the budget to about 60% of the build's likely total, rounded to 5 | Real plans cost 20–82 credits (the 20 recorded plans), so a 100-credit budget never paused. Screen 7 needs a pause part-way |
| Run kind | M2 note: add a `run_kind` column (build, change) | Used the existing `runs.kind` (it already allows build, fix, change, deploy); the Build gate takes the kind (migration 0007). A change is checked against the budget for the parts it builds, not the whole plan | No duplicate column; a change to a built app shouldn't be priced as the whole app again |
| One run at a time | Not specified | The gate refuses a second Build or Apply while a run is queued or running on that project ("A build is already running") | Two timelines over the same parts would contradict each other |
| Starting a run | SIMULATOR: `startRun` after Build | Build and Apply call the gate, then start the run in the same request: a claim (only one caller wins), the timeline, each part's check dated before its code, and all events. A page load starts any run left queued (including M2's) | Nothing long-running on Vercel; a lost tab can't leave a run stuck |
| Settling | SIMULATOR: `settleRun`, idempotent | One database function, `settle_run`, writes statuses, proofs, Usage lines (one build or change line per run, one per fix) and approval requests in one transaction, once, after the run's end time. Clients call it when the last event is due; page loads call it for overdue runs | A half-settled run would charge twice or lose proofs |
| Approval requests | Event payload `{item_key, approval_id}`, approval created when the event plays | The approval row is created when the run settles, once per service | The event is inserted before it plays; an approval would otherwise appear in the queue before the person sees the part wait |
| The run's clock | SIMULATOR: clients replay against `started_at` | The database stamps a run's start and end (`begin_run`, `set_run_timeline`, migration 0009); pages carry the database's time and browsers replay against it. Settling retries every 2 s until the database agrees | This laptop's clock ran 60 s ahead of Supabase's: settling said "not yet" and the build never finished |
| Follow-up runs | SIMULATOR step 4: Try 1 more fix, Raise budget and continue | One more gate, `start_followup_run` (migration 0008): same role, one-run-at-a-time and budget checks as Build. Try once more is a `fix` run on that part (one more fix, which passes); Raise budget runs the parts still waiting | Every spend still starts from a click and goes through the database |
| A Blocked part while the build plays | Screen 6 drawer | The part shows Blocked as soon as its third fix fails, but its choices open when the run settles ("The build is still running") | The choices change saved rows; before settling there's nothing saved to change |
| What I suggest | Screen 6: "Allow up to 250 words" | Comes from the scenario file; it rewrites the part's check (200 → 250 words), records a passing proof and costs nothing, as the screen says | A real suggestion would come from the verifier; the scenario stands in for it |
| Connect during a build | BL-9: Connect flips the part to Works | Connect works any time; a part whose service is connected before its run settles settles as Works. Connecting from Connections flips waiting parts in every project too | The person shouldn't have to wait for the build to finish to fix the one thing it needs |
| Stop here | Screen 7, not specified | Keeps what works and ends the build; the waiting parts stay in the plan (not built, not charged) and Launch lists them | "Set the parts aside" already covers moving them out |
| The preview | A pre-built Meeting Prep app | The same app for every plan, labelled Simulated; its sections (email, agenda, talking points, connections) appear as parts matched by group and keywords start to work. Sample data shows on the section | Honest about being a sample, and still follows the real plan's progress |
| Test the app | "Runs every check plus a browser pass" | Simulated: reports the parts' checks from their statuses after a short wait | No real code to test in the prototype |
| Launch | Screen 4: Test → Team → Live | Team = a `staging` deployment, Live = `production`. Live always follows the team version; Owners and Admins go live, a Builder's click files a deploy approval. Sign-in, web address and keys rows are shown, disabled until governance (M5). Addresses are `*.architect.space` / `*.architect.app`, simulated | Matches the role table (Builders "ask for Live") and keeps one path to Live |
| Checkpoints and go back | BL-7: every part that works is a restorable point | Version history on Launch: every shared or live version, with Go back to any earlier one in one click; the part drawer's "History and go back" opens it. No per-part restore | Per-part restore needs real code; versions are what people go back to |
| Seeded live projects | Meeting Prep seeded live 12/12 | It has environments but no deployment history; Launch treats it as live at its current version | Avoids inventing deploy history in the seed |
| Local e2e | Not specified | Two Playwright workers locally | Three long simulated builds plus sign-ins at once overloaded the dev server; everything passes with two |
| Governance and the fast path | Screen 4: Test → Team → Live with IT approval | The Launch stage reads the workspace's governance setting (a toggle in Settings, Owners and Admins). On: Test → Team → Live, a Builder's Go live files an approval. Off: Test → Go live in one step, the team version optional, no approval, and connector approvals don't hold Live | Deploy review gap 1: without governance nobody can approve, and today's product goes live in one click |
| Who can open it | Live: "Anyone at acme.com with Google sign-in" | Three choices: anyone with the link · signed-in people at your domain · invited people only. Default: the domain with governance on, the link with it off. Simulated | Review gap 2: customer-facing apps need a public link, as today |
| Marketplace | "Others in Acme can copy it" | Not listed · your workspace · Public Agentlets, with today's form (category, description, 160-character short description, up to 8 tags). Public needs a live version, and an Owner or Admin under governance. Simulated | Review gap 4: keeps today's public listing |
| Live is behind | Not specified | After a change, the Live card says "N changes not live yet · Update live", and the stage action is Update live; it re-runs the checklist | Review gap 8 |
| Deploy failure | Not specified | Every deploy has four steps; `?sim=deployfail` fails the health check. The failed version is recorded, the one before keeps serving, and Launch says what failed, with Try again and Ask a person (SIMULATOR "Deploys", migration 0010) | Review gap 9 |
| Custom domains | "Web address · Change" led nowhere | Enter → add the CNAME → Checking (simulated, ~4 s) → Secured (HTTPS), per version; the next deploy uses it | Review gap 10 |
| Go back confirmation | One-click go back | A confirmation first: "Data stays as it is; the code and settings go back to vN", listing what each later version changed | Review gap 11: going back on Live shouldn't be a misclick |
| Test link, running cost, analytics, success | Not specified | A view-only test link (`/share/<token>`, signed out, sample-data banner kept, Stop sharing makes it 404); "About N credits a month at current use" on the Live card (agents 12, integrations 4, data 2, screens and checks 1 a month per part, a stand-in rate); an analytics toggle, off by default; a "vN is live" success panel with the address and what happens next | Review gaps 3, 5, 12 and 13 |
| Deploys for imported repo projects (Sam) | Undefined | Decided, not built (M4 imports repos): the team version builds from the PR branch, and Live deploys from `main` after the PR merges, as v0 does. The Launch cards will show the branch and the PR | Review gap 6: repo projects ship through PRs, so Architect shouldn't deploy around them |
| Take offline | Not specified | Decided, not built: "Take offline" on the Live card stops serving the app but keeps its data, versions and history; going live again restores the last version. Owners and Admins under governance. Planned with the governance work (M5) | Review gap 7: needed for incidents, cost and leavers' apps |
| Fix attempts | "Up to 3 attempts"; `?sim=paused` "fails all 3 attempts" | The build's check fails, then up to 3 fixes run; each fix has its own result, note and Usage line. With `?sim=paused` all 3 fixes fail (236, 212, 204 words) and the part is Blocked | Screen 6 lists three fixes, each with a result and a cost; "Fixing 1/3" is the first fix |

## Numbers we set, and how we picked them

| Number | Value | How we picked it |
|---|---|---|
| Model price factors (estimator) | OpenRouter free 0.6 · Gemini flash-lite 0.8 · Claude and GPT 1.0 | BG says cheaper models are below 1.0. Claude and GPT are the baseline; Gemini flash-lite is cheaper per token; the free OpenRouter model is cheapest |
| Seeded builds per part class (drives confidence: ≥10 high, 5–9 medium, <5 low) | chat_send 30, data.table 26, screen.list 24, calendar 21, schedule 19, screen.detail 18, summariser 16, read_email 14, screen.form 12, data.import 8, crm_lookup 7, researcher 4 | Common, predictable parts got more history; CRM lookups and research agents vary most between apps, so they show lower confidence |
| Build time | 45 s per credit-weighted unit, where one unit is a typical 12-credit part | BG gives 45 s per unit but not the unit. A 12-credit unit puts Meeting Prep (~160 credits) at about 10 minutes, close to the seed's 14 minutes |
| Drafting cost | 1 credit per 3,000 tokens, at least 1 | A plan uses about 4,000–8,000 tokens, so drafting costs 2–3 credits, matching screen 16's "only 2 credits were used for drafting" |
| Monthly credit allowance | 2,000, resetting on the 1st | Screens 1 and 12 show "1,240 / 2,000 · Resets 1 Nov" |
| Uploads | Up to 5 files, 10 MB each (bucket cap 20 MB) | Enough for an agenda and a few screenshots; small enough for a free Supabase project |
| PDF text | First 20 pages, up to 40,000 characters | BG says the first 20 pages; the character cap keeps a plan's prompt well inside the model's limits |
| Quote length | Cut at a word boundary to 120 characters | The schema's limit |
| Acceptance lines (weaken test) | A check is split on new lines, semicolons, full stops and "and". An old line counts as kept if at least 70% of its words remain and every number in it is unchanged | 70% tolerates rewording ("lists three talking points" → "includes three talking points"); a changed number ("200 words" → "400 words") always counts as weaker |
| Question limit | Up to 5, blocking first | BG |
| Chat context | The plan plus the last 8 messages | Enough for follow-ups without sending the whole history every time |
| Help answers | Up to 400 tokens, 1–4 sentences, Gemini thinking "low" on non-lite models | Help should answer in a few seconds; thinking "low" took gemini-3.8-flash from about 19 s to 3.5 s |
| Plan route time limit | 120 s (`maxDuration`) | Plans take 3–40 s; this leaves room for slower models and the one retry |
| OpenRouter time limit | 45 s per model call | Under the 60 s plan target, with room for the page to show the pause; OpenRouter's normal plans took 19–41 s in the final run |
| Budget limit | 1 to 100,000 credits per project | Guards against typos; well above any demo plan |
| Browser tests | 15 s per check, 3 browsers at a time locally, 2 in CI | The dev server compiles pages on first visit; seven parallel browsers made it slow enough to flake |

## Live acceptance: 5 prompts × 4 models (5 Oct 2026)

`EVAL_MODELS=gemini,openrouter,claude,gpt pnpm eval:blueprint`, with the demo workspace's Connections. Each plan is checked for: valid schema, every quote from the request, blocking only where expected, within 60 s (OpenRouter: or a clean pause at 45 s). Claude and GPT have no keys here, so Gemini answers for them (Simulated). **20 of 20 passed.** The run before rules a and b passed 18 of 20.

| Model | Meeting Prep | Lead scorer | Support triage | SMS reminder (must block) | Vendor list (must not block) |
|---|---|---|---|---|---|
| Gemini | 7.1 s · 6 parts · Slack workspace | 3.1 s · 5 · none | 3.1 s · 5 · none | 2.7 s · 4 · SMS service | 4.5 s · 3 · none |
| OpenRouter | 38.5 s · 8 · Slack workspace | 19.5 s · 6 · none | 40.5 s · 4 · none | 19.3 s · 3 · SMS service, and timing (see known limits) | 26.9 s · 3 · none |
| Claude (simulated) | 6.7 s · 6 · Slack workspace | 3.3 s · 5 · none | 3.0 s · 5 · none | 2.4 s · 3 · SMS service | 3.6 s · 3 · none |
| GPT (simulated) | 3.2 s · 5 · Slack workspace | 5.6 s · 4 · none | 3.1 s · 5 · none | 4.5 s · 3 · SMS service | 3.6 s · 3 · none |

Browser acceptance on the same day: 15 of 15 (plans within 60 s, the Build gate, change cards and the conflict guard, the rate-limit banner, and M1's checks). Unit tests: 194.

## Known limits

| Limit | Effect | Why it's acceptable for now |
|---|---|---|
| A question that isn't about a service is decided by the model's label alone | OpenRouter labelled "How many minutes before the meeting should the SMS be sent?" as `none`, so the SMS plan asked one question more than it needed to | It errs safe: an extra question, never a missed one. Rules a and b cover the cases that matter (services and channels) |
| The model can still miss a weakening that keeps every acceptance line | A change that narrows scope without touching the check ("only external meetings") counts as weaken only if the model labels it so | The server's test catches checks that lose a line or change a number; scope wording isn't measurable without another model call |
| Plans vary between runs | Part titles, counts and defaults differ run to run and model to model | The rules that protect the person (what blocks, what's weakened, prices) are deterministic; the fixtures pin down the shape |
| OpenRouter's free models are slow and variable | 19–148 s for the same plan across runs | The 45 s limit pauses cleanly with Switch model; Gemini is the default |
| Apply after a build queues a `build` run | The simulator can't yet tell a change apart from a first build | Add `run_kind` (build, change) in M3 |
