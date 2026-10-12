import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonClasses } from "@/components/ax/button";
import { LogoMark } from "@/components/ax/logo-mark";
import { MosaicThumb } from "@/components/ax/MosaicThumb";
import { DemoButton } from "./demo-button";
import { createServerDb } from "@/server/db";

export const metadata: Metadata = {
  title: "Architect 2.0",
  description: "Describe an agentic app, see the plan and its cost, and launch it through your company's rules.",
};

const REPO = "https://github.com/netanyaj/architect-2";
/** The walkthrough video, when it's published (Vercel env). */
const VIDEO = process.env.NEXT_PUBLIC_VIDEO_URL;

/** The landing picture: a finished plan, one column per part, with its one accent (Soft Tray v4). */
const PARTS = ["plan", "screens", "data", "agent", "checks", "connect", "launch"].map((id) => ({ id: `landing:${id}`, status: "built" }));

const PROOF = [
  { title: "Plan and cost before build", line: "One prompt becomes a plan of parts, each with its check and its price. Nothing is built until you click Build." },
  { title: "Proof per part", line: "Every part is built against its own check, and only a passing check marks it Works." },
  { title: "Launch through your company's rules", line: "Test, Team and Live, with approvals, budgets and an audit log your security team sets." },
];

/** The landing page (M6), signed out: one screen. Signed-in people go straight to Home. */
export default async function Landing() {
  const db = await createServerDb();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (user) redirect("/home");

  const link = "min-h-6 font-semibold text-ink underline decoration-line-ctl underline-offset-[3px] hover:decoration-ink";
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-8">
      <div className="flex w-full max-w-[920px] flex-col gap-8 rounded-pane border border-line bg-surface p-10 shadow-pane max-sm:gap-6 max-sm:p-6">
        <div className="flex items-center gap-2.5 text-sub font-bold">
          <LogoMark />
          Architect
          <span className="rounded-full border border-line-ctl px-1.5 text-small font-semibold leading-5 text-ink-2">2.0</span>
        </div>
        <div className="grid items-center gap-8 md:grid-cols-[1fr_auto]">
          <div className="flex flex-col gap-3">
            <h1 className="text-display font-[750] text-balance">Describe an agentic app. See the plan and its cost. Launch it through your company&apos;s rules.</h1>
            <p className="max-w-[60ch] text-sub text-ink-2">
              Architect 2.0 writes the plan before anything is built, proves each part with its own check, and runs your app&apos;s agents on Lyzr Studio.
            </p>
          </div>
          <MosaicThumb seed="architect-landing" parts={PARTS} size={168} className="rounded-pane max-md:hidden" />
        </div>
        <ol className="grid gap-3 md:grid-cols-3">
          {PROOF.map((p, i) => (
            <li key={p.title} className="flex flex-col gap-1 rounded-card bg-tray p-4">
              <span className="flex items-center gap-2 font-semibold">
                <span aria-hidden="true" className="grid size-6 flex-none place-items-center rounded-full bg-surface text-small font-bold text-ink-2">
                  {i + 1}
                </span>
                {p.title}
              </span>
              <span className="text-small text-ink-2">{p.line}</span>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-3">
          <DemoButton />
          <Link href="/login" className={buttonClasses({})}>
            Sign in
          </Link>
          <span className="text-small text-ink-2">The demo is your own seeded workspace, no sign-up. It&apos;s deleted after 7 days.</span>
        </div>
        <nav aria-label="More about Architect 2.0" className="flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-4 text-small">
          {VIDEO ? (
            <a href={VIDEO} target="_blank" rel="noreferrer" className={link}>
              Video
            </a>
          ) : (
            <span className="text-ink-3" title="The walkthrough video isn't published yet.">
              Video (soon)
            </span>
          )}
          <a href={`${REPO}#readme`} target="_blank" rel="noreferrer" className={link}>
            README
          </a>
          <a href={`${REPO}/blob/main/docs/product/ARCHITECTURE.md`} target="_blank" rel="noreferrer" className={link}>
            Architecture
          </a>
        </nav>
        <footer className="-mt-2 text-small text-ink-2">
          Built by Netanya Jaison as a prototype for Lyzr&apos;s Architect · not an official Lyzr product ·{" "}
          <a href={REPO} target="_blank" rel="noreferrer" className={link}>
            GitHub
          </a>
        </footer>
      </div>
    </main>
  );
}
