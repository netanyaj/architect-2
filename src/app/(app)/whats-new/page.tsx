import type { Metadata } from "next";

export const metadata: Metadata = { title: "What's new · Architect" };

const NOTES: { date: string; title: string; items: string[] }[] = [
  {
    date: "11 Oct 2026",
    title: "Clearer project screens",
    items: [
      "Tabs are App · Plan · Agents · Data, and the panel on the left is Parts.",
      "Launch always opens, and says how many things are left to fix.",
      "Changes: one place to review, open and merge a pull request.",
      "Ask · Make changes in the message box.",
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

/** What's new in Architect 2.0 (Help and resources): the latest changes, newest first. */
export default function WhatsNewPage() {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-8 pt-10 pb-12 max-sm:px-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-[650]">What&apos;s new</h1>
        <p className="text-ink-2">The latest in Architect 2.0, newest first.</p>
      </div>
      {NOTES.map((n) => (
        <section key={n.title} aria-label={n.title} className="flex flex-col gap-2 rounded-card border border-line p-4">
          <span className="text-small text-ink-2">{n.date}</span>
          <h2 className="text-sub font-semibold">{n.title}</h2>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {n.items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
