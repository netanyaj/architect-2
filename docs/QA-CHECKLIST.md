# QA checklist (run in M6, and on every milestone's own items)

## Core flow (F2): must pass before submission
- [ ] Type the Meeting Prep prompt on Home and press Send. The project opens and the plan streams into the Plan panel and document within 60 s.
- [ ] "Choices I made for you" lists the defaults; the Slack question card blocks Build, with "Answer 1 question to build · 1,240 credits available" beside the disabled button.
- [ ] Answer it, edit one part's wording, then click **Build · ~N credits**. Nothing ran before this click; check `runs.started_by`.
- [ ] The stepper shows "Build · n of m working · about x min", and parts move to Works one by one; clicking a part opens its drawer with the check.
- [ ] Brief writer fails, shows "Fixing it, try 1 of 3" under In progress, then passes. Usage shows a separate fix line.
- [ ] Gmail sits under Needs you with "Connect Google account" as the screen's primary; connecting moves it to Works and drops "using sample data".
- [ ] Chat: "Also send me a Friday recap" returns a change card. Apply creates v2, and nothing builds until Apply.
- [ ] Launch: the checklist blocks "Share with your team" until fixed; the Team version gets a URL; Live after approval; version history goes back.
- [ ] The same flow works with the OpenRouter model selected, and with Claude/GPT (Simulated tag visible).
- [ ] A rate-limit error shows the paused banner with "Switch model".

## States
- [ ] Part blocked after 3 fixes (`?sim=paused`): drawer with the suggested fix as primary, Edit this part, Try once more (cost), Set aside for now, Ask a person.
- [ ] Paused at budget (`?sim=budget`): neutral banner, finished parts kept; Raise budget and continue (primary), Set the parts aside, Stop here.
- [ ] Empty states: no projects, no files, no agents, an empty approval queue. Each has one line saying what to do and a button.
- [ ] Error states: the plan stops part-way (screen 16: kept parts, Try again, Try with another model, Edit my request); GitHub App not installed.
- [ ] A Viewer can't Build, Apply or Deploy; the buttons say why.

## Other flows
- [ ] F3 import: install the GitHub App on 1 repo, analysis shows stack, run commands, secrets, tests and agents, and opens a Blueprint from repo.
- [ ] F4/F8: Developer view opens on Changes (all files vs main, grouped by part), with PR link and coding-agent lines in Activity; ownership transfer works.
- [ ] F5/F6: HubSpot creates an approval; the admin approves with a reason; the item unblocks; an audit row is written.
- [ ] F9: "Move to 2.0" pre-selects the repo in import.

## Design and accessibility
- [ ] Screens match the 17 final screens (`docs/screens/`). Colour is used only for status; blocked and paused are neutral; one primary button per screen; only the 6 type sizes.
- [ ] Keyboard: every control is reachable, the focus ring is visible, Esc closes drawers and Help.
- [ ] Contrast: text ≥ 4.5:1, control outlines ≥ 3:1 (axe in Playwright has no serious issues).
- [ ] Hit areas ≥ 24×24px; no horizontal scroll at 390px wide (panes stack; the stepper collapses to the current stage).
- [ ] Developer view in dark mode is legible, and status colours pass in dark.
- [ ] Reduced motion stops the spinners.

## Honesty and safety
- [ ] Every simulated surface shows the Simulated tag. The README's Real vs Simulated table matches the app.
- [ ] No keys in the client bundle (search the build output for `sk-`, `AIza` and the key names). `.env*` is ignored.
- [ ] Nothing was pushed, deployed or published without Netanya's OK.
- [ ] No milestone labels in the UI: search the app for `(M2)`, `(M3)`, `(M4)`, `(M5)` and "comes in M"; none may show on any screen, tooltip or disabled reason.
- [ ] No disabled Launch settings rows: who can open it, web address, sign-in, keys and passwords all work (sign-in from M4, keys from M4 or M5).
