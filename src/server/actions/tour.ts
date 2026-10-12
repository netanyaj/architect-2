"use server";

import { revalidatePath } from "next/cache";
import { TOUR_STEPS, type TourStep, type TourView } from "@/lib/tour";
import { track } from "../analytics";
import { createAdminDb } from "../db";
import { saveTourPrefs, tourDone, tourFor } from "../tour";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";

const FAILED = "The tour couldn't be saved. Try again.";

async function save(change: Parameters<typeof saveTourPrefs>[2]): Promise<ActionResult> {
  const ctx = await getAppContext();
  const ok = await saveTourPrefs(createAdminDb(), ctx.user.id, change);
  return ok ? { ok: true } : { ok: false, message: FAILED };
}

/** The guide's state, fresh: it asks after each page change and every few seconds while the tour is on. */
export async function tourState(): Promise<TourView | null> {
  return tourFor(createAdminDb(), await getAppContext());
}

/** Start the tour (Home's card): the guide appears on every page. Steps already done don't announce themselves. */
export async function startTour(): Promise<ActionResult> {
  const ctx = await getAppContext();
  const admin = createAdminDb();
  const done = await tourDone(admin, ctx.user.id, ctx.workspace.id);
  const ok = await saveTourPrefs(admin, ctx.user.id, { started: true, minimised: false, dismissed: false, finished: false, celebrated: done });
  if (!ok) return { ok: false, message: FAILED };
  await track("tour_step", { user: ctx.user, workspaceId: ctx.workspace.id, detail: "started" });
  revalidatePath("/home");
  return { ok: true };
}

/** × on the tour card puts it away to the guide; the guide's own − shrinks it to a dot. Both are recorded. */
export async function minimiseTour(from: "card" | "guide"): Promise<ActionResult> {
  const ctx = await getAppContext();
  const admin = createAdminDb();
  const change = from === "card" ? { started: true, minimised: false, celebrated: await tourDone(admin, ctx.user.id, ctx.workspace.id) } : { minimised: true };
  const ok = await saveTourPrefs(admin, ctx.user.id, change);
  if (!ok) return { ok: false, message: FAILED };
  await track("tour_minimised", { user: ctx.user, workspaceId: ctx.workspace.id, detail: from });
  revalidatePath("/home");
  return { ok: true };
}

/** The dot opens back into the guide. */
export async function expandTour(): Promise<ActionResult> {
  return save({ minimised: false });
}

/** "Don't show again", in the guide's step list. Take the tour brings it back. */
export async function dismissTour(): Promise<ActionResult> {
  const r = await save({ dismissed: true });
  if (r.ok) revalidatePath("/home");
  return r;
}

/** Take the tour (Resources, ⌘K): back on screen, from wherever the person got to. */
export async function takeTour(): Promise<ActionResult> {
  const ctx = await getAppContext();
  const admin = createAdminDb();
  const done = await tourDone(admin, ctx.user.id, ctx.workspace.id);
  const ok = await saveTourPrefs(admin, ctx.user.id, { started: true, minimised: false, dismissed: false, finished: false, celebrated: done });
  if (!ok) return { ok: false, message: FAILED };
  await track("tour_step", { user: ctx.user, workspaceId: ctx.workspace.id, detail: "reopened" });
  revalidatePath("/home");
  return { ok: true };
}

/** The finish card was closed (Explore on your own, Reset demo data, or ×): the tour goes away. */
export async function finishTour(how: "explore" | "reset" | "close"): Promise<ActionResult> {
  const ctx = await getAppContext();
  const ok = await saveTourPrefs(createAdminDb(), ctx.user.id, { finished: true, minimised: false });
  if (!ok) return { ok: false, message: FAILED };
  await track("tour_finished", { user: ctx.user, workspaceId: ctx.workspace.id, detail: how });
  revalidatePath("/home");
  return { ok: true };
}

/** A step's "done" message was shown. */
export async function markCelebrated(steps: TourStep[]): Promise<void> {
  await save({ celebrated: steps.filter((s) => TOUR_STEPS.includes(s)) });
}

/** A hint was closed with "Got it". */
export async function closeHint(step: TourStep, seen: TourStep[]): Promise<void> {
  if (!TOUR_STEPS.includes(step)) return;
  await save({ hints: [...new Set([...seen.filter((s) => TOUR_STEPS.includes(s)), step])] });
}

/** A tour step's link was followed (analytics only: the step is done when the person does it). */
export async function openTourStep(step: TourStep): Promise<void> {
  if (!TOUR_STEPS.includes(step)) return;
  const ctx = await getAppContext();
  await track("tour_step", { user: ctx.user, workspaceId: ctx.workspace.id, detail: step });
}
