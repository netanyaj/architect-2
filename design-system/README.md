# Architect 2.0 · Soft Tray

The design system for Architect 2.0. It is calm enough for an ops lead who uses the app for 20 minutes a week, and precise enough for the engineer who reads the diff.

Every screen answers three questions in this order: **where am I, what needs me, what does it cost.**

Reference screens: the "Architect 2.0 – Modern direction" canvas, page "Final screens · Soft Tray" (17 screens).

## Principles
1. **Plan first, build on your click.** Nothing is built or charged until the user presses Build or Apply. Every paid button shows its cost. Every disabled button says why.
2. **Show what needs the user, hide what doesn't.**
   - Blockers come first, each with its one action.
   - Finished work collapses to "Show 4 more".
   - Detail (checks, history, console) opens on demand in a drawer or from the dock.
3. **One main button per screen.**
   - It's black and pill-shaped.
   - If the stage action is blocked by something the user can fix on this screen, the fix is the main button. The stage action becomes a disabled secondary with its reason.
4. **Colour means status, nothing else.**
   - Status is shown as an icon plus a word, only where it needs attention.
   - Finished rows get a quiet check, never a filled chip.
   - Blocked and paused are neutral ink, never amber or red.
5. **Group with surfaces, not lines.** A warm tray holds white cards; hairlines are a last resort.
6. **Plain words.** The user's words, not the platform's (see Words).
7. **The preview is the whole app.** Architect's tools float over it in one dock; they never shrink it.
8. **Measured accessibility.** Text is at least 4.5:1 in both themes. Control outlines are at least 3:1. Hit areas are at least 24px. Focus rings are visible. Every icon button has a label.

## Words
| Say | Not | Why |
|---|---|---|
| Plan | Blueprint, PRD | What people already call it. "Blueprint" survives only as the document type in code and docs |
| Part (of the plan) | Item, requirement | Small and concrete |
| Works | Proven, passed, built | One word for "done and checked" |
| Test version · Team version · Live | Preview · Staging · Production | Says who can see it |
| Ask a question, or describe a change | Talk first, Plan mode, Execute mode, Ask · Make changes | No mode switch (M5.8): Architect reads each message as a question or a change. Changes come back as a card to apply; "Just answer instead" when it guessed wrong |
| Build · ~160 credits | Run, Execute | "Build" is only ever the paid action |
| Blocked | Needs you (for a stop), Paused | Honest; the reason goes on the next line |
| Needs you | Action required | A group heading, never a status |
| Point at something | Element picker | What the user does |
| Keys and passwords | Secrets, environment variables | Non-technical wording; developers see the same thing in Developer view |

**Voice:**
- Sentence case everywhere.
- Buttons say what happens: "Connect Google account", "Allow 250 words", "Raise budget to 125 and continue".
- Errors say what happened, what is kept and what to do.
- No exclamation marks, no "Oops".

## Colour
Read `tokens.json` for the values and their usage.

**Neutrals:**
- canvas #eeede9
- tray #f6f5f2
- surface #ffffff
- selected #ecebe6
- line #e3e2dc (decorative)
- line-ctl #75746c (anything you can press)
- ink #1a1a19, ink-2 #42413d, ink-3 #5c5b56

**Status (icon plus word):**

| Status | Colour | Meaning |
|---|---|---|
| works | green | done and checked |
| building | blue | in progress; also the Test version badge |
| attention | amber | the user can fix it: connect, upload |
| approval | violet | waiting for an admin |
| failed | red | a check failed and Architect is fixing it, or an error |
| blocked | neutral ink, pause icon | stopped; needs a decision |

The status hues are never used for decoration, links, or "brand".

**Dark** is the Developer view theme; it's also available as a user setting. Same tokens, same rules.

## Type
- **Figtree** for everything you read.
- **Geist Mono** only for code, file names, URLs and the terminal.
- **Scale:** display 40 (Home only) · title 28 · heading 20 · subheading 16 · body 14 · small 12.5. No other sizes.
- **Weights:** 400 body, 600 names, 650 headings.
- **Credits use tabular figures**, not mono.

## Shape and space
- **Radius:** panes 18, cards 12, tiles 10. Buttons, pills, segments, the stepper and badges are always pills.
- **Space:**
  - steps of 4: 4, 8, 10, 12, 16, 20, 24, 32, 48;
  - panes sit 10px apart on the canvas.
- **Elevation:**
  - panes have a soft shadow;
  - the dock, popovers and drawers get stronger shadows;
  - drawers sit over a 32% scrim.
- **No glass.** Translucency makes contrast depend on the app behind it.

## Layout: the project workspace
- **Header on the canvas:**
  - ← projects · project tile and name · **stepper** (Plan · Build · Launch, with the current stage's progress inside it);
  - Help "?" · Share · "⋯" (Developer view, version history, duplicate, download code, GitHub, settings);
  - the stage's one action.
- **Plan panel (340px, tray):** groups in this order: Needs you → In progress → Works → Up next.
- **Stage (fills the rest):** App · Agents · Data · Files as a quiet segmented control. The app sits in a frame labelled "Test version", with the dock floating at the bottom.
- **Chat (344px):** the thread, change cards, the queue and the composer.
- **Collapsing:** the Plan and Chat panels collapse to 56px rails when a full-width tool needs the room (Files, Data, Agents, Launch).
- **Outside a project:** the tray side nav (Home, Projects, Agents, Connections, Marketplace, Usage, then Admin: Approvals, Governance), a credits card, Help, then the account.

## Iconography
- Inline stroke icons at 1.7px on a 20px grid, `currentColor`, round caps.
- 15px inside controls, 18px in nav.
- Icon tiles (34px, radius 10) identify projects, files and templates; a dark tile marks the current project.
- No emoji, no illustrations.

## Using it
- **CSS:** load `components/bundle.css` and wrap UI in `<div class="mx opt-c">` (add `dark` for the dark theme). Each component's README names its classes; its preview shows real markup.
- **Code:** the app uses `src/app/tokens.css` (generated from `tokens.json`) with Tailwind v4. Map the classes to components in `src/components/ax/`.

## Changelog
- **v3 (4 Oct 2026):** Soft Tray replaces the B monochrome system (v1–v2):
  - Figtree instead of Geist;
  - tray layering instead of hairlines;
  - the stepper instead of the environment picker and readiness meter;
  - status as icon plus word;
  - plain-language words.

  Older versions are in this system's history.
