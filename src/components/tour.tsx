/*
 * Adapted from NiazMorshed2007/shadcn-tour (https://github.com/NiazMorshed2007/shadcn-tour), used under the MIT License:
 *
 * MIT License
 *
 * Copyright (c) 2025 Niaz Morshed
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * What we changed (round 7): Next can run an action first and wait for its result (onNext), with a visible click on the
 * real control; steps can change pages and wait for their target; targets are data-tour attributes; tours are chapters
 * run one after another ("Chapter 2 of 3 · step 3 of 9", Skip this chapter, Skip tour); each step is reported as it
 * shows so it can be saved; focus stays inside the card; motion uses our tokens (ease-out, 150–300 ms) and reduced
 * motion keeps only the fades; our icons replace lucide-react; the page stays usable under the spotlight.
 */
"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/ax/icon";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type TourStepDef = {
  id: string;
  /** The data-tour value to spotlight. None: the card sits at the bottom of the screen, with no spotlight. */
  target?: string;
  /** The page this step is on (path and query). The tour goes there first, then waits for the target. */
  page?: string;
  title: string;
  content: ReactNode;
  /** The Next button's words. Steps that spend credits or change something name the action ("Build it"). */
  nextLabel?: string;
  /** Runs when Next is clicked, before the tour moves on. Return false to stay on this step. */
  onNext?: (api: TourApi) => Promise<boolean | void> | boolean | void;
  /** New in Architect 2.0: a small icon with a tooltip. */
  newIn2?: boolean;
  position?: "top" | "bottom" | "left" | "right";
  /** The step number shown, when two cards make one step (chapter 2: the nav item, then its page). */
  count?: number;
  /** How long to wait for the target before showing the card without a spotlight (ms). */
  waitMs?: number;
};

export type TourChapterDef = { id: string; title: string; steps: TourStepDef[] };

export type TourApi = {
  /** Moves a pointer to the control, shows the click, then clicks it. */
  click: (target: string, opts?: { timeout?: number }) => Promise<void>;
  /** Waits until the check passes; throws when the time runs out. */
  waitFor: (check: () => boolean, timeout?: number, what?: string) => Promise<void>;
  /** Clicks an element the step found itself (the same visible pointer and press). */
  clickElement: (el: HTMLElement) => Promise<void>;
  /** The element for a data-tour value, if it's on the page and showing. */
  find: (target: string) => HTMLElement | null;
  go: (href: string) => void;
};

type Box = { top: number; left: number; width: number; height: number };

type TourContext = {
  active: boolean;
  start: (at?: { chapter?: string; step?: string }) => void;
  stop: () => void;
};

const Ctx = createContext<TourContext>({ active: false, start: () => {}, stop: () => {} });
export const useTour = () => useContext(Ctx);

const EASE = [0.2, 0, 0, 1] as const;
const GAP = 14;

/**
 * A visible element for a data-tour value (the first one with a size, so hidden copies are skipped). "css:…" takes a
 * selector instead, for lists drawn by shared components that don't carry attributes (the Projects list, Policies).
 */
export function findTarget(target: string): HTMLElement | null {
  const selector = target.startsWith("css:") ? target.slice(4) : `[data-tour="${target}"]`;
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

async function waitFor(check: () => boolean, timeout = 15_000, what = "The page") {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (check()) return;
    await sleep(150);
  }
  throw new Error(`${what} didn't appear in time`);
}

/** Where the card goes: the preferred side if it fits without covering the target, else another side, inside the screen. */
function placeCard(el: Box, prefer: TourStepDef["position"], size: { width: number; height: number }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const sides = [prefer ?? "bottom", "bottom", "top", "right", "left"] as const;
  const clampX = (x: number) => Math.max(GAP, Math.min(x, vw - size.width - GAP));
  const clampY = (y: number) => Math.max(GAP, Math.min(y, vh - size.height - GAP));
  const alignX = el.left + el.width / 2 > vw / 2 ? el.left + el.width - size.width : el.left;
  for (const side of sides) {
    const p =
      side === "bottom"
        ? { left: clampX(alignX), top: el.top + el.height + GAP }
        : side === "top"
          ? { left: clampX(alignX), top: el.top - GAP - size.height }
          : side === "right"
            ? { left: el.left + el.width + GAP, top: clampY(el.top + el.height / 2 - size.height / 2) }
            : { left: el.left - GAP - size.width, top: clampY(el.top + el.height / 2 - size.height / 2) };
    const inside = p.left >= GAP && p.top >= GAP && p.left + size.width <= vw - GAP && p.top + size.height <= vh - GAP;
    const covers = p.left < el.left + el.width && p.left + size.width > el.left && p.top < el.top + el.height && p.top + size.height > el.top;
    if (inside && !covers) return p;
  }
  // Nowhere clear: the bottom-left corner, away from the main action at the top right.
  return { left: GAP, top: vh - size.height - GAP };
}

