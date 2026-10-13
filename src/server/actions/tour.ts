"use server";

import { CHAPTERS, type Chapter, type TourView } from "@/lib/tour";
import { track } from "../analytics";
import { createAdminDb } from "../db";
import { saveTourPrefs, tourFor, tourPrefs } from "../tour";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";
import { switchWorkspace } from "./members";

const FAILED = "The tour couldn't be saved. Try again.";

/** The tour's state, fresh. */
export async function tourState(): Promise<TourView | null> {
  return tourFor(createAdminDb(), await getAppContext());
}

/**
 * Start the tour from the welcome (first sign-in or Take the tour). It runs in the person's seeded Acme Ops: someone in
 * Personal is switched there first, so the story has its demo projects, approvals and governance.
 */
export async function beginTour(): Promise<ActionResult<{ switched: boolean }>> {
  const ctx = await getAppContext();
  const admin = createAdminDb();
  let switched = false;
  if (ctx.workspace.kind === "personal") {
    const demo = ctx.memberships.find((m) => m.role === "owner" && m.kind === "demo");
    if (demo) switched = (await switchWorkspace(demo.workspaceId)).ok;
  }
  const ok = await saveTourPrefs(admin, ctx.user.id, { welcomed: true, started: true, dismissed: false, finished: false, chapter: "story", step: "home", projectId: undefined });
  if (!ok) return { ok: false, message: FAILED };
  await track("tour_step", { user: ctx.user, workspaceId: ctx.workspace.id, detail: "started" });
  return { ok: true, switched };
}

/** Where the person is, saved at each step, so a reload resumes there. Recorded too, to see where people leave. */
export async function saveTourProgress(input: { chapter: Chapter; step: string; projectId?: string | null }): Promise<void> {
  if (!(CHAPTERS as readonly string[]).includes(input.chapter) || !/^[a-z0-9-]{1,30}$/.test(input.step)) return;
  const ctx = await getAppContext();
  const change: Parameters<typeof saveTourPrefs>[2] = { chapter: input.chapter, step: input.step };
  if (input.projectId && /^[0-9a-f-]{36}$/.test(input.projectId)) change.projectId = input.projectId;
  await saveTourPrefs(createAdminDb(), ctx.user.id, change);
  await track("tour_step", { user: ctx.user, workspaceId: ctx.workspace.id, detail: `${input.chapter}:${input.step}` });
}

/** "Skip" on the welcome, or "Skip tour" on any step. Progress is kept: Take the tour picks up from there. */
export async function skipTour(at: string): Promise<ActionResult> {
  const ctx = await getAppContext();
  const ok = await saveTourPrefs(createAdminDb(), ctx.user.id, { welcomed: true, dismissed: true });
  if (!ok) return { ok: false, message: FAILED };
  await track("tour_minimised", { user: ctx.user, workspaceId: ctx.workspace.id, detail: `skip:${at}`.slice(0, 40) });
  return { ok: true };
}

/**
 * Take the tour (side nav, Resources, ⌘K): picks up where the person left off, or starts again after they finished.
 * Returns the welcome when there's nothing to pick up.
 */
export async function takeTour(): Promise<ActionResult<{ resume: boolean }>> {
  const ctx = await getAppContext();
  const admin = createAdminDb();
  const prefs = await tourPrefs(admin, ctx.user.id);
  const resume = Boolean(prefs.started && !prefs.finished && prefs.step && prefs.step !== "home");
  const ok = await saveTourPrefs(admin, ctx.user.id, resume ? { dismissed: false } : { welcomed: false, started: false, dismissed: false, finished: false, chapter: undefined, step: undefined, projectId: undefined });
  if (!ok) return { ok: false, message: FAILED };
  await track("tour_step", { user: ctx.user, workspaceId: ctx.workspace.id, detail: resume ? "reopened" : "restarted" });
  return { ok: true, resume };
}

/** The last step: the tour is done (Explore on your own, Reset demo data, or closing it). */
export async function finishTour(how: "explore" | "reset" | "close"): Promise<ActionResult> {
  const ctx = await getAppContext();
  const ok = await saveTourPrefs(createAdminDb(), ctx.user.id, { finished: true, started: false });
  if (!ok) return { ok: false, message: FAILED };
  await track("tour_finished", { user: ctx.user, workspaceId: ctx.workspace.id, detail: how });
  return { ok: true };
}

