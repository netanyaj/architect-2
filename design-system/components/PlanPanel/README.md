# PlanPanel

The project's spine. It's always on the left of the workspace, inside a tray.

- **Classes:** `.pane.plan` holds `.ph` (title), a progress line (`.prog`), then `.group` sections with `.gh` headers and rows.
- **Order is fixed:** Needs you, In progress, Works, Up next. "Needs you" rows are NeedsYouCards with their one action.
- **"Works" collapses** after 3 rows to "Show N more".
- **Cost** appears once, as the total in the progress line. Per-part cost lives in the full plan.
- **It collapses** to a 56px rail when a full-width tool needs the room.
