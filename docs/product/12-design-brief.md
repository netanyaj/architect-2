> **Superseded twice.** The final design is the Soft Tray system (design system v3, 4 Oct 2026): see `design-system/README.md` and `reviews/modern-direction-analysis-2026-10-03.md`.

# Architect 2.0: design brief for sample screens

_Draft 1 · 2026-10-03. Superseded on the flow: there is no split Build button or Review-first mode; Send produces the Blueprint and the user always clicks Build (PRD A-0)._ _ Input to the Claude Design canvas. Sources: PRD (`08`), IA and flows (`10`), design system research (`reviews/design-system-research-2026-10-03.md`)._

## What we're designing
Four screens of Architect 2.0, each in two visual directions, so we can pick one direction and derive a design system from it.

## Who it's for
- **Morgan, the business builder:** not technical. Wants to describe an app, know what it'll cost, and trust that it works. Must never feel lost or talked down to.
- **Sam, the builder-engineer:** wants density, precision, real diffs and logs, and no hand-holding. Uses the developer view of the same project.

**The test:** Morgan can tell what's done and what's not in 5 seconds; Sam doesn't think "toy".

## The ideas the visuals must carry
1. **The Blueprint is the spine.** The left panel is the record of what you get, so it must be the most legible thing on screen.
2. **Status is the main use of colour.** There are eight item statuses, and colour must never be decorative where status could be confused:

   | Status | Meaning | Treatment idea |
   |---|---|---|
   | Building | Being built now | Animated or neutral-active |
   | Built ✓ | Built, with a passing check | Green |
   | Needs connection | Waiting on an account to be connected | Amber, with an inline "Connect" |
   | Needs approval | Waiting on an org admin | Amber or violet, with the approver named |
   | Failed check | Check failed; fixing x/3 | Red, with the attempt count |
   | Sample data | Works, but on fake data | Striped or outlined amber, plus a banner in the preview |
   | Deferred | Moved out of this version | Grey |
   | Dropped | Removed, with a reason | Grey, struck through |

3. **Evidence beside every promise.** The proof strip is calm and factual: check type, who wrote it, when, a screenshot, and the result.
4. **One primary action per screen.** Deploy is the only primary button in a project.
5. **Cost is always visible and honest.** Estimate vs used; fixes appear as their own line.

## Screens (same content in both directions)
1. **Home.** One composer ("What should we build?"), with Attach, Import repo, Template, "Help me decide", a model chip and a Build split button (Build now / Review Blueprint first). Below it: recent projects with readiness, and templates and Agentlets.
2. **Project workspace, mid-build (Builder view).** The busiest screen, with every status visible. Project "Meeting Prep":
   - header: Readiness 7 of 9 proven, 142 credits used of an estimated 160, environment, model, Builder/Developer, Share, Deploy;
   - Blueprint v3 with groups Features, Integrations, Agents and Quality, and items as in the wireframe (Gmail: Needs connection; Brief writer: Failed check, fixing 1/3; plus one Sample data, one Deferred and one Dropped);
   - preview with device sizes, Select element and a sample-data banner;
   - proof strip for the selected item;
   - conversation with grouped build activity and a proposed-change card ("+1 item · Weekly summary email · ~12 credits · Apply / Edit").
3. **Deploy drawer.** Environments (Preview → Staging → Production) and pre-publish checks, each naming its item and fix: tests, a security and personal-data scan, missing secrets, sample data. Deploy is blocked with a reason until everything passes.
4. **Developer view, dark.** The same project, with Code and Terminal tabs, a file tree, a per-item diff in the proof strip, and the branch and PR status in the header.

## Two directions to compare
| | A. Precise and friendly | B. Engineered monochrome |
|---|---|---|
| Reference | Attio (light), Dovetail (dark) | Vercel (Geist) |
| Canvas | White, cool-grey hairlines | Off-white #fafafa, black ink |
| Accent | One cobalt blue for primary actions only | None: black primary buttons; colour only for status |
| Type | Inter; JetBrains Mono for code and costs | Geist Sans and Geist Mono |
| Shape | 6–8px radius, compact | 6px radius, hairline rings, compact |
| Warmth | Friendly copy and a softer Home (a nod to Replit's tone) | Terse, terminal-like labels |

Both use free fonts, map to Tailwind and shadcn, and keep our own layout. We borrow feel, not brand marks.

## Constraints
- Desktop first (1440px wide); the workspace must work at 1280.
- WCAG AA contrast, including for status colours, and status is never shown by colour alone (each has an icon and a label).
- Real copy throughout, no lorem ipsum, with plain words for Morgan ("Needs connection", not "OAuth pending").
- Simulated features in the prototype carry a small "Simulated" tag. Show one on the Deploy drawer.
