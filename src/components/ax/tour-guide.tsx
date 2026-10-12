"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { create } from "zustand";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ARCHITECTURE_URL, README_URL, VIDEO_URL } from "@/lib/links";
import { guideActive, nextStep, TOUR_COPY, TOUR_CUE, TOUR_STEPS, type TourLive, type TourStep, type TourView } from "@/lib/tour";
import { cn } from "@/lib/utils";
import { closeHint, dismissTour, expandTour, finishTour, markCelebrated, minimiseTour, openTourStep, startTour, takeTour, tourState } from "@/server/actions/tour";
import { buttonClasses, IconButton } from "./button";
import { Icon } from "./icon";

/*
 * The tour (M6, Tour v3). Once started, one coach card stays in one place, bottom left (a bottom sheet on a phone):
 * "Step 2 of 5 · Build it", one line on why, and the action. A hint points at the control for every step; when the
 * control is off screen the card offers "Show me". The card follows a running build ("Building · 3 of 5 parts work"),
 * moves on by itself when a step's event lands (with a short "Done ✓"), and only × minimises it.
 *
 * The state lives in a client store that outlives page changes, so moving between pages never makes the card flash:
 * each page's provider only refreshes it, and loading screens render the same card from the store.
 */

type Store = {
  tour: TourView | null;
  available: boolean;
  /** The project build the Parts pane shows, published by the project workspace. */
  live: TourLive | null;
  /** A step just done: the card shows "Done ✓" for it until `until`, then moves on. Any card, on any page, ends it on time. */
  doneFlash: { step: TourStep; until: number } | null;
  stepsOpen: boolean;
  /** A page's provider has handed over the server's copy. Until then the card shows that copy directly. */
  seeded: boolean;
};

export const useTourStore = create<Store>(() => ({ tour: null, available: false, live: null, doneFlash: null, stepsOpen: false, seeded: false }));

/** The tour as the card shows it: the store once seeded, else the page's server copy (so the first paint has it). */
function useShownTour(initial: TourView | null): TourView | null {
  const seeded = useTourStore((s) => s.seeded);
  const tour = useTourStore((s) => s.tour);
  return seeded ? tour : initial;
}

const setTour = (tour: TourView | null) => useTourStore.setState({ tour });

/** Steps whose "Done ✓" this tab has shown, so a slow save never shows one twice. */
const flashed = new Set<TourStep>();

/** The project workspace reports its build here, so the card can show it. */
export function publishTourLive(live: TourLive | null) {
  const prev = useTourStore.getState().live;
  if (JSON.stringify(prev) !== JSON.stringify(live)) useTourStore.setState({ live });
}

async function refresh() {
  try {
    setTour(await tourState());
  } catch {
    // Keep what's on screen; the next check tries again.
  }
}

type Guide = {
  tour: TourView | null;
  available: boolean;
  reload: () => Promise<void>;
  /** Take the tour (Resources, ⌘K): back on screen, with its steps open. */
  take: () => Promise<void>;
  /** Start the tour (Home's card), then go to the next step. */
  start: () => Promise<void>;
  setTour: (t: TourView | null) => void;
};

const GuideContext = createContext<{ start: () => Promise<void> }>({ start: async () => {} });

export function useTourGuide(): Guide {
  const tour = useTourStore((s) => s.tour);
  const available = useTourStore((s) => s.available);
  const { start } = useContext(GuideContext);
  return useMemo(
    () => ({
      tour,
      available,
      reload: refresh,
      setTour,
      start,
      take: async () => {
        const r = await takeTour();
        if (!r.ok) return;
        await refresh();
        useTourStore.setState({ stepsOpen: true });
      },
    }),
    [tour, available, start],
  );
}

/**
 * Refreshes the tour for the page: from the server's copy when the page opens, after each page change, every 3 seconds while
 * it's on, and as soon as a build starts, a part waits or a build ends.
 */
export function TourProvider({ initial, available, children }: { initial: TourView | null; available: boolean; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // The server's copy is the freshest when the page opens; hand it over before the first paint.
  useLayoutEffect(() => {
    useTourStore.setState({ tour: initial, available, seeded: true });
  }, [initial, available]);
  const tour = useShownTour(initial);
  const live = useTourStore((s) => s.live);
  const active = guideActive(tour);

  useEffect(() => {
    if (!active) return;
    void refresh();
  }, [pathname, active, live?.running, live?.waiting]);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => document.visibilityState === "visible" && void refresh(), 3000);
    return () => window.clearInterval(id);
  }, [active]);

  const start = useCallback(async () => {
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
  }, [router]);

  return <GuideContext.Provider value={useMemo(() => ({ start }), [start])}>{children}</GuideContext.Provider>;
}