function locate(chapters: TourChapterDef[], at: { chapter: string; step: string } | null | undefined): { c: number; s: number } | null {
  if (!at) return null;
  const c = Math.max(0, chapters.findIndex((ch) => ch.id === at.chapter));
  const s = chapters[c]?.steps.findIndex((st) => st.id === at.step) ?? -1;
  return { c, s: s >= 0 ? s : 0 };
}

export function TourEngine({
  chapters,
  initial,
  onStep,
  onSkip,
  onFinish,
  onMove,
  children,
}: {
  chapters: TourChapterDef[];
  /** Resume here (a reload mid-tour). */
  initial: { chapter: string; step: string } | null;
  /** Each step as it shows: save it. */
  onStep: (chapter: string, step: string) => void;
  /** Skip tour, from this step. */
  onSkip: (chapter: string, step: string) => void;
  /** Past the last step. */
  onFinish: () => void;
  /** Every move (Next, Back, Skip this chapter), before the step's page opens: keep it, so a page change resumes there. */
  onMove?: (chapter: string, step: string) => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const [at, setAt] = useState<{ c: number; s: number } | null>(() => locate(chapters, initial));
  const [pos, setPos] = useState<Box | null>(null);
  const [ready, setReady] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ from: { x: number; y: number }; to: { x: number; y: number }; key: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 380, height: 220 });
  const [phone, setPhone] = useState(false);
  const pathRef = useRef(pathname);
  const stepRef = useRef({ onStep });
  useLayoutEffect(() => {
    pathRef.current = pathname;
    stepRef.current = { onStep };
  });

  const chapter = at ? chapters[at.c] : null;
  const step = chapter && at ? chapter.steps[at.s] : null;

  useEffect(() => {
    const m = window.matchMedia("(width < 48rem)");
    const on = () => setPhone(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);

  // Each step: go to its page, wait for its target, then show it. It's reported (saved) as it shows.
  const stepKey = at ? `${at.c}:${at.s}` : null;
  useEffect(() => {
    if (!at) return;
    const ch = chapters[at.c];
    const st = ch?.steps[at.s];
    if (!st) return;
    let stale = false;
    const path = st.page?.split("?")[0];
    (async () => {
      // Go to the step's page: a different path, or the same path without the step's query (Home's ?tour=plan).
      const query = st.page?.split("?")[1];
      if (st.page && (pathRef.current !== path || (query && !window.location.search.includes(query)))) router.push(st.page);
      // First the page (a slow page still arrives), then the control on it (waitMs: some only appear later, or not at all).
      if (path) await waitFor(() => window.location.pathname === path && (!query || window.location.search.includes(query)), 30_000).catch(() => {});
      if (st.target) await waitFor(() => Boolean(findTarget(st.target!)), st.waitMs ?? 15_000).catch(() => {});
      if (stale) return;
      const el = st.target ? findTarget(st.target) : null;
      const r = el?.getBoundingClientRect();
      if (el && r && (r.top < 0 || r.bottom > window.innerHeight)) el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
      setError(null);
      setReady(true);
      stepRef.current.onStep(ch.id, st.id);
    })();
    return () => {
      stale = true;
      setReady(false);
    };
  }, [stepKey, at, chapters, router, reduce]);

  // Follow the target as the page scrolls, resizes or redraws.
  useEffect(() => {
    if (!step?.target || !ready) return;
    let raf = 0;
    const target = step.target;
    const update = () => {
      const r = findTarget(target)?.getBoundingClientRect();
      setPos((p) => {
        if (!r) return p === null ? p : null;
        const n = { top: r.top, left: r.left, width: r.width, height: r.height };
        return p && Math.abs(p.top - n.top) < 0.5 && Math.abs(p.left - n.left) < 0.5 && Math.abs(p.width - n.width) < 0.5 && Math.abs(p.height - n.height) < 0.5 ? p : n;
      });
      raf = window.requestAnimationFrame(update);
    };
    update();
    return () => window.cancelAnimationFrame(raf);
  }, [step, ready]);

  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize((s) => (s.width === el.offsetWidth && s.height === el.offsetHeight ? s : { width: el.offsetWidth, height: el.offsetHeight })));
    ro.observe(el);
    return () => ro.disconnect();
  });

  // Focus moves into the card at each step: Tab cycles its controls, and the arrow keys step while it has focus.
  useEffect(() => {
    if (!ready || acting) return;
    card.current?.querySelector<HTMLElement>("[data-tour-next]")?.focus({ preventScroll: true });
  }, [ready, acting, stepKey]);

  // The visible click: scroll the control into view, move a pointer from the card to it, press, then click it.
  const press = useCallback(
    async (el: HTMLElement) => {
      const r0 = el.getBoundingClientRect();
      if (r0.top < 0 || r0.bottom > window.innerHeight) {
        el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
        await sleep(reduce ? 0 : 320);
      }
      const r = el.getBoundingClientRect();
      const c = card.current?.getBoundingClientRect();
      const from = c ? { x: c.left + c.width - 60, y: c.top + c.height - 40 } : { x: r.left, y: r.top };
      const to = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      setPointer({ from, to, key: Date.now() });
      await sleep(reduce ? 120 : 560);
      el.click();
      await sleep(200);
      setPointer(null);
    },
    [reduce],
  );

  const api = useMemo<TourApi>(
    () => ({
      find: findTarget,
      go: (href) => router.push(href),
      waitFor,
      click: async (target, opts) => {
        await waitFor(() => Boolean(findTarget(target)), opts?.timeout ?? 15_000, "The control");
        await press(findTarget(target)!);
      },
      clickElement: press,
    }),
    [router, press],
  );

  const goTo = useCallback(
    (c: number, s: number) => {
      setPos(null);
      setAt({ c, s });
      const st = chapters[c]?.steps[s];
      if (st) onMove?.(chapters[c].id, st.id);
    },
    [chapters, onMove],
  );

  const next = useCallback(async () => {
    if (!at || !step || acting) return;
    setError(null);
    if (step.onNext) {
      setActing(true);
      try {
        const r = await step.onNext(api);
        if (r === false) return;
      } catch (e) {
        setError(`${e instanceof Error ? e.message : "That didn't work"}. Next tries again.`);
        return;
      } finally {
        setActing(false);
      }
    }
    const ch = chapters[at.c];
    if (at.s < ch.steps.length - 1) goTo(at.c, at.s + 1);
    else if (at.c < chapters.length - 1) goTo(at.c + 1, 0);
    else {
      setAt(null);
      onFinish();
    }
  }, [at, step, acting, api, chapters, goTo, onFinish]);

  const back = useCallback(() => {
    if (!at || acting) return;
    if (at.s > 0) goTo(at.c, at.s - 1);
    else if (at.c > 0) goTo(at.c - 1, chapters[at.c - 1].steps.length - 1);
  }, [at, acting, chapters, goTo]);

  const skipChapter = useCallback(() => {
    if (!at) return;
    if (at.c < chapters.length - 1) goTo(at.c + 1, 0);
    else {
      setAt(null);
      onFinish();
    }
  }, [at, chapters.length, goTo, onFinish]);

  const skipTour = useCallback(() => {
    if (!chapter || !step) return;
    onSkip(chapter.id, step.id);
    setAt(null);
  }, [chapter, step, onSkip]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") void next();
    else if (e.key === "ArrowLeft") back();
    else if (e.key === "Tab") {
      // Focus stays inside the card.
      const items = [...(card.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex='0']") ?? [])];
      if (!items.length) return;
      const i = items.indexOf(document.activeElement as HTMLElement);
      const n = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
      e.preventDefault();
      items[n].focus();
    }
  };

  const ctx = useMemo<TourContext>(
    () => ({
      active: Boolean(at),
      start: (where) => goTo(...((): [number, number] => {
        const l = locate(chapters, { chapter: where?.chapter ?? chapters[0].id, step: where?.step ?? chapters[0].steps[0].id });
        return l ? [l.c, l.s] : [0, 0];
      })()),
      stop: () => setAt(null),
    }),
    [at, chapters, goTo],
  );

  // Shown count: "step 3 of 9" (two cards can share a number in chapter 2).
  const counts = chapter ? [...new Set(chapter.steps.map((s, i) => s.count ?? i + 1))] : [];
  const shownCount = step && at ? counts.indexOf(step.count ?? at.s + 1) + 1 : 0;
  const spot = step?.target ? pos : null;
  const place = spot && !phone ? placeCard(spot, step?.position, size) : null;
  const pad = 6;
  const fade = { duration: reduce ? 0.15 : 0.22, ease: EASE };
  const isLast = Boolean(at && chapter && at.c === chapters.length - 1 && at.s === chapter.steps.length - 1);

  return (
    <Ctx.Provider value={ctx}>
      {children}
      <AnimatePresence>
        {at && step && chapter && ready && (
          <motion.svg key="tour-overlay" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade} className="pointer-events-none fixed inset-0 z-[60] h-full w-full">
            <defs>
              <mask id="tour-mask">
                <rect width="100%" height="100%" fill="white" />
                {spot && <rect x={spot.left - pad} y={spot.top - pad} width={spot.width + pad * 2} height={spot.height + pad * 2} rx={10} ry={10} fill="black" />}
              </mask>
            </defs>
            {/* The page stays usable: the dimmed overlay doesn't take clicks. */}
            <rect width="100%" height="100%" fill="rgba(20,20,20,0.42)" mask="url(#tour-mask)" />
          </motion.svg>
        )}
      </AnimatePresence>
      {at && step && chapter && ready && spot && (
        <div
          aria-hidden="true"
          data-tour-spotlight
          className="pointer-events-none fixed z-[61] rounded-[10px] border-2 border-focus"
          style={{ top: spot.top - pad, left: spot.left - pad, width: spot.width + pad * 2, height: spot.height + pad * 2 }}
        />
      )}
      <AnimatePresence>
        {at && step && chapter && ready && (
          <motion.div
            key="tour-card"
            ref={card}
            role="dialog"
            aria-modal="false"
            aria-labelledby="tour-step-title"
            aria-label="Tour"
            data-tour-card
            onKeyDown={onKey}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, x: place ? place.left : 0, y: place ? place.top : 0 }}
            exit={{ opacity: 0 }}
            transition={{ opacity: fade, x: { duration: reduce ? 0 : 0.3, ease: EASE }, y: { duration: reduce ? 0 : 0.3, ease: EASE } }}
            style={place ? { top: 0, left: 0 } : undefined}
            className={cn(
              // pointer-events-auto: stays clickable when a modal drawer has made the page behind it inert.
              "pointer-events-auto fixed z-[62] flex flex-col gap-3 border border-line bg-surface text-ink shadow-pop",
              phone ? "inset-x-0 bottom-[60px] rounded-t-pane px-4 pt-3.5 pb-4" : "w-[min(380px,calc(100vw-28px))] rounded-card p-4",
              !phone && !place && "bottom-4 left-4",
            )}
          >
            <div className="flex items-center gap-2 text-small text-ink-2">
              <span className="min-w-0 flex-1 tabular-nums">
                Chapter {at.c + 1} of {chapters.length} · step {shownCount} of {counts.length}
              </span>
              {step.newIn2 && (
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0} role="img" aria-label="New in Architect 2.0" className="grid size-6 place-items-center rounded-full bg-selected text-ink">
                        <Icon name="sparkle" size="sm" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>New in Architect 2.0</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={stepKey}
                initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduce ? 0 : -6 }}
                transition={{ duration: reduce ? 0.12 : 0.18, ease: EASE }}
                className="flex flex-col gap-1.5"
              >
                <h2 id="tour-step-title" className="text-sub font-semibold">
                  {step.title}
                </h2>
                <div className="flex flex-col gap-1.5 text-ink-2">{step.content}</div>
              </motion.div>
            </AnimatePresence>
            {error && (
              <p role="alert" className="text-small font-semibold text-failed">
                {error}
              </p>
            )}
            <div className="flex items-center gap-2">
              {(at.s > 0 || at.c > 0) && (
                <button type="button" onClick={back} disabled={acting} className="min-h-8 rounded-full border border-transparent bg-(--btn) px-3 text-small font-semibold hover:bg-(--btn-hover) disabled:text-ink-3">
                  Back
                </button>
              )}
              <span className="flex-1" />
              <button
                type="button"
                data-tour-next
                onClick={() => void next()}
                aria-disabled={acting || undefined}
                className={cn("min-h-8 rounded-full border border-primary bg-primary px-4 text-small font-semibold text-on-primary", acting && "cursor-progress opacity-80")}
              >
                {acting ? "Working…" : (step.nextLabel ?? (isLast ? "Finish" : "Next"))}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2 text-small">
              {at.c < chapters.length - 1 && (
                <button type="button" onClick={skipChapter} disabled={acting} className="min-h-6 font-semibold text-ink-2 underline decoration-line-ctl underline-offset-[3px] hover:text-ink">
                  Skip this chapter
                </button>
              )}
              {!isLast && (
                <button type="button" onClick={skipTour} disabled={acting} className="min-h-6 font-semibold text-ink-2 underline decoration-line-ctl underline-offset-[3px] hover:text-ink">
                  Skip tour
                </button>
              )}
              <span className="flex-1" />
              <span className="text-ink-3">{chapter.title}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* The visible click: a pointer travels to the real control and presses it, then the control is clicked. */}
      <AnimatePresence>
        {pointer && (
          <motion.div
            key={pointer.key}
            aria-hidden="true"
            data-tour-pointer
            className="pointer-events-none fixed top-0 left-0 z-[70]"
            initial={{ x: pointer.from.x, y: pointer.from.y, opacity: 0 }}
            animate={{ x: pointer.to.x, y: pointer.to.y, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.36, ease: EASE }}
          >
            <span className="block size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-focus bg-focus/25" />
            {!reduce && (
              <motion.span
                className="absolute top-0 left-0 block size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-focus"
                initial={{ scale: 1, opacity: 0 }}
                animate={{ scale: 2.2, opacity: [0, 0.7, 0] }}
                transition={{ delay: 0.36, duration: 0.3, ease: EASE }}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Ctx.Provider>
  );
}
