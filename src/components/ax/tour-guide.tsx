"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ARCHITECTURE_URL, README_URL, VIDEO_URL } from "@/lib/links";
import { guideActive, nextStep, stepPhrase, TOUR_COPY, TOUR_STEPS, type TourStep, type TourView } from "@/lib/tour";
import { cn } from "@/lib/utils";
import { closeHint, dismissTour, expandTour, finishTour, markCelebrated, minimiseTour, openTourStep, startTour, takeTour, tourState } from "@/server/actions/tour";
import { buttonClasses, IconButton } from "./button";
import { Icon } from "./icon";

/*
 * The tour guide (M6, Tour v2). Once the tour is started, a small guide sits at the bottom left of every app page:
 * "Tour · 2 of 5 · Next: Fix a blocker →". The text opens the five steps; the arrow goes straight to the next one.
 * It shrinks to a dot, says when a step is done, and ends with a finish card. It's never modal: it sits in the page's
 * own flow where it can (the side nav, the Parts pane), and in the bottom bar beside Help on a phone.
 */

type Guide = {
  tour: TourView | null;
  /** The tour can run here (a team workspace, not a Viewer): Take the tour is offered. */
  available: boolean;
  reload: () => Promise<void>;
  popoverOpen: boolean;
  setPopoverOpen: (open: boolean) => void;
  /** Take the tour (Resources, ⌘K): back on screen, with its steps open. */
  take: () => Promise<void>;
  /** Start the tour (Home's card), then go to the next step. */
  start: () => Promise<void>;
  setTour: (t: TourView | null) => void;
};

const GuideContext = createContext<Guide>({
  tour: null,
  available: false,
  reload: async () => {},
  popoverOpen: false,
  setPopoverOpen: () => {},
  take: async () => {},
  start: async () => {},
  setTour: () => {},
});

export const useTourGuide = () => useContext(GuideContext);

/** Holds the tour for the page, and keeps it fresh: after each page change, and every 8 seconds while it's on. */
export function TourProvider({ initial, available, children }: { initial: TourView | null; available: boolean; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [tour, setTour] = useState(initial);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const active = guideActive(tour);

  const reload = useCallback(async () => {
    try {
      setTour(await tourState());
    } catch {
      // Keep what's on screen; the next check tries again.
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    let stale = false;
    tourState()
      .then((t) => !stale && setTour(t))
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [pathname, active]);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => document.visibilityState === "visible" && void reload(), 8000);
    return () => window.clearInterval(id);
  }, [active, reload]);

  const value = useMemo<Guide>(
    () => ({
      tour,
      available,
      reload,
      popoverOpen,
      setPopoverOpen,
      setTour,
      take: async () => {
        const r = await takeTour();
        if (!r.ok) return;
        await reload();
        setPopoverOpen(true);
      },
      start: async () => {
        const r = await startTour();
        if (!r.ok) return;
        const fresh = await tourState();
        setTour(fresh);
        const next = fresh && nextStep(fresh.done);
        if (fresh && next) {
          void openTourStep(next);
          router.push(fresh.links[next]);
        }
        router.refresh();
      },
    }),
    [tour, available, reload, popoverOpen, router],
  );

  return (
    <GuideContext.Provider value={value}>
      {children}
      <TourHint />
      <FinishCard />
    </GuideContext.Provider>
  );
}

/** Where the guide sits: in the side nav or the Parts pane (in flow), a Parts rail (a dot), a page corner, or a phone's bottom bar. */
type Placement = "nav" | "pane" | "rail" | "corner" | "bar";

const WRAP: Record<Placement, string> = {
  nav: "relative pb-2 max-md:hidden",
  pane: "relative px-3 pt-1 pb-3 max-md:hidden",
  rail: "relative mt-auto pt-2 max-md:hidden",
  corner: "fixed bottom-3 left-4 z-40 max-w-[calc(100vw-84px)] md:bottom-4",
  bar: "fixed bottom-3 left-4 z-40 max-w-[calc(100vw-84px)] md:hidden",
};