/** The control a step points at ([data-tour-hint]), and whether it's on screen. Checked as the page changes. */
function useTarget(step: TourStep | null) {
  // `settled`: found, or still missing a second after the page arrived (so a page that's still drawing doesn't flash "Show me").
  const [state, setState] = useState<{ found: boolean; visible: boolean; settled: boolean }>({ found: false, visible: false, settled: false });
  const pathname = usePathname();
  useEffect(() => {
    if (!step) return;
    const since = Date.now();
    const check = () => {
      const el = [...document.querySelectorAll(`[data-tour-hint="${step}"]`)].find((e) => e.getBoundingClientRect().width > 0);
      const r = el?.getBoundingClientRect();
      const found = Boolean(el && r);
      const coach = document.querySelector("[data-coach]")?.getBoundingClientRect();
      const underCoach = Boolean(r && coach && r.left < coach.right && r.right > coach.left && r.top < coach.bottom && r.bottom > coach.top);
      const visible = Boolean(found && r && r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth && !underCoach);
      const settled = found || Date.now() - since > 1000;
      setState((s) => (s.found === found && s.visible === visible && s.settled === settled ? s : { found, visible, settled }));
    };
    check();
    const id = window.setInterval(check, 400);
    window.addEventListener("scroll", check, true);
    window.addEventListener("resize", check);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("scroll", check, true);
      window.removeEventListener("resize", check);
    };
  }, [step, pathname]);
  return step ? state : { found: false, visible: false, settled: false };
}

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** "Show me": the page opens the pane that holds the control (it listens for tour:reveal), then the control scrolls into view. */
function revealTarget(step: TourStep) {
  window.dispatchEvent(new CustomEvent("tour:reveal", { detail: step }));
  window.setTimeout(() => {
    document.querySelector(`[data-tour-hint="${step}"]`)?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center", inline: "nearest" });
  }, 320);
}

/** A number that counts up a step at a time when it grows ("3 of 5 parts work"). */
function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (shown === value) return;
    const id = window.setTimeout(() => setShown((n) => (n < value ? n + 1 : value)), prefersReducedMotion() ? 0 : 60);
    return () => window.clearTimeout(id);
  }, [shown, value]);
  return (
    <span key={shown} className="inline-block ax-rise-in tabular-nums">
      {shown}
    </span>
  );
}

/**
 * Text that changes in place: the old text fades out and up while the new one fades in from below. Nothing animates on
 * the first render, so a page change with the same step shows no movement at all.
 */
function Swap({ id, children }: { id: string; children: ReactNode }) {
  const [layers, setLayers] = useState<{ id: string; node: ReactNode; leaving: boolean; fresh: boolean }[]>([{ id, node: children, leaving: false, fresh: false }]);
  const current = layers[layers.length - 1];
  if (current.id !== id) {
    setLayers([...layers.filter((l) => !l.leaving).map((l) => ({ ...l, leaving: true })), { id, node: children, leaving: false, fresh: true }]);
  } else if (current.node !== children) {
    setLayers(layers.map((l, i) => (i === layers.length - 1 ? { ...l, node: children } : l)));
  }
  useEffect(() => {
    if (!layers.some((l) => l.leaving)) return;
    const t = window.setTimeout(() => setLayers((ls) => ls.filter((l) => !l.leaving)), 230);
    return () => window.clearTimeout(t);
  }, [layers]);
  return (
    <div className="relative">
      {layers.map((l) => (
        <div key={l.id} aria-hidden={l.leaving || undefined} className={cn(l.leaving ? "pointer-events-none absolute inset-x-0 top-0 ax-rise-out" : l.fresh && "ax-rise-in")}>
          {l.node}
        </div>
      ))}
    </div>
  );
}

/** Five dots: done ones filled, the current one wider. Only opacity and transform change. */
function Dots({ done, current }: { done: TourStep[]; current: TourStep | null }) {
  return (
    <span aria-hidden="true" className="flex items-center gap-1">
      {TOUR_STEPS.map((s) => (
        <span key={s} className="relative block size-1.5">
          <span className="absolute inset-0 rounded-full bg-line-ctl/40" />
          <span
            className="absolute inset-0 rounded-full bg-works transition-[opacity,transform] duration-(--motion-base) ease-(--ease-out)"
            style={{ opacity: done.includes(s) ? 1 : s === current ? 1 : 0, transform: s === current && !done.includes(s) ? "scale(1.35)" : "scale(1)", background: s === current && !done.includes(s) ? "var(--ink)" : undefined }}
          />
        </span>
      ))}
    </span>
  );
}

