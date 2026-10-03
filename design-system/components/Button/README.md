# Button

Pill-shaped buttons that say what happens.

- **Classes:** `.btn`, `.btn.pri` (primary), `.btn.q` (quiet), `.btn.sm` (inside cards and rows), `.icb` (icon only, needs `aria-label`), `.lnk` (text link, 24px target).
- **One `.pri` per screen.** If the stage action is blocked by something fixable on screen, that fix is the `.pri` and the stage action becomes a disabled `.btn`.
- **Disabled buttons use `aria-disabled="true"`** and always carry their reason, in a `title` and in visible text nearby. A disabled primary keeps its weight (`primary-disabled`) so the screen still has an anchor.
- **Labels** are a verb plus an object: "Connect Google account", "Allow 250 words". Add the cost to paid actions: "Build · ~160 credits".
