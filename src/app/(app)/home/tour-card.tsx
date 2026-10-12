"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { buttonClasses, IconButton } from "@/components/ax/button";
import { useTourGuide } from "@/components/ax/tour-guide";
import { TOUR_STEPS, type TourView } from "@/lib/tour";
import { cn } from "@/lib/utils";
import { minimiseTour } from "@/server/actions/tour";

/*
 * The tour on Home (M5.10, v2 in M6), before it's started. A demo visitor gets a welcome card above the composer, whose
 * Start the tour is the page's one primary. Everyone else gets a compact card under the composer. × puts the tour
 * away to the guide at the bottom left (it doesn't hide it for good: that's "Don't show again", in the guide).
 */

function useCardActions() {
  const router = useRouter();
  const { start: startTour, reload } = useTourGuide();
  const [pending, start] = useTransition();
  return {
    pending,
    begin: () => start(() => startTour()),
    putAway: () =>
      start(async () => {
        const r = await minimiseTour("card");
        if (!r.ok) return;
        await reload();
        router.refresh();
      }),
  };
}

/** A demo visitor's welcome, above the composer. */
export function TourWelcome() {
  const { pending, begin, putAway } = useCardActions();
  return (
    <section aria-labelledby="tour" className="flex flex-col gap-3 rounded-card border border-line-ctl bg-tray p-5">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id="tour" className="text-sub font-semibold">
            Take the tour
          </h2>
          <p>You&apos;re in the demo as Morgan, an Owner. This workspace is deleted after 7 days.</p>
          <p className="text-ink-2">The tour shows the whole story in five steps, about 5 minutes: a plan, a build, a blocker, a launch, and the audit log.</p>
          <p className="text-small text-ink-2 md:hidden">Best on a laptop: the tour shows the plan, the build and the preview side by side.</p>
        </div>
        <IconButton icon="close" label="Minimise the tour" quiet size={32} aria-disabled={pending || undefined} onClick={putAway} />
      </div>
      <button type="button" aria-disabled={pending || undefined} onClick={begin} className={cn(buttonClasses({ variant: "primary" }), "self-start")}>
        {pending ? "Starting…" : "Start the tour"}
      </button>
    </section>
  );
}

/** Everyone else: a compact card under the composer. */
export function TourCard({ tour }: { tour: TourView }) {
  const { pending, begin, putAway } = useCardActions();
  return (
    <section aria-labelledby="tour" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-line bg-surface py-3 pr-3 pl-5">
      <div className="flex min-w-[220px] flex-1 flex-col">
        <h2 id="tour" className="font-semibold">
          Take the tour · {tour.done.length} of {TOUR_STEPS.length}
        </h2>
        <p className="text-small text-ink-2">The whole story in five steps, about 5 minutes.</p>
      </div>
      <button type="button" aria-disabled={pending || undefined} onClick={begin} className={buttonClasses({ size: "sm" })}>
        {pending ? "Starting…" : tour.done.length ? "Carry on" : "Start the tour"}
      </button>
      <IconButton icon="close" label="Minimise the tour" quiet size={32} aria-disabled={pending || undefined} onClick={putAway} />
    </section>
  );
}