/**
 * The coach card. `inset` is where bottom-left is on this page: past the side nav on app pages, the page's edge on a
 * project or a settings page. On a phone it's a bottom sheet above the Help bar.
 */
export function CoachCard({ inset = "edge", initial = null }: { inset?: "nav" | "edge"; initial?: TourView | null }) {
  const tour = useShownTour(initial);
  const live = useTourStore((s) => s.live);
  const flash = useTourStore((s) => s.doneFlash);
  const doneFlash = flash?.step ?? null;
  const stepsOpen = useTourStore((s) => s.stepsOpen);
  const pathname = usePathname();
  const router = useRouter();
  const [, start] = useTransition();
  const card = useRef<HTMLElement>(null);
  const active = guideActive(tour);
  const next = active ? nextStep(tour.done) : null;
  const target = useTarget(active && !tour.minimised ? next : null);

  // A step that's newly done shows "Done ✓" for about 1.2 seconds, then the card moves on (saved, so it shows once).
  const fresh = active ? tour.done.filter((s) => !tour.celebrated.includes(s)) : [];
  const justDone = fresh.length ? [...fresh].sort((a, b) => TOUR_STEPS.indexOf(b) - TOUR_STEPS.indexOf(a))[0] : null;
  useEffect(() => {
    const current = useTourStore.getState().tour;
    if (!justDone || !current || flashed.has(justDone)) return;
    flashed.add(justDone);
    // Counted as seen straight away, here and on the server, so the same step never flashes twice.
    useTourStore.setState({ doneFlash: { step: justDone, until: Date.now() + 1200 }, tour: { ...current, celebrated: [...new Set([...current.celebrated, ...current.done])] } });
    void markCelebrated(current.done);
  }, [justDone]);
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => useTourStore.setState({ doneFlash: null }), Math.max(0, flash.until - Date.now()));
    return () => window.clearTimeout(t);
  }, [flash]);

  // Its height, for the room pages leave at their end (globals.css), so the card never hides their last controls.
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty("--coach-h", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  });

  if (!active) return null;
  const count = tour.done.length;
  const place = cn(
    "fixed z-40 max-md:inset-x-0 max-md:bottom-[60px] max-md:rounded-b-none md:bottom-4 md:w-[360px]",
    inset === "nav" ? "md:left-[284px]" : "md:left-4",
  );

  if (tour.minimised) {
    return (
      <div data-coach className={cn(place, "max-md:inset-x-auto max-md:bottom-3 max-md:left-4 md:w-auto")}>
        <button
          type="button"
          aria-label={`Show the tour · ${count} of ${TOUR_STEPS.length}`}
          onClick={() => {
            setTour({ ...tour, minimised: false });
            start(async () => void (await expandTour()));
          }}
          className="ax-fade-in flex min-h-9 items-center gap-2 rounded-full border border-line-ctl bg-surface px-3.5 text-small font-semibold shadow-pop hover:bg-selected"
        >
          Tour · {count} of {TOUR_STEPS.length}
          <Dots done={tour.done} current={next} />
        </button>
      </div>
    );
  }

  const shown = doneFlash ?? next;
  const building = live && live.running && live.projectId && pathname.startsWith(`/p/${live.projectId}`);
  const onStepPage = next ? pathname === tour.links[next].split("?")[0] : false;
  const minimise = () => {
    setTour({ ...tour, minimised: true });
    start(async () => void (await minimiseTour("guide")));
  };

  let body: ReactNode;
  let swapKey: string;
  if (!next && !doneFlash) {
    swapKey = "finish";
    body = <Finish tour={tour} onDone={() => router.refresh()} />;
  } else if (doneFlash) {
    swapKey = `done-${doneFlash}`;
    body = (
      <div className="flex items-center gap-2 py-3">
        <span className="grid size-7 place-items-center rounded-full bg-works-bg text-works">
          <Icon name="check" size="sm" className="ax-tick" />
        </span>
        <span className="text-sub font-semibold">Done ✓</span>
        <span className="text-ink-2">{TOUR_COPY[doneFlash].title}</span>
      </div>
    );
  } else {
    const s = next!;
    swapKey = s;
    const waitingForBlocker = s === "blocker" && building && !target.found;
    body = (
      <div className="flex flex-col gap-2">
        <p className="text-ink-2">{TOUR_COPY[s].line}</p>
        {building && (
          <p role="status" className="flex items-center gap-2 font-semibold">
            <span className="size-2 rounded-full bg-building" aria-hidden="true" />
            Building · <CountUp value={live!.works} /> of {live!.total} parts work
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {s === "plan" && pathname.startsWith("/p/") ? (
            // The plan is being written on its project page: nothing to click, the card moves on when it's ready.
            <span role="status" className="inline-flex min-h-8 items-center gap-2 font-semibold">
              <span className="size-2 rounded-full bg-building" aria-hidden="true" />
              Writing the plan…
            </span>
          ) : !target.settled ? (
            // Holding the line's place while the page draws the control.
            <span aria-hidden="true" className="invisible inline-flex min-h-8 items-center">
              {TOUR_CUE[s].click}
            </span>
          ) : waitingForBlocker ? (
            <span className="text-small text-ink-2">When a part waits for an app, this points at its Connect button.</span>
          ) : target.visible ? (
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <Icon name="pointer" size="sm" />
              {TOUR_CUE[s].click}
            </span>
          ) : target.found || (onStepPage && s !== "blocker") ? (
            <>
              <span className="text-small text-ink-2">It&apos;s off screen.</span>
              <button type="button" onClick={() => revealTarget(s)} className={buttonClasses({ size: "sm", variant: "primary" })}>
                Show me
              </button>
            </>
          ) : (
            <Link href={tour.links[s]} onClick={() => void openTourStep(s)} className={buttonClasses({ size: "sm", variant: "primary" })}>
              {TOUR_COPY[s].action}
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <section
      ref={card}
      data-coach
      aria-label="Tour"
      className={cn(place, "flex flex-col gap-1.5 rounded-card border border-line bg-surface px-4 pt-3 pb-3.5 shadow-pop max-md:border-x-0 max-md:border-b-0")}
    >
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 font-semibold">
          <Swap id={swapKey === "finish" ? "finish" : `h-${shown}`}>
            <span className="block text-balance">{shown ? `Step ${TOUR_STEPS.indexOf(shown) + 1} of ${TOUR_STEPS.length} · ${TOUR_COPY[shown].title}` : "The tour"}</span>
          </Swap>
        </h2>
        <Dots done={tour.done} current={next} />
        <Popover open={stepsOpen} onOpenChange={(o) => useTourStore.setState({ stepsOpen: o })}>
          <PopoverTrigger asChild>
            <IconButton icon="lines" label="All steps" quiet size={32} />
          </PopoverTrigger>
          <PopoverContent side="top" align="end" sideOffset={8} collisionPadding={12} className="w-[min(380px,calc(100vw-24px))] gap-0 rounded-card border border-line bg-surface p-0 text-body text-ink shadow-pop ring-0">
            <TourSteps tour={tour} onGo={() => useTourStore.setState({ stepsOpen: false })} />
          </PopoverContent>
        </Popover>
        <IconButton icon="close" label="Minimise the tour" quiet size={32} onClick={minimise} />
      </div>
      <Swap id={swapKey}>{body}</Swap>
      {/* Opening the audit log is step 5 itself, so its hint stays through "Done ✓" and the finish. */}
      <TourHint step={doneFlash === "governance" || !next ? "governance" : !doneFlash ? next : null} card={card} />
    </section>
  );
}

/** The five steps, from the card's "All steps": done ones ticked, the next one with its action, and Don't show again. */
function TourSteps({ tour, onGo }: { tour: TourView; onGo: () => void }) {
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

/** After step 5, in the card itself: the whole story's been seen. Closing it, any way, ends the tour. */
function Finish({ tour, onDone }: { tour: TourView; onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const finish = (how: "explore" | "reset" | "close", then?: () => void) =>
    start(async () => {
      const r = await finishTour(how);
      if (!r.ok) return;
      setTour(null);
      then?.();
      onDone();
    });
  const link = "inline-flex min-h-6 items-center gap-1 font-semibold underline decoration-line-ctl underline-offset-[3px] hover:decoration-ink";
  return (
    <section aria-labelledby="tour-finished" className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <Icon name="checkCircle" className="mt-0.5 flex-none text-works" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 id="tour-finished" className="text-sub font-semibold">
            You&apos;ve seen the whole story
          </h3>
          <p className="text-ink-2">A plan before any build, a part proved by its check, a blocker fixed, an approved launch, and the audit log.</p>
        </div>
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
        <button type="button" aria-disabled={pending || undefined} onClick={() => finish("close")} className="min-h-8 px-2 text-small font-semibold text-ink-2 hover:text-ink">
          Close the tour
        </button>
      </div>
    </section>
  );
}

type Rect = { top: number; left: number; right: number; bottom: number };
const overlaps = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * The hint for the current step, beside its control: it fades and scales in, the control gets two soft pulses, and the
 * hint glides when the control moves. It stays inside the screen and off the coach card, the side nav and the control.
 * It goes once the control is clicked or "Got it"; the step being done moves it to the next step's control.
 */
function TourHint({ step, card }: { step: TourStep | null; card: React.RefObject<HTMLElement | null> }) {
  const tour = useTourStore((s) => s.tour);
  const [pos, setPos] = useState<{ x: number; y: number; ring: Rect } | null>(null);
  const [clicked, setClicked] = useState<TourStep | null>(null);
  const [pulseKey, setPulseKey] = useState(0);
  const hint = useRef<HTMLDivElement>(null);
  const on = Boolean(step && tour && !tour.hints.includes(step) && clicked !== step);

  useEffect(() => {
    if (!on || !step) return;
    let el: Element | null = null;
    const onClick = () => setClicked(step);
    const place = () => {
      const found = [...document.querySelectorAll(`[data-tour-hint="${step}"]`)].find((e) => e.getBoundingClientRect().width > 0) ?? null;
      if (found !== el) {
        el?.removeEventListener("click", onClick);
        el = found;
        el?.addEventListener("click", onClick);
        if (found) setPulseKey((k) => k + 1);
      }
      const r = el?.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (!r || !r.width || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return setPos(null);
      const w = hint.current?.offsetWidth ?? 280;
      const h = hint.current?.offsetHeight ?? 110;
      const avoid: Rect[] = [card.current?.getBoundingClientRect(), document.querySelector('nav[aria-label="Workspace"]')?.getBoundingClientRect()].filter((x): x is DOMRect => Boolean(x && x.width));
      const clampX = (x: number) => Math.max(12, Math.min(x, vw - w - 12));
      const clampY = (y: number) => Math.max(12, Math.min(y, vh - h - 12));
      const options = [
        { x: clampX(r.left), y: r.bottom + 10 },
        { x: clampX(r.left), y: r.top - h - 10 },
        { x: r.right + 10, y: clampY(r.top) },
        { x: r.left - w - 10, y: clampY(r.top) },
      ];
      const fits = (o: { x: number; y: number }) => {
        const box = { left: o.x, top: o.y, right: o.x + w, bottom: o.y + h };
        return box.left >= 8 && box.top >= 8 && box.right <= vw - 8 && box.bottom <= vh - 8 && !avoid.some((a) => overlaps(box, a)) && !overlaps(box, r);
      };
      // Nowhere clear of the card, the nav and the control (or the control is under the card): no hint rather than one
      // that covers something. The card's "Show me" brings the control into view.
      const best = options.find(fits);
      if (!best || avoid.some((a) => overlaps(r, a))) return setPos(null);
      setPos({ x: best.x, y: best.y, ring: { top: r.top, left: r.left, right: r.right, bottom: r.bottom } });
    };
    place();
    const id = window.setInterval(place, 300);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      el?.removeEventListener("click", onClick);
    };
  }, [on, step, card]);

  if (!on || !step || !pos || !tour) return null;
  const pad = 4;
  return (
    <>
      <span
        key={`ring-${step}-${pulseKey}`}
        aria-hidden="true"
        className="ax-pulse pointer-events-none fixed z-40 rounded-full border-2 border-focus"
        style={{ left: pos.ring.left - pad, top: pos.ring.top - pad, width: pos.ring.right - pos.ring.left + pad * 2, height: pos.ring.bottom - pos.ring.top + pad * 2 }}
      />
      <div ref={hint} role="note" aria-label={`Tour hint: ${TOUR_COPY[step].title}`} className="ax-glide fixed top-0 left-0 z-40" style={{ transform: `translate3d(${pos.x}px, ${pos.y}px, 0)` }}>
        <div key={step} className="ax-pop-in flex w-[280px] flex-col gap-2 rounded-card bg-primary p-3 text-small text-on-primary shadow-pop">
          <span className="font-semibold">
            Step {TOUR_STEPS.indexOf(step) + 1} · {TOUR_COPY[step].title}
          </span>
          <span>{TOUR_CUE[step].hint}</span>
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
      </div>
    </>
  );
}
