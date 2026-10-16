import "server-only";

import { canResetDemo } from "@/lib/permissions";
import { CHAPTERS, TOUR_STEPS, type Chapter, type TourPrefs, type TourStep, type TourView } from "@/lib/tour";
import type { AdminDb } from "./db";
import type { AppContext } from "./workspace";

/** Which product event marks each part of the story done (analytics_events, the person's own). */
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

/** Saves a change to the person's tour, keeping the rest. */
export async function saveTourPrefs(admin: AdminDb, userId: string, change: Partial<TourPrefs>): Promise<boolean> {
  const tour = { ...(await tourPrefs(admin, userId)), ...change };
  const { error } = await admin.from("user_preferences").upsert({ user_id: userId, tour, updated_at: new Date().toISOString() });
  return !error;
}

/** The parts of the story done in this workspace (analytics; the Governance page marks "seen" once). */
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

/** Anyone but a Viewer can take the tour: it writes a plan and builds it, which Viewers can't. */
export function tourAvailable(ctx: AppContext): boolean {
  return ctx.role !== "viewer";
}

/** The tour for this person here, or null when it can't run (a Viewer). */
export async function tourFor(admin: AdminDb, ctx: AppContext): Promise<TourView | null> {
  if (!tourAvailable(ctx)) return null;
  const prefs = await tourPrefs(admin, ctx.user.id);
  const active = Boolean(prefs.started && !prefs.dismissed && !prefs.finished);
  const [{ data: gmail }, { data: deploy }] = await Promise.all([
    admin.from("connections").select("id").eq("workspace_id", ctx.workspace.id).eq("provider", "gmail").eq("status", "connected").limit(1),
    admin.from("approvals").select("id").eq("workspace_id", ctx.workspace.id).eq("kind", "deploy").eq("status", "waiting").limit(1),
  ]);
  return {
    // First sign-in: nothing chosen yet.
    welcome: !prefs.welcomed && !prefs.started && !prefs.dismissed && !prefs.finished,
    active,
    chapter: active && prefs.chapter && (CHAPTERS as readonly string[]).includes(prefs.chapter) ? (prefs.chapter as Chapter) : active ? "story" : null,
    step: active ? (prefs.step ?? null) : null,
    projectId: prefs.projectId ?? null,
    acted: active ? (prefs.acted ?? []) : [],
    userId: ctx.user.id,
    demoVisitor: Boolean(ctx.user.is_anonymous),
    governance: ctx.workspace.governanceEnabled,
    gmailConnected: Boolean(gmail?.length),
    deployWaiting: Boolean(deploy?.length),
    role: ctx.role,
    personal: ctx.workspace.kind === "personal",
    demoWorkspaceId: ctx.memberships.find((m) => m.role === "owner" && m.kind === "demo")?.workspaceId ?? null,
    canResetDemo: canResetDemo(ctx.role) && ctx.workspace.kind !== "personal",
  };
}
