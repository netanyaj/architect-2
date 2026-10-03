# Pill

Rounded secondary actions and choices that sit together in a row.

- **Classes:**
  - `.pill` is a pressable option, such as "Add files, agents or tools" or "Import a repo".
  - `.pill` with `aria-pressed="true"` and the `.on` style is a toggle that is on (Talk first).
  - `.pill.soft` is a picker that shows its current value (the model).
  - `.tag` is a non-pressable label (Template, Agentlet).
- **Pills sit inside the box they act on** (on Home, inside the composer), never floating outside it.
