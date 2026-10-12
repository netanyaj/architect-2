"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { buttonClasses, IconButton } from "@/components/ax/button";
import { Icon } from "@/components/ax/icon";
import { nextStep, TOUR_COPY, TOUR_STEPS, type TourView } from "@/lib/tour";
import { cn } from "@/lib/utils";
import { dismissTour, openTourStep } from "@/server/actions/tour";

/** The guided tour (M5.10): five steps that deep-link, done as you do them. Dismissible; progress is saved. */
export function TourCard({ tour }: { tour: TourView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const next = nextStep(tour.done);
  return (
    <section aria-labelledby="tour" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id="tour" className="text-sub font-semibold">
            Take the tour · {tour.done.length} of {TOUR_STEPS.length}
          </h2>
          <p className="text-ink-2">
            The whole story in five steps, about 5 minutes.
            {tour.demoVisitor && " You're in the demo as Morgan, an Owner. This workspace is deleted after 7 days."}
          </p>
        </div>
        <IconButton
          icon="close"
          label="Hide the tour"
          quiet
          size={32}
          aria-disabled={pending || undefined}
          onClick={() =>
            start(async () => {
              const r = await dismissTour();
              if (r.ok) router.refresh();
            })
          }
        />
      </div>
      <ol className="flex flex-col">
        {TOUR_STEPS.map((s, i) => {
          const done = tour.done.includes(s);
          const isNext = s === next;
          return (
            <li key={s} className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0">
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-6 flex-none place-items-center rounded-full text-small font-semibold",
                  done ? "bg-works-bg text-works" : isNext ? "bg-primary text-on-primary" : "bg-selected text-ink-2",
                )}
              >
                {done ? <Icon name="check" size="sm" /> : i + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className={cn("font-semibold", done && "text-ink-2")}>
                  {TOUR_COPY[s].title}
                  {done && <span className="sr-only"> · done</span>}
                </span>
                <span className="text-small text-ink-2">{TOUR_COPY[s].line}</span>
              </div>
              <Link
                href={tour.links[s]}
                onClick={() => void openTourStep(s)}
                className={isNext ? buttonClasses({ size: "sm" }) : "min-h-6 flex-none text-small font-semibold text-ink underline decoration-line-ctl underline-offset-[3px]"}
              >
                {isNext ? TOUR_COPY[s].action : done ? "Again" : "Open"}
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
