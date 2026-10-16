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
 * Round 8: the card never glides. It fades out, is placed, and fades in once its control has settled (moved more than
 * 8px and stayed put for 150ms); scrolling is instant; the pointer appears at the control and presses once.
 */
"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/ax/icon";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type TourStepDef = {
  id: string;
  /**
   * The data-tour value to spotlight, or css:<selector>; "a || b" tries each in turn. None: the card sits at the bottom of
   * the screen, with no spotlight.
   */
  target?: string;
  /** What to spotlight once the step's action is done and its control has gone (a finished build, a connected blocker). */
  doneTarget?: string;
  /**
   * The step's place: its route and the view state it needs in the query (?dev=1, ?view=terminal). Next, Back and a
   * resume all go there first, then show the card, then wait for the target.
   */
  page?: string;
  /** View state the query can't hold (a closed drawer, an open tab), set once the route is right. */
  prepare?: (api: TourApi) => Promise<void>;
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
  /** How long to wait for the target before offering "Take me there" (ms; default 5 seconds). */
  waitMs?: number;
};

export type TourChapterDef = { id: string; title: string; steps: TourStepDef[] };

export type TourApi = {
  /** Shows a pointer at the control, presses once, then clicks it. */
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

/** Where the card sits: beside its control, bottom left (no control, or still waiting for it), the middle (missing), or the phone sheet. */
type Place = { kind: "at"; top: number; left: number } | { kind: "bottom" | "center" | "phone" };

/** Small layout jitter isn't a move. */
const JITTER = 8;
/** How long a control must stay put before the card moves to it, and how long the card takes to fade. */
const SETTLE_MS = 150;
/** A step whose control hasn't turned up by now shows its card bottom left while it waits. */
const WAIT_MS = 1_200;

const nearBox = (a: Box, b: Box) =>
  Math.abs(a.top - b.top) <= JITTER && Math.abs(a.left - b.left) <= JITTER && Math.abs(a.width - b.width) <= JITTER && Math.abs(a.height - b.height) <= JITTER;

const samePlace = (a: Place, b: Place) =>
  a.kind === "at" && b.kind === "at" ? Math.abs(a.top - b.top) <= JITTER && Math.abs(a.left - b.left) <= JITTER : a.kind === b.kind;

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
  for (const one of target.split(" || ")) {
    const selector = one.startsWith("css:") ? one.slice(4) : `[data-tour="${one}"]`;
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
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

/** A done step lights up its result when it has one; Back never undoes the action. */
function targetOf(st: TourStepDef | null | undefined, done: string[]): string | undefined {
  return st?.doneTarget && done.includes(st.id) ? st.doneTarget : st?.target;
}

/** Same place: the step's path, and exactly its query (?dev=1, ?view=…), ignoring the simulator's ?sim. */
function atPlace(page: string | undefined): boolean {
  if (!page) return true;
  const want = new URL(page, window.location.origin);
  if (window.location.pathname !== want.pathname) return false;
  const norm = (p: URLSearchParams) => [...p.entries()].filter(([k]) => k !== "sim").map(([k, v]) => `${k}=${v}`).sort().join("&");
  return norm(new URLSearchParams(window.location.search)) === norm(want.searchParams);
}

/** Where the card shows a step: going to its place, shown there, or shown without its control (Take me there). */
type Phase = "moving" | "shown" | "missing";

export function TourEngine({
  chapters,
  initial,
  acted,
  onActed,
  onStep,
  onSkip,
  onFinish,
  onMove,
  children,
}: {
  chapters: TourChapterDef[];
  /** Resume here (a reload mid-tour, or a page from another part of the app). */
  initial: { chapter: string; step: string } | null;
  /** Steps whose action is done: Next on them just moves on (Back never undoes an action). */
  acted: string[];
  onActed: (step: string) => void;
  /** Each step as it shows: save it. */
  onStep: (chapter: string, step: string) => void;
  /** Skip tour, from this step. */
  onSkip: (chapter: string, step: string) => void;
  /** Past the last step. */
  onFinish: () => void;
  /** Every move (Next, Back, Skip this chapter), before the step's place opens: keep it, so a page change resumes there. */
  onMove?: (chapter: string, step: string) => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [at, setAt] = useState<{ c: number; s: number } | null>(() => locate(chapters, initial));
  const [pos, setPos] = useState<Box | null>(null);
  const [phase, setPhase] = useState<Phase>("moving");
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number; key: number } | null>(null);
  // The control's box once it has settled: the card is placed from this, while the spotlight follows pos exactly.
  const [anchor, setAnchor] = useState<Box | null>(null);
  // The control hasn't turned up yet: after a moment the card shows bottom left while it waits.
  const [late, setLate] = useState(false);
  // Where the card is drawn and whether it shows. It changes place only while faded out.
  const [view, setView] = useState<{ at: Place | null; visible: boolean }>({ at: null, visible: false });
  const [retry, setRetry] = useState(0);
  const card = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 380, height: 220 });
  const [phone, setPhone] = useState(false);
  // Each request to show a step gets a number: an older one still going to its place or waiting gives up.
  const request = useRef(0);
  // The last page the tour asked the router for; a push still in flight can land after a newer request, so a step
  // whose page differs from it pushes its own page even when the address bar already shows it.
  const pushed = useRef<string | null>(null);
  // The step actions' helpers, for the place-setting effect above them.
  const apiRef = useRef<TourApi>(null as unknown as TourApi);
  const chaptersRef = useRef(chapters);
  const actedRef = useRef(acted);
  useLayoutEffect(() => {
    actedRef.current = acted;
  });
  const cbRef = useRef({ onStep });
  useLayoutEffect(() => {
    chaptersRef.current = chapters;
    cbRef.current = { onStep };
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

  // Each step: go to its place (route and view state), then show the card, then wait up to 5 seconds for its control.
  // Next, Back, a resume and Take me there all come through here; only the most recent request wins.
  const stepKey = at ? `${at.c}:${at.s}` : null;
  useEffect(() => {
    if (!at) return;
    const ch = chaptersRef.current[at.c];
    const st = ch?.steps[at.s];
    if (!st) return;
    const mine = ++request.current;
    const live = () => request.current === mine;
    const until = async (check: () => boolean, ms: number) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (!live()) return false;
        if (check()) return true;
        await sleep(100);
      }
      return false;
    };
    setPhase("moving");
    setPos(null);
    setAnchor(null);
    setLate(false);
    setError(null);
    (async () => {
      if (st.page && (!atPlace(st.page) || (pushed.current && pushed.current !== st.page))) {
        pushed.current = st.page;
        router.push(st.page);
      }
      await until(() => atPlace(st.page), 30_000);
      if (!live()) return;
      if (pushed.current && atPlace(pushed.current)) pushed.current = null;
      if (st.prepare && apiRef.current) await st.prepare(apiRef.current).catch(() => {});
      if (!live()) return;
      setPhase("shown");
      cbRef.current.onStep(ch.id, st.id);
      const target = targetOf(st, actedRef.current);
      if (!target) return;
      const found = await until(() => Boolean(findTarget(target)), st.waitMs ?? 5_000);
      if (!live()) return;
      if (!found) return setPhase("missing");
      const r = findTarget(target)!.getBoundingClientRect();
      // Instant: the card stays hidden until the control has settled, then shows in place.
      if (r.top < 0 || r.bottom > window.innerHeight) findTarget(target)!.scrollIntoView({ behavior: "auto", block: "center" });
    })();
    // The step and Take me there decide; everything else is read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey, retry]);

  // Follow the control as the page scrolls, resizes or redraws; a control that turns up late lights up then.
  useEffect(() => {
    const target = targetOf(step, acted);
    if (!target || phase === "moving") return;
    let raf = 0;
    const update = () => {
      const r = findTarget(target)?.getBoundingClientRect();
      setPos((p) => {
        if (!r) return p === null ? p : null;
        const n = { top: r.top, left: r.left, width: r.width, height: r.height };
        return p && Math.abs(p.top - n.top) < 0.5 && Math.abs(p.left - n.left) < 0.5 && Math.abs(p.width - n.width) < 0.5 && Math.abs(p.height - n.height) < 0.5 ? p : n;
      });
      if (r) setPhase((ph) => (ph === "missing" ? "shown" : ph));
      raf = window.requestAnimationFrame(update);
    };
    update();
    return () => window.cancelAnimationFrame(raf);
  }, [step, phase, acted]);

  // The card moves only when the control has moved more than 8px and stayed put for 150ms.
  useEffect(() => {
    if (!pos || (anchor && nearBox(anchor, pos))) return;
    const t = window.setTimeout(() => setAnchor(pos), SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [pos, anchor]);

  const hasTarget = Boolean(targetOf(step, acted));
  // The step's action needs its control, which hasn't turned up yet: Next waits for it (a missing control offers Take me there).
  const waiting = phase === "shown" && hasTarget && !pos && Boolean(step?.onNext) && !acted.includes(step?.id ?? "");
  useEffect(() => {
    if (phase !== "shown" || !hasTarget || anchor) return;
    const t = window.setTimeout(() => setLate(true), WAIT_MS);
    return () => window.clearTimeout(t);
  }, [phase, hasTarget, anchor, stepKey]);

  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize((s) => (s.width === el.offsetWidth && s.height === el.offsetHeight ? s : { width: el.offsetWidth, height: el.offsetHeight })));
    ro.observe(el);
    return () => ro.disconnect();
  });

  // Where the card wants to be. Hidden while the step goes to its place, and for a moment while its control turns up.
  const want: Place | null =
    phase === "moving"
      ? null
      : phone
        ? hasTarget && !anchor && !late && phase !== "missing"
          ? null
          : { kind: "phone" }
        : !hasTarget
          ? { kind: "bottom" }
          : anchor
            ? { kind: "at", ...placeCard(anchor, step?.position, size) }
            : phase === "missing"
              ? { kind: "center" }
              : late
                ? { kind: "bottom" }
                : null;
  const wantKey = want ? (want.kind === "at" ? `at:${Math.round(want.top)}:${Math.round(want.left)}` : want.kind) : "none";

  // The card never glides: to change place it fades out, is placed, then fades in.
  const viewRef = useRef(view);
  const hiddenAt = useRef(0);
  const moveTimer = useRef(0);
  useLayoutEffect(() => {
    viewRef.current = view;
  });
  useEffect(() => {
    window.clearTimeout(moveTimer.current);
    const v = viewRef.current;
    if (!want) {
      if (v.visible) {
        hiddenAt.current = Date.now();
        setView({ at: v.at, visible: false });
      }
      return;
    }
    if (v.at && samePlace(want, v.at)) {
      if (!v.visible) setView({ at: v.at, visible: true });
      return;
    }
    if (v.visible) {
      hiddenAt.current = Date.now();
      setView({ at: v.at, visible: false });
    }
    // Wait out the fade before placing, so the card is never seen jumping.
    const left = v.at ? Math.max(0, SETTLE_MS - (Date.now() - hiddenAt.current)) : 0;
    const show = () => setView({ at: want, visible: true });
    if (left) moveTimer.current = window.setTimeout(show, left);
    else show();
    // The place decides; want is read as it was when the place changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantKey]);
  useEffect(() => () => window.clearTimeout(moveTimer.current), []);

  // Focus moves into the card at each step: Tab cycles its controls, and the arrow keys step while it has focus.
  useEffect(() => {
    if (phase === "moving" || acting || !view.visible || waiting) return;
    card.current?.querySelector<HTMLElement>("[data-tour-next]")?.focus({ preventScroll: true });
  }, [phase, acting, stepKey, view.visible, waiting]);

  // The visible click: scroll the control into view, show a pointer on it, press once, then click it.
  const press = useCallback(
    async (el: HTMLElement) => {
      const r0 = el.getBoundingClientRect();
      if (r0.top < 0 || r0.bottom > window.innerHeight) el.scrollIntoView({ behavior: "auto", block: "center" });
      const r = el.getBoundingClientRect();
      setPointer({ x: r.left + r.width / 2, y: r.top + r.height / 2, key: Date.now() });
      await sleep(reduce ? 120 : 220);
      el.click();
      await sleep(200);
      setPointer(null);
    },
    [reduce],
  );

  const api = useMemo<TourApi>(
    () => ({
      find: findTarget,
      go: (href) => {
        pushed.current = href;
        router.push(href);
      },
      waitFor,
      click: async (target, opts) => {
        await waitFor(() => Boolean(findTarget(target)), opts?.timeout ?? 15_000, "The control");
        await press(findTarget(target)!);
      },
      clickElement: press,
    }),
    [router, press],
  );
  useLayoutEffect(() => {
    apiRef.current = api;
  });

  const goTo = useCallback(
    (c: number, s: number) => {
      const st = chaptersRef.current[c]?.steps[s];
      if (st) onMove?.(chaptersRef.current[c].id, st.id);
      setAt({ c, s });
    },
    [onMove],
  );

  const busy = acting || phase === "moving" || !view.visible;

  const next = useCallback(async () => {
    if (!at || !step || acting) return;
    setError(null);
    // An action already done (a build, a connect, an approval) isn't done again: Next just moves on.
    if (step.onNext && !acted.includes(step.id)) {
      if (phase === "moving") return;
      setActing(true);
      try {
        const r = await step.onNext(api);
        if (r === false) return;
        onActed(step.id);
      } catch (e) {
        // A step's own message says what to do; otherwise Next simply tries again.
        const m = e instanceof Error ? e.message : "That didn't work";
        setError(/[.!?]$/.test(m) ? m : `${m}. Next tries again.`);
        return;
      } finally {
        setActing(false);
      }
    }
    const ch = chaptersRef.current[at.c];
    if (at.s < ch.steps.length - 1) goTo(at.c, at.s + 1);
    else if (at.c < chaptersRef.current.length - 1) goTo(at.c + 1, 0);
    else {
      setAt(null);
      onFinish();
    }
  }, [at, step, acting, phase, acted, api, goTo, onActed, onFinish]);

  // Back returns to the previous step's place as it is now; it never undoes that step's action.
  const back = useCallback(() => {
    if (!at || acting) return;
    if (at.s > 0) goTo(at.c, at.s - 1);
    else if (at.c > 0) goTo(at.c - 1, chaptersRef.current[at.c - 1].steps.length - 1);
  }, [at, acting, goTo]);

  const skipChapter = useCallback(() => {
    if (!at || acting) return;
    if (at.c < chaptersRef.current.length - 1) goTo(at.c + 1, 0);
    else {
      setAt(null);
      onFinish();
    }
  }, [at, acting, goTo, onFinish]);

  const skipTour = useCallback(() => {
    if (!chapter || !step) return;
    request.current++;
    onSkip(chapter.id, step.id);
    setAt(null);
  }, [chapter, step, onSkip]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" && !waiting) void next();
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
      start: (where) => {
        const l = locate(chaptersRef.current, { chapter: where?.chapter ?? chaptersRef.current[0].id, step: where?.step ?? chaptersRef.current[0].steps[0].id });
        goTo(l?.c ?? 0, l?.s ?? 0);
      },
      stop: () => {
        request.current++;
        setAt(null);
      },
    }),
    [at, goTo],
  );

  // Shown count: "step 3 of 9" (two cards can share a number).
  const counts = chapter ? [...new Set(chapter.steps.map((s, i) => s.count ?? i + 1))] : [];
  const shownCount = step && at ? counts.indexOf(step.count ?? at.s + 1) + 1 : 0;
  const spot = hasTarget && phase !== "moving" ? pos : null;
  const place = view.at;
  const pad = 6;
  const fade = { duration: reduce ? 0.15 : 0.22, ease: EASE };
  const isLast = Boolean(at && chapter && at.c === chapters.length - 1 && at.s === chapter.steps.length - 1);
  const show = Boolean(at && step && chapter);
  const btn = "min-h-8 rounded-full px-3 text-small font-semibold disabled:cursor-default disabled:opacity-60";

  return (
    <Ctx.Provider value={ctx}>
      {children}
      <AnimatePresence>
        {show && (
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
      {show && spot && (
        <div
          aria-hidden="true"
          data-tour-spotlight
          className="pointer-events-none fixed z-[61] rounded-[10px] border-2 border-focus"
          style={{ top: spot.top - pad, left: spot.left - pad, width: spot.width + pad * 2, height: spot.height + pad * 2 }}
        />
      )}
      <AnimatePresence>
        {show && at && step && chapter && (
          <motion.div
            key="tour-card"
            ref={card}
            role="dialog"
            aria-modal="false"
            aria-labelledby="tour-step-title"
            aria-label="Tour"
            aria-busy={phase === "moving" || undefined}
            data-tour-card
            data-tour-phase={phase}
            onKeyDown={onKey}
            data-tour-visible={view.visible || undefined}
            initial={{ opacity: 0 }}
            animate={{ opacity: view.visible ? 1 : 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: SETTLE_MS / 1000, ease: EASE }}
            style={place?.kind === "at" ? { top: place.top, left: place.left } : undefined}
            className={cn(
              // pointer-events-auto: stays clickable when a modal drawer has made the page behind it inert.
              "pointer-events-auto fixed z-[62] flex flex-col gap-3 border border-line bg-surface text-ink shadow-pop",
              phone ? "inset-x-0 bottom-[60px] rounded-t-pane px-4 pt-3.5 pb-4" : "w-[min(380px,calc(100vw-28px))] rounded-card p-4",
              // No control to point at: the middle of the screen (missing), or the bottom left while it waits.
              !phone && place?.kind === "center" && "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
              !phone && (!place || place.kind === "bottom") && "bottom-4 left-4",
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
                    {/* Above the tour's overlay and card (z 60–62), and inside the screen. */}
                    <TooltipContent className="z-[80]" collisionPadding={12}>
                      New in Architect 2.0
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={stepKey}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0.12 : 0.18, ease: EASE }}
                className="flex flex-col gap-1.5"
              >
                <h2 id="tour-step-title" className="text-sub font-semibold">
                  {step.title}
                </h2>
                <div className="flex flex-col gap-1.5 text-ink-2">{step.content}</div>
              </motion.div>
            </AnimatePresence>
            {phase === "missing" && (
              <div className="flex flex-wrap items-center gap-2 rounded-tile bg-tray px-3 py-2 text-small">
                <span className="min-w-0 flex-1 text-ink-2">This step&apos;s control isn&apos;t on the screen.</span>
                <button type="button" onClick={() => setRetry((n) => n + 1)} className={cn(btn, "border border-transparent bg-(--btn) hover:bg-(--btn-hover)")}>
                  Take me there
                </button>
              </div>
            )}
            {waiting && !acting && (
              <p role="status" className="text-small text-ink-2">
                Waiting for it to show on the page…
              </p>
            )}
            {error && (
              <p role="alert" className="text-small font-semibold text-failed">
                {error}
              </p>
            )}
            <div className="flex items-center gap-2">
              {(at.s > 0 || at.c > 0) && (
                <button type="button" onClick={back} disabled={busy} className={cn(btn, "border border-transparent bg-(--btn) hover:bg-(--btn-hover)")}>
                  Back
                </button>
              )}
              <span className="flex-1" />
              <button
                type="button"
                data-tour-next
                onClick={() => void next()}
                disabled={busy || waiting}
                className={cn(btn, "border border-primary bg-primary px-4 text-on-primary", acting && "cursor-progress")}
              >
                {acting ? "Working…" : (step.nextLabel && !acted.includes(step.id) ? step.nextLabel : isLast ? "Finish" : "Next")}
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
      {/* The visible click: a pointer appears on the real control and presses it once, then the control is clicked. */}
      <AnimatePresence>
        {pointer && (
          <motion.div
            key={pointer.key}
            aria-hidden="true"
            data-tour-pointer
            className="pointer-events-none fixed z-[70]"
            style={{ top: pointer.y, left: pointer.x }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1, ease: EASE }}
          >
            <motion.span
              className="block size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-focus bg-focus/25"
              initial={{ scale: 1 }}
              animate={{ scale: reduce ? 1 : [1, 0.8, 1] }}
              transition={{ duration: 0.2, ease: EASE }}
            />
            {!reduce && (
              <motion.span
                className="absolute top-0 left-0 block size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-focus"
                initial={{ scale: 1, opacity: 0 }}
                animate={{ scale: 1.8, opacity: [0, 0.7, 0] }}
                transition={{ duration: 0.2, ease: EASE }}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Ctx.Provider>
  );
}
