# StatusMark

How a status appears: an icon in a 20px circle, plus a word only where it helps.

- **Classes:**
  - `.st` plus one of `works`, `building`, `attention`, `approval`, `failed` or `todo` (neutral);
  - `.statusw` for the inline "dot plus word" in lists, with `w-works` and the other `w-` colour classes.
- **Finished rows** show only the check; never a filled chip.
- **Blocked or paused** uses `todo` with a pause icon, in neutral ink. Red is only for failed checks and errors.
- **Colour is never the only signal:** the icon shape differs per status.
