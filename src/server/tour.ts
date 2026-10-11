import "server-only";

import { TOUR_STEPS, type TourStep, type TourView } from "@/lib/tour";
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

export async function tourDismissed(admin: AdminDb, userId: string): Promise<boolean> {
  const { data } = await admin.from("user_preferences").select("tour").eq("user_id", userId).maybeSingle();
  return Boolean((data?.tour as { dismissed?: boolean } | null)?.dismissed);
}

export async function tourDone(admin: AdminDb, userId: string): Promise<TourStep[]> {
  const { data } = await admin.from("analytics_events").select("event, detail").eq("user_id", userId).in("event", ["plan_written", "build_started", "blocker_resolved", "launch", "tour_step"]).limit(500);
  const rows = data ?? [];
  return TOUR_STEPS.filter((s) => rows.some((r) => r.event === DONE_BY[s].event && (!DONE_BY[s].detail || r.detail === DONE_BY[s].detail)));
}

/** The tour for Home, or null when it isn't shown (dismissed, finished, not the demo workspace, or a Viewer). */
export async function tourFor(admin: AdminDb, ctx: AppContext): Promise<TourView | null> {
  if (ctx.workspace.kind === "personal" || ctx.role === "viewer") return null;
  if (await tourDismissed(admin, ctx.user.id)) return null;
  const done = await tourDone(admin, ctx.user.id);
  if (done.length === TOUR_STEPS.length) return null;

  const ws = ctx.workspace.id;
  const { data: projects } = await admin.from("projects").select("id, name, status, created_at, owner_id").eq("workspace_id", ws).is("deleted_at", null).order("created_at", { ascending: false });
  const list = projects ?? [];
  const ids = list.map((p) => p.id);
  // Step 2: the newest plan of yours that hasn't been built; else the seeded draft.
  const mine = list.find((p) => p.owner_id === ctx.user.id && p.status === "draft") ?? list.find((p) => p.status === "draft");
  // Step 3: a project with a part waiting for an app.
  const { data: waiting } = ids.length ? await admin.from("items").select("project_id").in("project_id", ids).eq("status", "needs_connection").limit(1) : { data: [] };
  return {
    done,
    demoVisitor: Boolean(ctx.user.is_anonymous),
    links: {
      plan: "/home?tour=plan",
      build: mine ? `/p/${mine.id}?view=plan` : "/projects",
      blocker: waiting?.[0] ? `/p/${waiting[0].project_id}` : mine ? `/p/${mine.id}` : "/connections",
      launch: "/governance/approvals",
      governance: "/governance?section=audit",
    },
  };
}
