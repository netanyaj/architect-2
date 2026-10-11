# Soft Tray v4: brand layer decision (11 Oct 2026)

Picked by Netanya from the brand drafts page (artifact "Architect Brand Drafts", section "Your pick · v4").

## Decision
| Element | Choice |
|---|---|
| Type | **Unchanged.** Figtree for everything, Geist Mono for code, file names, URLs and the terminal |
| Nav and layout | **Unchanged.** The left tray nav, the project workspace layout |
| Brand palette | **Greens** (moss, fern, lime, mist) |
| Picture accents | **Peony, tangerine, yolk, lilac**, used only inside pictures, one per project, as in the Museum of PPT images |
| Illustration | **Mosaic** pictures |
| Agent glyphs | **Dotted** shapes, one per agent role |
| Build loader | **Morphing shape**, cycling through greens and accents |

## Rules (so brand never fights status)
1. **Status colours keep their jobs.** Green = works, violet = approval. Brand greens and lilac never appear on badges, buttons, links, status icons or text next to a status.
2. **Moss is not the "works" green.** Moss (#2F6B3F) is darker and greyer than the status green. Brand green only ever shows up as a picture, glyph, logo or the greeting's full stop, never as an icon-plus-word.
3. **Accents live inside art only:** mosaic thumbnails, empty-state pictures, the loader, Launch and Usage charts, and the landing page. Never as a fill on UI.
4. **One accent per project,** picked from the project id, so every project is recognisable without a label.
5. **Where brand appears:** the logo mark, the full stop in the Home greeting, the credits bar fill, project and template thumbnails, empty states, agent glyphs, the build loader, Launch and Usage charts, and the landing page.
6. **Replaces v3's "no illustrations" rule.** Pictures are allowed in the places above; emoji are still out.

## Tokens
| Token | Light | Dark | Use |
|---|---|---|---|
| `--brand-moss` | #2F6B3F | #7DBA8A | logo, greeting full stop, finished mosaic cells, glyph dots |
| `--brand-fern` | #7FA06A | #5E8A5A | mosaic cell of the part being built |
| `--brand-lime` | #C8D96F | #B5C95A | loader beat, landing highlights |
| `--brand-mist` | #EEF1EA | #1F2620 | glyph tile, empty-state ground, unstarted mosaic cells (#E2E8DC light / #2A332B dark) |
| `--art-peony` | #F28DC4 | #E77FB7 | picture accent |
| `--art-tangerine` | #FF8A3D | #F27F33 | picture accent |
| `--art-yolk` | #FFC21A | #EDB517 | picture accent |
| `--art-lilac` | #B9A6F5 | #A893EC | picture accent |

## The three components
**`<MosaicThumb project>`** (SVG, server-rendered, no canvas)
- One column per plan part; filled cells show progress: moss = works, fern = being built, mist = up next.
- Height per column is deterministic from the part id, so the thumbnail is stable between renders.
- Exactly one cell takes the project's accent (hash of project id → one of the four accents).
- Used on Home tiles, the Projects list, Templates and the project tile in the header (the tile shows a 4-column crop).
- Has `aria-hidden`; the tile's text carries the meaning.

**`<AgentGlyph role>`** (SVG)
- A 3.2px dot grid on a mist tile (radius 10), dots in moss. Each role has one shape: planner = ring, extractor = slanted block, checker = diamond, notifier = bell, router = fork, writer = stacked lines, data analyst = bars, custom = dot cluster.
- Sizes: 20 (lists), 34 (cards), 52 (agent detail). Replaces generic agent icons on the Agents graph, the agent list and Try it.

**`<BuildLoader step>`**
- A 56px shape morphing circle → half-circle → square → leaf → lens → rounded square, cycling moss → lime → peony → fern → tangerine → lilac, 3.6s.
- Sits in the empty preview while the first build runs, with the current progress line underneath in Geist Mono ("Build 4/6 · Writing the rate-card check").
- Under `prefers-reduced-motion`, it shows a still moss circle.
- Replaces spinners only on build screens; small inline spinners stay.

## Prompt for Claude Code (M5.7, about 2 to 3 hours)
> Add the Soft Tray v4 brand layer. Read `docs/build/notes/23-brand-layer-v4.md` (I'll add it) for the rules and tokens. Don't change fonts, layout, the left nav, components or status colours.
> 1. Add the eight brand and art tokens (light and dark) to `tokens.json` and regenerate `src/app/tokens.css`. Add a lint-style comment: brand and art tokens are for pictures only.
> 2. Build `src/components/ax/MosaicThumb.tsx` as server-rendered SVG: one column per plan part, cells moss / fern / mist by part status, deterministic heights from the part id, one accent cell chosen by hashing the project id into peony, tangerine, yolk or lilac. Use it on Home tiles, the Projects list, Templates and the header project tile (4-column crop). `aria-hidden`.
> 3. Build `src/components/ax/AgentGlyph.tsx`: dotted shapes on a mist tile for planner, extractor, checker, notifier, router, writer, data analyst and custom; sizes 20, 34 and 52. Replace the current agent icons on the Agents graph, agent list and Try it. Map each existing agent to a role; anything unknown uses custom.
> 4. Build `src/components/ax/BuildLoader.tsx`: the morphing shape (CSS keyframes, 3.6s, the six colours in order), with the current progress line under it in Geist Mono. Show it in the empty preview during a build. Respect `prefers-reduced-motion` (a still moss circle).
> 5. Brand touches: logo mark in moss, the full stop of the Home greeting in moss, the credits bar fill in moss. Nothing else turns green.
> 6. Empty states (Projects, Agents, Connections, Usage) get a small mosaic picture in mist and moss with one accent cell, plus the existing one-line text and action.
> 7. Check both themes on Home, Projects, a project workspace mid-build, Agents and an empty state. Confirm no brand or art colour appears on a button, badge, link or status. Send me screenshots of each before pushing.
> Update the design system doc and the Soft Tray changelog to v4. Don't push until I've seen the screenshots.
