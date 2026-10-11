# M5.7 review: dotted loader and a premium polish pass (11 Oct 2026)

**Inputs:** Claude Code's M5.7 review page (32 screenshots: Home, Projects, Templates, a build starting and mid-build, Agents list, graph and detail, Try it, four empty states, light and dark), plus Base44 and the inspiration set (docs 21–23).

## Verdict
- **Loader:** yes, switch it to dots. Today's solid morphing blob is the only solid shape in a dotted language: the glyphs, the Agents canvas and the mosaics are all dots or cells, so the blob reads as borrowed.
- **Premium pass:** yes, as a **subtraction pass**, time-boxed to about 2 hours. Remove what is loud or repeated rather than adding decoration. Base44 feels premium because it is quiet, not because it has more art.

## Design critique

### Overall impression
Clean, calm and consistent with Soft Tray. The v4 pictures work, especially the agent graph on its dot-grid canvas. What keeps it from feeling premium is noise: too many outlined pills, status shown loudly on every row, repeated "Simulated" chips and small cryptic markers. Everything is a little too loud at once, so nothing feels considered.

### Usability
| Finding | Severity | Recommendation |
|---|---|---|
| Letter chips on Projects rows ("S", "C G S", "Z") are connector initials. They're unreadable and not clickable | 🟡 | Remove them from the list. Connectors show inside the project |
| The Developer view switch in the project header has no label (just `<>` and a switch) | 🟡 | Label it "Developer view", as decided in doc 20 |
| "Simulated" appears 3–4 times on one screen (the preview frame, the app header, chat messages, the agent detail, Tools) | 🟡 | One "Simulated" label per region, on the frame or panel title. Not on chat messages or individual fields |
| Helper text under the composer: "Changes come back as a card to apply." | 🟢 | Remove it. The first change card teaches this |
| The Home composer has 4 outlined chips, plus Auto, the mic and the button, in two rows | 🟢 | Keep the chips (they help on the first screen) but make them quiet: icon and text with no border, filled on hover |

### Visual hierarchy
- **What draws the eye first:** on Home, the headline, which is correct. Then the coloured status words in "Continue where you left off", which compete with the composer.
- **Emphasis:**
  - Status words are coloured text, so a list of 9 projects becomes a column of orange, purple and blue.
  - Instead, colour only the status icon or dot and keep the word in ink-2. Linear and Base44 do this; it's still icon plus word, and still accessible.
- **Nesting:** "Continue where you left off" and the Projects list put white cards inside a tray box inside a white pane, which is three frames. Drop the tray box so rows sit on the pane with hairline dividers.

### Consistency
| Element | Issue | Recommendation |
|---|---|---|
| Buttons | Almost every secondary action is an outlined pill (Share, ⋯, Launch, Import a repo, Compare, Add an agent), so the screen reads as a kit of parts | Secondary buttons become quiet (tray fill, no border). Keep one ink primary per screen. Pills stay for segments and status only |
| Mosaic at 34px | 12 columns in 34px read as a loading skeleton or a tiny chart | At 34px and below, use the 4-column crop (as in the header tile). Full mosaics only at 72px and up |
| Loader | Solid blob next to dotted glyphs | Dotted loader (spec below) |
| Heading tracking | Default tracking on 20–40px Figtree | −0.02em at 28px and up, −0.01em at 20px. This is Base44's cheapest premium lever |
| Numbers | Credits and counts use proportional figures in places | Tabular figures everywhere numbers sit in columns or meters |

### Accessibility
- **Contrast:** status text passes in both themes. Muted status words (ink-2) still pass at 4.5:1. The disabled "Write the plan" is low contrast by design, which is fine for a disabled control that carries no reason.
- **Targets:** the help button (36px) and the header controls are fine. The 20px glyph in Try it is decorative and `aria-hidden`.
- **Motion:** the reduced-motion still state already exists. Keep it for the dotted loader.

