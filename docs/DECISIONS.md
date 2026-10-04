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
| Model | BG: Gemini on the free tier | `gemini-3.5-flash-lite` | `gemini-3.8-flash` allows 20 free requests a day, used up quickly by plans, chat, Help and reviewers |
| OpenRouter model | BG: "a `:free` model" | `nvidia/nemotron-3-super-120b-a12b:free` | Timed the free models with structured output on the Meeting Prep plan: nemotron 25.6 s and valid; qwen3.8-27b 167 s (over the 60 s target); gemma-4-31b gave no structured output |
| OpenRouter allowed | DATA-MODEL: Claude, GPT, Gemini allowed | OpenRouter added to the seeded model policy (migration 0004; kept by Reset demo data) | M2 acceptance requires the demo prompts on OpenRouter |
| Structured output | BG: `streamObject()` with the Blueprint schema | `streamText` + `Output.object()` (AI SDK 7's replacement), with a relaxed draft schema; the strict schema is enforced by the server afterwards | AI SDK 7 replaced `streamObject`. Gemini rejects the strict schema as too complex ("Request contains an invalid argument") |
| Server tidying | BG: on validation failure, retry once with the errors | Keys are tidied into valid unique keys, and quotes over 120 characters are cut at a word boundary, without a retry; anything else retries once | Keys are internal ids, and a quote's opening words are still the person's exact words. Retries cost time and quota |
| Blocking questions | BG schema: the model sets `blocking` | The model labels `default_effect` (keep, reduce, remove, none); the server blocks Build for reduce, remove and none (migration 0005) | The model over-flagged questions that had a recommended answer, holding Build for no reason |
| Slack workspace | A blocking question when there's no safe default | Decided by the server: blocks only when the request asks for Slack and names no channel; a named channel, or Slack the planner chose itself, is a default | Without it the demo's key moment (the Slack question holding Build) depended on the model's mood |
| Conflict guard: weaken | A-3: removing or weakening a part needs Keep / Defer / Drop | Every change carries a kind (add, modify, weaken, remove); weaken and remove both get the card. The server also marks a change as weaken if it cuts a part's acceptance lines or drops one, whatever the model said | The same pattern: the model labels, the server decides |
| Weaken decisions | Keep / Defer / Drop | Keep = the part stays as asked; Defer = set aside; Drop = the stronger version goes and the part is built as changed, with the reason saved on it | The three words from the PRD, applied to a weakening |
| System prompt | BG: the prompt text given | The spec's rules kept word for word, plus a field guide: key format, item classes, providers, `default_effect`, plain-word titles | The model needs the field rules to fill the schema reliably |
| How the plan reaches the page | BG: the client renders from Realtime on `items` | The page renders from the streamed response; parts are saved as they arrive, and Realtime follows a plan written in another tab or after a reload | Same result with less delay; Realtime still keeps tabs in step |
| Images | BG: images "captioned by the same model" | Images are passed to the model as images | One call fewer, and nothing lost in a caption |
| Uploads | Attachments go to the project store | Supabase Storage, private `uploads` bucket. The browser uploads straight to the bucket through signed slots; the server reads PDFs and lists the files | Vercel caps request bodies at 4.5 MB (server actions at 1 MB), so files can't pass through our server |
| Build before M3 | BUILD-SPEC: clicking Build "starts the simulator" | Build agrees the plan through the database's Build gate (`agree_and_build`) and queues a run started by the person | The simulator is M3; it will play queued runs |
| Edits before Build | A-5: any later change creates a new version | Wording, answers and defaults change the draft in place; chat Apply always makes a new version | Versions mark agreed changes; small edits before Build would make dozens |
| Apply after a build | A-11: Apply starts building the change | Apply makes the new version and queues a run through the same Build gate, as kind `build`. **Open: add `run_kind` (build, change) in M3** | The gate has no run-kind setting yet; harmless until the simulator reads it |
| Viewers in chat | PRD: Viewers read and comment | Viewers can chat with Talk first only; it never changes the plan | Matches "comment, don't build" |
| Fixtures | BG: `tests/fixtures/prompts/` | `test/fixtures/prompts/` and `test/fixtures/blueprints/` (recorded real output) | Matches the existing test folder |
| Fixture prompts | The 3 demo prompts | The 3 demo prompts, plus "SMS reminder" (must block: no SMS service) and "vendor list" (must not block) | Pins down both sides of the blocking rule |

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
| Plan route time limit | 120 s (`maxDuration`) | Plans take 4–30 s; this leaves room for slower models and the one retry |
| Budget limit | 1 to 100,000 credits per project | Guards against typos; well above any demo plan |
| Browser tests | 15 s per check, 3 browsers at a time locally, 2 in CI | The dev server compiles pages on first visit; seven parallel browsers made it slow enough to flake |
