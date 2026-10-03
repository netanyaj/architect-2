# Design: Architect 2.0 · Soft Tray

**Source of truth:**
- The "Architect 2.0 – Modern direction" canvas, page "Final screens · Soft Tray" (17 screens). PNGs and HTML for every screen are in `docs/screens/`.
- The "Architect 2.0 · Soft Tray" design system, copied into `design-system/`: the README is the brand book, plus `tokens.json` and one README and live preview per component.

**Tokens:** `src/app/tokens.css`, generated from `design-system/tokens.json`.
- Use the Tailwind classes it creates, never a hard-coded colour: `bg-canvas`, `bg-tray`, `bg-surface`, `text-ink-2`, `border-line-ctl`, `rounded-pane`, `rounded-card`, `shadow-pane`, `text-body`, `text-small`.
- Dark mode is `data-theme="dark"` on `<html>`.

**Fonts:** Figtree (UI) and Geist Mono (code only), via `next/font/google`. Use tabular figures for credits.

**Reference CSS:** `design-system/reference/screens.css` is the stylesheet the screens were drawn with. Use it to check spacing and states; don't import it into the app.

## The look in one paragraph
- **Ground and grouping:** a warm neutral canvas with white work surfaces. The Plan panel, side nav and lists sit in a slightly darker **tray** holding white cards, so grouping comes from surfaces, not lines.
- **Type:** Figtree on a 40/28/20/16/14/12.5 scale.
- **Shape:** buttons, pills, segments and the stepper are all pills. One black primary per screen.
- **Colour:** means status only, shown as an icon plus a word where it needs attention. Blocked and paused are neutral ink.
- **Preview tools:** they float over the app in one dark dock.

## Components to build (`src/components/ax/`)
| Component | Design-system file | Built on (shadcn) | Used on screens |
|---|---|---|---|
| `Button`, `IconButton`, `TextLink` | components/Button | Button | all |
| `Pill`, `Tag` | components/Pill | Toggle, Badge | 1, 2, 3, 9, 15 |
| `Stepper` | components/Stepper | n/a | every project screen |
| `Segmented` (views and filters) | components/Segmented | ToggleGroup, Tabs | 3, 5, 8, 9, 11, 12, 13 |
| `SideNav`, `CreditsCard` | components/SideNav | n/a | 1, 11, 12, 14, 15, 17 |
| `PlanPanel`, `PlanRow`, `PlanGroup` | components/PlanPanel | Collapsible | 2, 3, 4, 6, 7, 8, 9, 16 |
| `NeedsYouCard` | components/NeedsYouCard | Card | 3, and Needs-you rows everywhere |
| `StatusMark`, `StatusWord` | components/StatusMark | n/a | all |
| `PreviewFrame`, `PreviewDock`, `ConsoleSheet` | components/PreviewDock | Sheet | 3, 6, 7 |
| `Composer`, `QueueLine` | components/Composer | Textarea | 1, 2, 3, 7, 8, 16 |
| `ChangeCard` | components/ChangeCard | Card | 3 |
| `Drawer` (part detail, agent settings) | components/Drawer | Sheet | 6, 9 |
| `StageBanner` (paused, error, question) | components/Banner | Alert | 2, 7, 16 |
| `ListRow`, `Tray` | components/ListRow | n/a | 1, 11, 12, 14 |
| `TemplateCard` | components/TemplateCard | Card | 1, 14, 15 |
| `VersionCards`, `SettingRow`, `Toggle` | components/VersionCards, Toggle | Switch | 4 |
| `AgentGraph`, `GraphNode` | components/GraphNode | n/a (React Flow allowed) | 9 |
| `DataTable` | components/Table | Table | 10, 13 |
| `CodeDiff`, `ChangedFiles`, `Terminal` | components/CodeDiff | n/a | 8 |
| `HelpPanel` | components/HelpPanel | Popover | 12, and "?" everywhere |
| `EmptyState` | components/EmptyState | n/a | 17, and every empty list |
| `SimTag` | n/a | Badge | every simulated surface: a dashed outline pill with the word "Simulated" |

## Copy rules
- Use the words in the design-system README: plan, part, works, Test version / Team version / Live, Talk first, Blocked, Keys and passwords, Point at something. "Blueprint" stays in code, the API and the docs only.
- Sentence case. Buttons say what happens; paid buttons show the cost.
- Every disabled button shows why, in a `title` and in visible text nearby.
- Errors say what happened, what is kept and what to do next.
- Use the copy on the final screens; never lorem ipsum.
