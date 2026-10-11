import type { Metadata } from "next";
import { RELEASE_NOTES } from "@/lib/release-notes";

export const metadata: Metadata = { title: "What's new · Architect" };

/** What's new in Architect 2.0 (Resources): the latest changes, newest first. */
export default function WhatsNewPage() {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-8 pt-10 pb-12 max-sm:px-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-[650]">What&apos;s new</h1>
        <p className="text-ink-2">The latest in Architect 2.0, newest first.</p>
      </div>
      {RELEASE_NOTES.map((n) => (
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
