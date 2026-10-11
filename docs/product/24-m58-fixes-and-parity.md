# M5.8: fixes after M5.6 and Base44 parity (11 Oct 2026)

## Why Ask · Make changes existed, and what changes now
**Origin:** PRD BL-4 asked for "chat modes": a plan mode ("Talk first") next to the normal mode, the pattern Cursor, Lovable and Base44 (Discuss) use. In those tools every chat message after a build edits code and spends credits, so users need a safe way to ask "why was invoice 02 flagged?" or "what would Excel support cost?" without changing anything.

**Why it's redundant in Architect 2.0:**
- Nothing changes without a click anyway. Every change request already comes back as a change card with an estimate, and nothing happens until Apply. Plan-stage questions are Architect asking the user, and they live in the plan, not in a chat mode.
- So the switch makes the user pick a mode to get a protection they already have.

**What it still did that's worth keeping:**
- Plain questions get an answer, without a change card, an estimate or a new plan version.
- Viewers can't change anything.

**Decision:** remove the visible switch and keep the behaviour as **intent**:
- A question gets an answer.
- A change request gets a change card.
- When it's unclear, the change card carries a "Just answer instead" link.
- Viewers' change requests become a suggestion card the owner can turn into a change.

BL-4 is still met, and no capability is removed.

## The prompt for Claude Code
> M5.8: fixes after M5.6, plus Base44 parity. **Don't delete any existing feature or route.** Anything I ask you to move must still be reachable from its new place. List every move in the report.
>
> **A. Sidebar footer and menus (Notion pattern, two controls instead of Notion's three)**
> 1. The bottom of the left nav holds two controls side by side:
>    - an **account chip** (avatar + workspace name + ▾);
>    - **one icon button, Resources**.
>    The chip replaces both the workspace menu under the logo and the avatar menu. The workspace name under the logo becomes plain text.
> 2. **Account chip menu**, top to bottom, as plain rows with icons and no inline switches:
>    - Header: workspace name, plan and member count ("Enterprise · 4 members").
>    - Settings; Invite people (copies the invite link); Governance (admins only).
>    - Your email, then the list of workspaces with a check on the current one and a role tag where you aren't the owner. Then New workspace.
>    - Log out.
> 3. **Resources menu:**
>    - Documentation; Join Discord; Keyboard shortcuts.
>    - **Trash** (trash icon, with a count when it isn't empty), which opens a new page, `/trash`.
>
>    **The Trash page** replaces the "Recently deleted" text link at the bottom of Projects. Remove that link, but keep all of its behaviour, database functions and the purge.
>    - The header reads "Trash", with one line: "Projects stay here for 30 days, then they're deleted for good."
>    - The page shows the same tiles or rows as Projects, with who deleted each one, when, and the days left.
>    - Each project has Restore. Owners also get "Delete permanently", confirmed on the page, not in a browser dialog.
>    - An empty state with one line of text.
>    - The page has a breadcrumb back to Projects.
>
>    To keep it visible:
>    - Deleting a project shows a toast: "Moved to Trash · Undo · View Trash".
>    - The delete confirmation says "You can restore it from Trash for 30 days".
>    - "What's new", the three latest release notes as a short list, then View all.
>    - A footer row with one icon button, Theme, that cycles System → Light → Dark. Its tooltip shows the current theme.
> 4. Remove the Theme segmented control and the Developer view default from the menus. Put both under Settings › Preferences. The Developer view switch in the project header stays.
>
> **B. Help**
> 5. One help button, bottom-right on every screen, including inside projects: 36px, 16px from the edges. It's for getting help (ask about Architect, Contact support), not for links: docs, Discord and What's new live only in Resources.
> 6. Inside a project, give the chat composer a right inset (or a footer row) so the button never covers the send button or the input. The panel opens upwards from the button. Remove the header "?" inside projects.
>
> **C. Chat alignment**
> 7. Audit the chat panel and fix alignment:
>    - one left edge for messages, cards, progress lines and the composer;
>    - the same 16px side gutter throughout;
>    - avatars and timestamps on one baseline;
>    - card widths equal to the message column;
>    - no card wider than the panel;
>    - the queue and the composer aligned to the same edges.
>    Send before and after screenshots at 1440 and 1024 width.
>
> **D. Replace the Ask · Make changes switch with intent**
> 8. Remove the switch from the composer. Classify each message as a question or a change request (one cheap call on the default model, or rules first):
>    - A question gets an answer, with no change card and no new version.
>    - A change request gets the existing change card with its estimate and Apply.
>    - A change card from an unclear message shows "Just answer instead", which discards the card and answers.
>    - For Viewers, change requests become a suggestion card ("Suggested by Priya · Turn into a change", owner or Builder only).
>    Keep the message queue unchanged. Update COVERAGE.md for BL-4 to say intent replaces the switch, and keep the behaviour in the tests.
>
> **E. Preview theme**
> 9. Add a Light / Dark switch (two icon buttons) to the preview toolbar next to the device sizes. It sets the colour scheme of the app preview only, whatever the workspace theme is, and is remembered per project.
> 10. If the app's plan has no dark theme, the Dark view shows a small note, "This app has no dark theme yet", with "Add to plan", which creates a change card.
>
> **F. Base44 parity** (from `docs/product/22-base44-curation-review.md`)
> 11. **One + menu in the composer**, three groups:
>     - Files: from computer, Google Drive (Simulated), earlier uploads.
>     - Building blocks: attach Studio agent (real list if the key allows it, otherwise Simulated), Agentlet, template, repo.
>     - Look: design system, Figma (Simulated), screenshot.
>     Fix the broken add-assets button and its CSS as part of this.
> 12. **A composer ⋯ menu**, with each option as a row plus one line:
>     - Auto-approve low-risk steps: shown only when governance allows it; otherwise disabled, with the reason.
>     - Lock parts: the builder can't change the parts you pick.
>     - Project instructions.
> 13. **Model picker:**
>     - Auto first and as the default ("Picks a model for each step").
>     - Relative cost words ("Uses more credits") instead of numbers.
>     - Models blocked by workspace policy stay in the list, disabled, with "Blocked by your workspace".
> 14. **Question cards** in chat: one question at a time with 1/3 paging. Questions that hold Build are tagged "Needed to build"; the others have Skip. The same questions still show in the plan.
> 15. **Build log:**
>     - Each part's progress lines fold into one line that expands.
>     - A key that's missing shows an inline "Action needed" card in chat with Add key / Skip. It's the same object as the Needs-you item, not a copy; resolving one resolves both.
>     - Skip marks the part "Waiting for a key".
> 16. **After a build:**
>     - Three suggestion chips taken from the plan's open items.
>     - "Undo this change" on each applied change card, which creates a new plan version.
> 17. **Credits:** a "Low on credits · View plans" line above the composer, only under 10% of the monthly credits.
> 18. **Project header in three zones:**
>     - left: back, project name, stepper;
>     - middle: App · Plan · Agents · Data and the device sizes;
>     - right: Changes (n), people, ⋯ and Launch (the only primary button).
>     Move View as role, Download code, GitHub, Hand off to coding agent, Activity and Duplicate into ⋯. The Developer view switch stays visible.
> 19. **Look and feel** (Plan › Design): presets as a row of swatches; "Apply to plan" is the only action.
>
> **Order and checks:** do A–E first, then F. Show me any migration before applying it (step 15 may need one). Check both themes and phone width on Home, a project mid-build, the chat with a question card, and the preview in Dark. Send screenshots and the list of moved items before pushing. Don't push until I've seen them.