### What works well
- The agent graph: dotted canvas, dotted glyphs, dashed tool links. It's the most "designed" screen and should set the tone.
- The empty state: one mosaic, one line, one primary, one secondary, one link. That's the right density.
- Moss is used sparingly (logo, credits bar, greeting full stop). No brand colour leaks onto buttons.
- Dark mode holds up: the mosaics and glyphs read well on the dark tray.

## Product review
- **Does polish matter for this hand-in?** Partly. Reviewers judge product thinking first (plan-first, governance, honest Simulated labels, cost before spend), and the Loom and README carry that. A visibly crafted UI raises trust in the first 30 seconds of the Loom. A visibly unfinished one lowers it.
- **Risk:** a broad restyle the night before the deadline can break screens that work. **Only change tokens and shared components** (Button, ListRow, StatusLabel, SimulatedBadge, MosaicThumb, BuildLoader). No layout rewrites and no new screens.
- **Order:** M5.8 (if not finished) → M5.9 polish (about 2 h) → M6 (visual QA, README, Loom, form). If time runs short, cut M5.9 items 4–6, not M6.
- **Don't weaken honesty:** fewer "Simulated" chips is fine, but every simulated region keeps one clear label. Reviewers must never mistake a simulated thing for a real one.

## Dotted build loader spec
- **Grid:** 7×7 dots on the same grid as AgentGlyph (3.2px pitch at 52px, scaled to 64px), in moss on a mist tile, radius 12.
- **Motion:** the dots morph between the glyphs of the parts being built, in build order. Building a checker part shows the checker diamond, then the next part's glyph. Each change is per dot (opacity 0→1 and scale 0.4→1, staggered about 15 ms from the centre outwards), 500 ms in, held for 900 ms.
- **Accent:** one dot per frame takes the project's accent colour (the same one as its mosaic), so the loader belongs to that project.
- **Caption:** unchanged, in Geist Mono: "Build 2/5 · Writing the policy check".
- **Reduced motion:** a still ring glyph.
- **Build:** reuse the AgentGlyph shape masks, with one `<span>` per dot and CSS transitions. No canvas or library.

## Prompt for Claude Code (M5.9, about 2 hours)
> M5.9: dotted loader and a polish pass. **Change only tokens and shared components. No layout rewrites, no new screens, and don't remove any feature.** Read `docs/product/25-m57-review-and-polish.md`.
> 1. **BuildLoader:** replace the solid morphing shape with the dotted loader in doc 25: a 7×7 dot grid on a mist tile, morphing between the AgentGlyph shapes of the parts being built, one dot in the project's accent, the Geist Mono caption below, and a still ring under reduced motion. Reuse the AgentGlyph masks. Update `/kit`.
> 2. **Status labels:** colour only the status icon or dot. The word becomes ink-2 (ink for Blocked). This applies everywhere StatusLabel is used. Check contrast in both themes.
> 3. **Buttons:** secondary buttons become quiet (tray fill, no border, ink text; slightly darker fill on hover; a visible focus ring). One ink primary per screen stays. Pills only for segments and status. The Home composer chips become quiet icon-and-text buttons with no border.
> 4. **Simulated:** at most one label per region (the preview frame, the agent detail panel, the Data tab). Remove it from individual chat messages and fields. Every simulated region must still be labelled.
> 5. **Noise:**
>    - Remove the connector letter chips from Projects rows.
>    - Remove "Changes come back as a card to apply." under the chat composer.
>    - Label the header switch "Developer view".
>    - Drop the tray box around "Continue where you left off" and the Projects list, so rows sit on the pane with hairline dividers.
> 6. **Type and numbers:**
>    - Headings get −0.02em tracking at 28px and up, and −0.01em at 20px.
>    - Use tabular figures for credits, counts and estimates.
>    - At 34px and below, MosaicThumb uses the 4-column crop.
> 7. Send before and after screenshots, light and dark, of Home, Projects, a project mid-build (loader visible) and Agents. Don't push until I've seen them.