/** Below 768px (Tailwind's md): the phone's bottom bar holds the guide instead of the side nav or Parts pane. */
const PHONE = "(width < 48rem)";
function usePhone(): boolean {
  return useSyncExternalStore(
    (on) => {
      const m = window.matchMedia(PHONE);
      m.addEventListener("change", on);
      return () => m.removeEventListener("change", on);
    },
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}

export function TourGuide({ placement }: { placement: Placement }) {
  const { tour, setTour, popoverOpen, setPopoverOpen } = useTourGuide();
  const [, start] = useTransition();
  const phone = usePhone();
  // Two guides can be on a page (one for wide screens, one for a phone), but only the shown one opens its steps.
  const shown = placement === "corner" || (placement === "bar") === phone;
  if (!guideActive(tour)) return null;
  const next = nextStep(tour.done);
  // After step 5, the finish card takes over.
  if (!next) return null;
  const count = `${tour.done.length} of ${TOUR_STEPS.length}`;
  const floating = placement === "corner" || placement === "bar";

  const steps = (
    <PopoverContent
      side="top"
      align="start"
      sideOffset={8}
      collisionPadding={12}
      className="w-[min(380px,calc(100vw-24px))] gap-0 rounded-card border border-line bg-surface p-0 text-body text-ink shadow-pop ring-0"
    >
      <TourSteps tour={tour} onGo={() => setPopoverOpen(false)} />
    </PopoverContent>
  );
  const dotClasses = cn(
    "grid size-9 place-items-center rounded-full border border-line-ctl bg-surface text-small font-semibold tabular-nums hover:bg-selected",
    floating && "shadow-pop",
  );

  // Minimised: a dot that opens back into the guide.
  if (tour.minimised) {
    return (
      <div className={WRAP[placement]}>
        <button
          type="button"
          aria-label={`Show the tour · ${count}`}
          title={`Tour · ${count}`}
          onClick={() => {
            setTour({ ...tour, minimised: false });
            start(async () => void (await expandTour()));
          }}
          className={dotClasses}
        >
          {tour.done.length}/{TOUR_STEPS.length}
        </button>
      </div>
    );
  }

  // The Parts rail is 56px wide: the guide is a dot there, opening the steps.
  if (placement === "rail") {
    return (
      <div className={WRAP[placement]}>
        <Popover open={popoverOpen && shown} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <button type="button" aria-label={`Tour · ${count} · Next: ${TOUR_COPY[next].title}. Show the steps`} title={`Tour · ${count}`} className={dotClasses}>
              {tour.done.length}/{TOUR_STEPS.length}
            </button>
          </PopoverTrigger>
          {steps}
        </Popover>
      </div>
    );
  }

  return (
    <div className={WRAP[placement]}>
      <StepDone tour={tour} placement={placement} />
      <div
        role="group"
        aria-label="Tour"
        className={cn(
          "flex items-center gap-0.5 border border-line-ctl bg-surface py-0.5 pr-0.5 pl-1",
          placement === "nav" ? "rounded-card" : "rounded-full",
          floating && "shadow-pop",
        )}
      >
        <Popover open={popoverOpen && shown} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Tour · ${count} · Next: ${TOUR_COPY[next].title}. Show the steps`}
              className={cn(
                "flex min-h-8 min-w-0 flex-1 items-center rounded-full px-2 text-left text-small hover:bg-selected",
                placement === "nav" && "flex-col items-start gap-0 rounded-tile py-1",
              )}
            >
              <span className="flex-none font-semibold tabular-nums">Tour · {count}</span>
              {placement !== "nav" && <span className="flex-none px-1 text-ink-3">·</span>}
              <span className="min-w-0 truncate text-ink-2">Next: {TOUR_COPY[next].title}</span>
            </button>
          </PopoverTrigger>
          {steps}
        </Popover>
        <Link
          href={tour.links[next]}
          onClick={() => void openTourStep(next)}
          aria-label={`Go to the next step: ${TOUR_COPY[next].title}`}
          title={`Next: ${TOUR_COPY[next].title}`}
          className="grid size-8 flex-none place-items-center rounded-full bg-primary text-on-primary hover:opacity-90"
        >
          <Icon name="arrowRight" size="sm" />
        </Link>
        <IconButton
          icon="minus"
          label="Minimise the tour"
          quiet
          size={32}
          onClick={() => {
            setTour({ ...tour, minimised: true });
            start(async () => void (await minimiseTour("guide")));
          }}
        />
      </div>
    </div>
  );
}

/** The five steps, in the guide's popover: done ones ticked, the next one with its action, and Don't show again. */
function TourSteps({ tour, onGo }: { tour: TourView; onGo: () => void }) {
  const { setTour } = useTourGuide();
  const [pending, start] = useTransition();
  const next = nextStep(tour.done);
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-0.5 px-4 pt-3.5 pb-1">
        <h2 className="text-body font-semibold">
          The tour · {tour.done.length} of {TOUR_STEPS.length}
        </h2>
        <p className="text-small text-ink-2">The whole story in five steps. Each one is done when you do it.</p>
      </div>
      <ol className="flex flex-col px-4">
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
                onClick={() => {
                  void openTourStep(s);
                  onGo();
                }}
                className={isNext ? buttonClasses({ size: "sm" }) : "min-h-6 flex-none text-small font-semibold text-ink underline decoration-line-ctl underline-offset-[3px]"}
              >
                {isNext ? TOUR_COPY[s].action : done ? "Again" : "Open"}
              </Link>
            </li>
          );
        })}
      </ol>
      <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2">
        <button
          type="button"
          aria-disabled={pending || undefined}
          onClick={() =>
            start(async () => {
              const r = await dismissTour();
              if (r.ok) {
                onGo();
                setTour(null);
              }
            })
          }
          className="min-h-6 text-small font-semibold text-ink-2 underline decoration-line-ctl underline-offset-[3px] hover:text-ink"
        >
          Don&apos;t show again
        </button>
        <span className="text-small text-ink-3">Resources or ⌘K bring it back</span>
      </div>
    </div>
  );
}

/** "Step 2 done · Next: fix a blocker", once per step, just above the guide. */
function StepDone({ tour, placement }: { tour: TourView; placement: Placement }) {
  const { setTour } = useTourGuide();
  const fresh = tour.done.filter((s) => !tour.celebrated.includes(s));
  const next = nextStep(tour.done);
  const last = [...fresh].sort((a, b) => TOUR_STEPS.indexOf(b) - TOUR_STEPS.indexOf(a))[0];
  const seen = () => {
    setTour({ ...tour, celebrated: tour.done });
    void markCelebrated(tour.done);
  };
  if (!last || !next) return null;
  return (
    <div
      role="status"
      className={cn(
        "absolute bottom-full left-0 mb-2 flex w-max max-w-[min(340px,calc(100vw-32px))] flex-col gap-2 rounded-card border border-line bg-surface p-3 shadow-pop",
        placement === "pane" && "left-3",
      )}
    >
      <div className="flex items-start gap-2">
        <Icon name="checkCircle" size="sm" className="mt-0.5 flex-none text-works" />
        <p className="min-w-0 flex-1 font-semibold">
          Step {TOUR_STEPS.indexOf(last) + 1} done · Next: {stepPhrase(next)}
        </p>
        <IconButton icon="close" label="Close" quiet size={32} className="-mt-1.5 -mr-1.5" onClick={seen} />
      </div>
      <Link
        href={tour.links[next]}
        onClick={() => {
          void openTourStep(next);
          seen();
        }}
        className={cn(buttonClasses({ size: "sm" }), "self-start")}
      >
        {TOUR_COPY[next].action}
      </Link>
    </div>
  );
}

/** After step 5: the whole story's been seen. Closing it, any way, ends the tour. */
function FinishCard() {
  const { tour, setTour } = useTourGuide();
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!guideActive(tour) || nextStep(tour.done)) return null;
  const finish = (how: "explore" | "reset" | "close", then?: () => void) =>
    start(async () => {
      const r = await finishTour(how);
      if (!r.ok) return;
      setTour(null);
      then?.();
    });
  const link = "inline-flex min-h-6 items-center gap-1 font-semibold underline decoration-line-ctl underline-offset-[3px] hover:decoration-ink";
  return (
    <section
      aria-labelledby="tour-finished"
      className="fixed bottom-[72px] left-4 z-50 flex w-[min(380px,calc(100vw-32px))] flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-pop md:bottom-4"
    >
      <div className="flex items-start gap-2">
        <Icon name="checkCircle" className="mt-0.5 flex-none text-works" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id="tour-finished" className="text-sub font-semibold">
            You&apos;ve seen the whole story
          </h2>
          <p className="text-ink-2">A plan before any build, a part proved by its check, a blocker fixed, an approved launch, and the audit log.</p>
        </div>
        <IconButton icon="close" label="Close the tour" quiet size={32} aria-disabled={pending || undefined} onClick={() => finish("close")} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-small">
        {VIDEO_URL ? (
          <a href={VIDEO_URL} target="_blank" rel="noreferrer" className={link}>
            Watch the video
            <Icon name="external" size="sm" className="text-ink-3" />
          </a>
        ) : (
          <span className="inline-flex min-h-6 items-center text-ink-3" title="The walkthrough video isn't published yet.">
            Video (soon)
          </span>
        )}
        <a href={README_URL} target="_blank" rel="noreferrer" className={link}>
          Read the README
          <Icon name="external" size="sm" className="text-ink-3" />
        </a>
        <a href={ARCHITECTURE_URL} target="_blank" rel="noreferrer" className={link}>
          See the architecture
          <Icon name="external" size="sm" className="text-ink-3" />
        </a>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-disabled={pending || undefined} onClick={() => finish("explore")} className={buttonClasses({ size: "sm" })}>
          Explore on your own
        </button>
        {tour.canResetDemo && (
          <button type="button" aria-disabled={pending || undefined} onClick={() => finish("reset", () => router.push("/settings/demo"))} className={buttonClasses({ size: "sm" })}>
            Reset demo data
          </button>
        )}
      </div>
    </section>
  );
}

const HINT: Partial<Record<TourStep, string>> = {
  build: "Click Build. Each part is built, then proved by its own check.",
  blocker: "Connect the app here, and the waiting part carries on.",
  launch: "Live waits for an Owner or Admin. You're the Owner: approve it here.",
  governance: "Everything that happened, who did it and when.",
};

/**
 * One hint per step, pointing at the exact control (marked data-tour-hint="<step>"). It goes once the step is done,
 * the control is clicked, or "Got it". Placed below the control, or above it near the bottom of the screen.
 */
function TourHint() {
  const { tour, setTour } = useTourGuide();
  const next = guideActive(tour) ? nextStep(tour.done) : null;
  const step = next && HINT[next] && !tour?.hints.includes(next) && !tour?.minimised ? next : null;
  const [box, setBox] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const [clicked, setClicked] = useState<TourStep | null>(null);

  useLayoutEffect(() => {
    if (!step || clicked === step) return;
    let el: Element | null = null;
    const onClick = () => setClicked(step);
    const place = () => {
      const found = document.querySelector(`[data-tour-hint="${step}"]`);
      if (found !== el) {
        el?.removeEventListener("click", onClick);
        el = found;
        el?.addEventListener("click", onClick);
      }
      const r = el?.getBoundingClientRect();
      if (!r || !r.width || r.bottom < 0 || r.top > window.innerHeight) return setBox(null);
      const above = r.bottom + 120 > window.innerHeight;
      const left = Math.max(12, Math.min(r.left, window.innerWidth - 292));
      setBox({ top: above ? r.top - 8 : r.bottom + 8, left, above });
    };
    place();
    const id = window.setInterval(place, 700);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      el?.removeEventListener("click", onClick);
    };
  }, [step, clicked]);

  if (!step || clicked === step || !box || !tour) return null;
  return (
    <div
      role="note"
      aria-label={`Tour hint: ${TOUR_COPY[step].title}`}
      style={{ top: box.top, left: box.left, transform: box.above ? "translateY(-100%)" : undefined }}
      className="fixed z-40 flex w-[280px] flex-col gap-2 rounded-card bg-primary p-3 text-small text-on-primary shadow-pop"
    >
      <span className="font-semibold">
        Step {TOUR_STEPS.indexOf(step) + 1} · {TOUR_COPY[step].title}
      </span>
      <span>{HINT[step]}</span>
      <button
        type="button"
        onClick={() => {
          setTour({ ...tour, hints: [...tour.hints, step] });
          void closeHint(step, tour.hints);
        }}
        className="min-h-6 self-end font-semibold underline underline-offset-[3px]"
      >
        Got it
      </button>
    </div>
  );
}
