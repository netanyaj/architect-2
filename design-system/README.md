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

**Brand and art (v4): pictures only.** Eight more tokens, light and dark, for pictures and nothing else (rules in `docs/product/23-brand-layer-v4.md`):

| Token | Light | Dark | Where |
|---|---|---|---|
| `brand-moss` | #2F6B3F | #7DBA8A | the logo mark, the Home greeting's full stop, the credits bar fill, finished mosaic cells, agent glyph dots |
| `brand-fern` | #7FA06A | #5E8A5A | the mosaic cell of a part being built |
| `brand-lime` | #C8D96F | #B5C95A | a beat of the build loader |
| `brand-mist` | #EEF1EA | #1F2620 | the ground of mosaics and agent glyphs; `brand-mist-cell` (#E2E8DC / #2A332B) is an unstarted cell |
| `art-peony`, `art-tangerine`, `art-yolk`, `art-lilac` | #F28DC4, #FF8A3D, #FFC21A, #B9A6F5 | #E77FB7, #F27F33, #EDB517, #A893EC | one accent per project, inside its picture |

- **Moss is not "works".** It is darker and greyer than the status green and never appears as an icon plus a word.
- **Never on UI:** no brand or art colour on a button, badge, link, status or the text beside a status. They are CSS variables, not Tailwind colours, so there is no `bg-brand-moss` to reach for; `test/unit/brand.test.ts` fails if one shows up outside the picture components.
- **One accent per project,** picked from the project's id, so each project is recognisable without its name.

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
- Icon tiles (34px, radius 10) identify files and anything without a picture.
- No emoji.

## Pictures (v4)
Pictures replace v3's "no illustrations" rule, in these places only. All are SVG or CSS, decorative (`aria-hidden`), and drawn in brand and art colours.
- **Mosaic (`MosaicThumb`):** a project's picture. One column per plan part (up to 8): moss when it works, fern while it's being built, mist when it's up next. Column heights come from the part ids, so the picture never changes between renders; exactly one cell takes the project's accent. On Home, Projects and Templates (34px), and in the project header cropped to 4 columns.
- **Empty states:** a 72px mosaic in mist and moss with one accent, above the existing one-line text and action (Projects, Agents, Connections, Usage).
- **Agent glyph (`AgentGlyph`):** a dotted shape in moss on a mist tile, one per role: planner (ring), extractor (slanted block), checker (diamond), notifier (bell), router (fork), writer (stacked lines), data analyst (bars), custom (dot cluster). 20px in lists, 34px on cards and graph nodes, 52px on the agent's detail. The role comes from the agent's name and description; anything unknown is custom.
- **Build loader (`BuildLoader`):** a 56px shape morphing circle → half-circle → square → leaf → lens → rounded square through moss, lime, peony, fern, tangerine and lilac every 3.6s, with the build's progress line under it in Geist Mono ("Build 2/5 · Building Policy check"). Only in the empty preview while a build runs; small inline spinners stay. With reduced motion it's a still moss circle.
- **Brand touches:** the logo mark's tile, the full stop after the Home greeting, and the credits bar fill are moss. Nothing else turns green.

## Using it
- **CSS:** load `components/bundle.css` and wrap UI in `<div class="mx opt-c">` (add `dark` for the dark theme). Each component's README names its classes; its preview shows real markup.
- **Code:** the app uses `src/app/tokens.css` (generated from `tokens.json`) with Tailwind v4. Map the classes to components in `src/components/ax/`.

## Changelog
- **v4 (11 Oct 2026):** the brand layer. Type, layout, the nav, components and status colours are unchanged.
  - eight brand and art tokens (greens moss, fern, lime, mist; accents peony, tangerine, yolk, lilac), for pictures only;
  - mosaic pictures for projects, templates and empty states;
  - dotted agent glyphs, one per role;
  - the morphing build loader;
  - the logo mark, the greeting's full stop and the credits bar in moss;
  - pictures are allowed in those places (replaces "no illustrations"); emoji are still out.
- **v3 (4 Oct 2026):** Soft Tray replaces the B monochrome system (v1–v2):
  - Figtree instead of Geist;
  - tray layering instead of hairlines;
  - the stepper instead of the environment picker and readiness meter;
  - status as icon plus word;
  - plain-language words.

  Older versions are in this system's history.
