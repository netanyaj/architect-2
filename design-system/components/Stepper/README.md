# Stepper

The project header's one answer to "where am I".

- **Classes:** `.stepper` holds `.stp` buttons; `.stp.done` shows a check, `.stp.on` is the current stage (black) with a `.sub` progress line. Separators are `.stsep`.
- **The current stage's `.sub`** carries the one progress figure ("7 of 12 working · about 6 min", "1 question left", "paused at budget").
- **A paused build shows a pause icon** in the stage number.
- **It replaces** the environment picker, readiness meter, credit line and Builder/Developer switch. Don't add those back to the header.
