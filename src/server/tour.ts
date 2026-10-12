import "server-only";

import { canResetDemo } from "@/lib/permissions";
import { TOUR_STEPS, type TourPrefs, type TourStep, type TourView } from "@/lib/tour";
import type { AdminDb } from "./db";
import type { AppContext } from "./workspace";

/** Which product event marks each step done (analytics_events, the person's own). */
const DONE_BY: Record<TourStep, { event: string; detail?: string }> = {
  plan: { event: "plan_written" },
  build: { event: "build_started" },
  blocker: { event: "blocker_resolved" },
  launch: { event: "launch" },
  governance: { event: "tour_step", detail: "governance_seen" },
};

export async function tourPrefs(admin: AdminDb, userId: string): Promise<TourPrefs> {
  const { data } = await admin.from("user_preferences").select("tour").eq("user_id", userId).maybeSingle();
  return (data?.tour as TourPrefs | null) ?? {};
}

/** Saves a change to the person's tour choices, keeping the rest. */
export async function saveTourPrefs(admin: AdminDb, userId: string, change: Partial<TourPrefs>): Promise<boolean> {
  const tour = { ...(await tourPrefs(admin, userId)), ...change };
  const { error } = await admin.from("user_preferences").upsert({ user_id: userId, tour, updated_at: new Date().toISOString() });
  return !error;
}

/** The steps done in this workspace: a plan written in another workspace doesn't count here. */
export async function tourDone(admin: AdminDb, userId: string, workspaceId: string): Promise<TourStep[]> {
  const { data } = await admin
    .from("analytics_events")
    .select("event, detail")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .in("event", ["plan_written", "build_started", "blocker_resolved", "launch", "tour_step"])
    .limit(500);
  const rows = data ?? [];
  return TOUR_STEPS.filter((s) => rows.some((r) => r.event === DONE_BY[s].event && (!DONE_BY[s].detail || r.detail === DONE_BY[s].detail)));
}

/** Where the tour runs: a team workspace (the seeded Acme Ops for everyone), for anyone but a Viewer. */
export function tourAvailable(ctx: AppContext): boolean {
  return ctx.workspace.kind !== "personal" && ctx.role !== "viewer";
}

/**
 * The tour, or null when it isn't shown: not available here, "Don't show again", finished, or (never started) all five
 * steps already done on the person's own.
 */
export async function tourFor(admin: AdminDb, ctx: AppContext): Promise<TourView | null> {
  if (!tourAvailable(ctx)) return null;
  const prefs = await tourPrefs(admin, ctx.user.id);
  if (prefs.dismissed || prefs.finished) return null;
  const done = await tourDone(admin, ctx.user.id, ctx.workspace.id);
  if (!prefs.started && done.length === TOUR_STEPS.length) return null;

  const ws = ctx.workspace.id;
  const { data: projects } = await admin.from("projects").select("id, name, status, created_at, owner_id").eq("workspace_id", ws).is("deleted_at", null).order("created_at", { ascending: false });
  const list = projects ?? [];
  const ids = list.map((p) => p.id);
  // Step 2: the newest plan of yours that hasn't been built; else the seeded draft.
  const mine = list.find((p) => p.owner_id === ctx.user.id && p.status === "draft") ?? list.find((p) => p.status === "draft");
  // Step 3: a project with a part waiting for an app, the person's own newest first; else the one they last built.
  const { data: waitingRows } = ids.length ? await admin.from("items").select("project_id").in("project_id", ids).eq("status", "needs_connection") : { data: [] };
  const waitingIds = new Set((waitingRows ?? []).map((w) => w.project_id));
  const waiting = list.find((p) => p.owner_id === ctx.user.id && waitingIds.has(p.id)) ?? list.find((p) => waitingIds.has(p.id));
  const built = list.find((p) => p.owner_id === ctx.user.id && p.status !== "draft");
  return {
    done,
    demoVisitor: Boolean(ctx.user.is_anonymous),
    started: Boolean(prefs.started),
    minimised: Boolean(prefs.minimised),
    finished: false,
    celebrated: prefs.celebrated ?? [],
    hints: prefs.hints ?? [],
    canResetDemo: canResetDemo(ctx.role),
    links: {
      plan: "/home?tour=plan",
      build: mine ? `/p/${mine.id}?view=plan` : "/projects",
      blocker: waiting ? `/p/${waiting.id}` : built ? `/p/${built.id}` : "/connections",
      launch: "/governance/approvals",
      governance: "/governance?section=audit",
    },
  };
}
