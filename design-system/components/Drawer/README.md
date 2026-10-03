# Drawer

Detail opens on demand on the right, over a 32% scrim.

- **Used for:** a part's detail (the check, attempts, suggested fix, history), agent settings and similar.
- **Structure:** `.drawer` holds `.dh` (icon, title, one-sentence state), `.db` (content) and `.df` (actions: one primary).
- **Behaviour:** Esc closes it and focus returns to the row that opened it.
