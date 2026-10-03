# Segmented

Switches between views of one thing.

- **Classes:** `.seg` holds buttons, and the selected one gets `.on`.
- **Where it's used:**
  - the stage views (App · Agents · Data · Files, plus Code · Terminal in Developer view);
  - list filters with counts in the label ("Waiting 3");
  - the agent sub-views.
- **Roles:** use `role="tablist"` for views and `role="group"` with `aria-pressed` for filters.
