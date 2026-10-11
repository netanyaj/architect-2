/** What's new in Architect 2.0, newest first. Resources shows the three latest; /whats-new shows them all. */
export type ReleaseNote = { date: string; title: string; items: string[] };

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    date: "11 Oct 2026",
    title: "Trash, Resources and a quieter chat",
    items: [
      "Your account and workspaces are in one menu at the foot of the nav; docs, Discord, shortcuts, Trash and What's new are under Resources.",
      "Trash: deleted projects stay for 30 days, with Restore.",
      "Chat works out whether you're asking or asking for a change. No more switch.",
      "The app's preview has its own Light and Dark view.",
    ],
  },
  {
    date: "11 Oct 2026",
    title: "Clearer project screens",
    items: [
      "Tabs are App · Plan · Agents · Data, and the panel on the left is Parts.",
      "Launch always opens, and says how many things are left to fix.",
      "Changes: one place to review, open and merge a pull request.",
      "Recently deleted: restore a project for 30 days.",
    ],
  },
  {
    date: "11 Oct 2026",
    title: "Polish",
    items: ["Two workspaces each: the Acme Ops demo and your own Personal one.", "Pages load about five times faster.", "Theme presets for your app, and CSV or Excel files as its test data."],
  },
  {
    date: "10 Oct 2026",
    title: "Governance",
    items: ["Approvals, model and app policies, data egress, permission rules, budgets and the audit log."],
  },
];
