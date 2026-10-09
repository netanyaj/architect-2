"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Json } from "@/lib/database.types";
import { canBuild, canManageMembers } from "@/lib/permissions";
import { suggestionFor, type Suggestion } from "@/lib/sim/suggestion";
import { SCENARIO } from "@/lib/sim/timeline";
import { createAdminDb, createServerDb, type AdminDb } from "../db";
import { deniedForProject } from "../policy";
import { amendRun, blockedInRun, settleRun, startFollowupRun } from "../sim/run";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";

const uuid = z.string().uuid();
const BUILDERS_ONLY = "Viewers can't change the build. Ask an Owner, Admin or Builder.";

/** A part in the person's workspace, with its project. */
async function partOf(admin: AdminDb, itemId: string, workspaceId: string) {
  if (!uuid.safeParse(itemId).success) return null;
  const { data } = await admin
    .from("items")
    .select("id, key, title, status, provider, proved_when, estimate_likely, blueprint_id, project_id, fix_attempts, projects!inner(id, name, workspace_id, budget_credits)")
    .eq("id", itemId)
    .maybeSingle();
  return data && data.projects.workspace_id === workspaceId ? data : null;
}

async function projectOf(admin: AdminDb, projectId: string, workspaceId: string) {
  if (!uuid.safeParse(projectId).success) return null;
  const { data } = await admin.from("projects").select("id, name, workspace_id, budget_credits, current_version").eq("id", projectId).maybeSingle();
  return data && data.workspace_id === workspaceId ? data : null;
}

/**
 * The project's status once nothing is running: paused while a part is Blocked or parts wait for budget, otherwise
 * built (or live, if it has a live version).
 */
async function refreshStatus(admin: AdminDb, projectId: string) {
  const { data: runs } = await admin.from("runs").select("status, started_at").eq("project_id", projectId);
  if ((runs ?? []).some((r) => r.status === "queued" || r.status === "running")) return;
  const latest = [...(runs ?? [])].sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""))[0];
  const { data: bp } = await admin.from("blueprints").select("id").eq("project_id", projectId).not("agreed_at", "is", null).order("version", { ascending: false }).limit(1).maybeSingle();
  if (!bp) return;
  const { data: items } = await admin.from("items").select("status").eq("blueprint_id", bp.id);
  const { data: live } = await admin.from("deployments").select("id").eq("project_id", projectId).eq("status", "live").limit(1);
  const blocked = (items ?? []).some((i) => i.status === "paused") || (latest?.status === "paused_budget" && (items ?? []).some((i) => i.status === "agreed"));
  await admin
    .from("projects")
    .update({ status: blocked ? "paused" : live?.length ? "live" : "built", updated_at: new Date().toISOString() })
    .eq("id", projectId);
}

async function audit(admin: AdminDb, workspaceId: string, actor: string, action: string, target: string, details: Record<string, unknown>) {
  await admin.from("audit_log").insert({ workspace_id: workspaceId, actor, action, target, details: details as Json });
}

/** An event outside a run (Connect, a suggested fix), so Realtime and the activity lines show it. */
async function logEvent(admin: AdminDb, projectId: string, itemId: string | null, type: string, payload: Record<string, unknown>) {
  await admin.from("events").insert({ project_id: projectId, item_id: itemId, type, actor: "user", payload: payload as Json });
}

/**
 * Called by the first browser to see a run's last event (SIMULATOR step 3). Any member may ask; the database
 * settles only a running run whose time is up, and only once.
 */
export async function settleRunNow(input: { runId: string }): Promise<ActionResult<{ status: string | null }>> {
  if (!uuid.safeParse(input.runId).success) return { ok: false, message: "That run isn't in this project." };
  // Read under the person's own access: only members of the project's workspace can see the run.
  const db = await createServerDb();
  const { data: run } = await db.from("runs").select("id, project_id").eq("id", input.runId).maybeSingle();
  if (!run) return { ok: false, message: "That run isn't in this project." };
  const status = await settleRun(createAdminDb(), run.id);
  revalidatePath(`/p/${run.project_id}`);
  return { ok: true, status };
}

/**
 * Connect (BL-9), simulated: the workspace's account for this service is connected, and every part of this project
 * waiting for it works with real data from now on.
 */
export async function connectPart(input: { itemId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't connect accounts. Ask an Owner, Admin or Builder." };
  const admin = createAdminDb();
  const part = await partOf(admin, input.itemId, ctx.workspace.id);
  if (!part?.provider) return { ok: false, message: "That part doesn't need a connection." };
  const { data: running } = await admin.from("runs").select("id").eq("project_id", part.project_id).eq("status", "running").limit(1);
  // While the build plays, the part may be waiting for this connection before the run has settled.
  if (part.status !== "needs_connection" && !running?.length) return { ok: false, message: "That part is already connected." };

  if ((await deniedForProject(admin, ctx.workspace.id, part.project_id)).includes(part.provider)) {
    return { ok: false, message: "Your organisation's policy doesn't allow this app. IT has to approve it first." };
  }
  const { data: existing } = await admin.from("connections").select("id").eq("workspace_id", ctx.workspace.id).eq("provider", part.provider).maybeSingle();
  if (existing) await admin.from("connections").update({ status: "connected" }).eq("id", existing.id);
  else await admin.from("connections").insert({ workspace_id: ctx.workspace.id, provider: part.provider, status: "connected", scopes: ["read"] });

  const { data: waiting } = await admin.from("items").select("id, key").eq("blueprint_id", part.blueprint_id).eq("status", "needs_connection").eq("provider", part.provider);
  for (const w of waiting ?? []) {
    await admin.from("items").update({ status: "built", status_detail: null }).eq("id", w.id);
    await logEvent(admin, part.project_id, w.id, "item.built", { item_key: w.key, connected: part.provider, at_ms: 0 });
  }
  await audit(admin, ctx.workspace.id, ctx.name, "connection.connected", part.provider, { project: part.projects.name, simulated: true });
  await refreshStatus(admin, part.project_id);
  revalidatePath(`/p/${part.project_id}`);
  revalidatePath("/connections");
  return { ok: true };
}

/** What I suggest (screen 6): change the part's check to the suggested one. It passes on the last try, at no cost. */
export async function acceptSuggestion(input: { itemId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: BUILDERS_ONLY };
  const admin = createAdminDb();
  const part = await partOf(admin, input.itemId, ctx.workspace.id);
  if (!part) return { ok: false, message: "That part isn't blocked any more." };
  const s = suggestionFor(part.proved_when);

  // Blocked in a build that's still playing (A-9): change the check now; the run settles it as working.
  if (part.status !== "paused") {
    const b = await blockedInRun(admin, part.project_id, part.key);
    if (!b) return { ok: false, message: "That part isn't blocked any more." };
    const detail = `Check changed: ${s.title.toLowerCase()}`;
    const ok = await amendRun(
      admin,
      b,
      { ...b.part, status: "built", statusDetail: detail, proof: { kind: "eval", assertions: [3, 3], screenshot: false } },
      [{ type: "item.built", actor: "user", payload: { check_changed: true, credits: 0 } }],
      part.id,
    );
    if (!ok) return { ok: false, message: "The build just finished. Open the part again to decide." };
    await admin.from("items").update({ proved_when: s.provedWhen }).eq("id", part.id);
    await admin.from("checks").insert({ item_id: part.id, kind: "eval", description: s.provedWhen, written_by: ctx.name });
    await audit(admin, ctx.workspace.id, ctx.name, "check.changed", part.title, { from: part.proved_when, to: s.provedWhen, during_build: true });
    revalidatePath(`/p/${part.project_id}`);
    return { ok: true };
  }

  await admin.from("items").update({ proved_when: s.provedWhen, status: "built", status_detail: `Check changed: ${s.title.toLowerCase()}` }).eq("id", part.id);
  const { data: check } = await admin.from("checks").select("id, kind").eq("item_id", part.id).order("written_at", { ascending: false }).limit(1).maybeSingle();
  const { data: newCheck } = await admin
    .from("checks")
    .insert({ item_id: part.id, kind: check?.kind ?? "eval", description: s.provedWhen, written_by: ctx.name })
    .select("id")
    .single();
  await admin.from("proofs").insert({ item_id: part.id, check_id: newCheck?.id ?? null, attempt: part.fix_attempts, result: "pass", assertions_passed: 3, assertions_total: 3, summary: `Passes the changed check: ${s.title.toLowerCase()}` });
  await logEvent(admin, part.project_id, part.id, "item.built", { item_key: part.key, check_changed: true, at_ms: 0 });
  await audit(admin, ctx.workspace.id, ctx.name, "check.changed", part.title, { from: part.proved_when, to: s.provedWhen });
  await refreshStatus(admin, part.project_id);
  revalidatePath(`/p/${part.project_id}`);
  return { ok: true };
}

/** Try once more (screen 6): one more fix on a Blocked part, its own Usage line. */
export async function retryPart(input: { itemId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: BUILDERS_ONLY };
  const admin = createAdminDb();
  const part = await partOf(admin, input.itemId, ctx.workspace.id);
  if (!part) return { ok: false, message: "That part isn't blocked any more." };
  const fix = SCENARIO.cost.fix_credits[1];

  // Blocked in a build that's still playing (A-9): one more fix joins that build, without waiting for it to end.
  if (part.status !== "paused") {
    const b = await blockedInRun(admin, part.project_id, part.key);
    if (!b) return { ok: false, message: "That part isn't blocked any more." };
    const { data: project } = await admin.from("projects").select("budget_credits").eq("id", part.project_id).single();
    if (project?.budget_credits !== null && project?.budget_credits !== undefined) {
      const { data: usage } = await admin.from("usage_ledger").select("credits").eq("project_id", part.project_id);
      const pending = b.outcome.outcomes.reduce((t, o) => t + o.credits + o.fixes.reduce((f, x) => f + x.credits, 0), 0);
      const spent = (usage ?? []).reduce((t, u) => t + Number(u.credits), 0);
      if (spent + pending + fix > Number(project.budget_credits)) return { ok: false, message: "That would go past the project's budget. Raise the budget first." };
    }
    const attempt = Math.max(3, ...b.part.fixes.map((f) => f.attempt)) + 1;
    const note = "Tried once more";
    const ok = await amendRun(
      admin,
      b,
      {
        ...b.part,
        status: "built",
        statusDetail: null,
        proof: { kind: "eval", assertions: [3, 3], screenshot: false },
        fixes: [...b.part.fixes, { attempt, credits: fix, measured: null, note }],
        attempts: [...b.part.attempts, { attempt, measured: null, note, credits: fix, result: "pass" }],
      },
      [
        { type: "item.fixing", actor: "architect_agent", payload: { attempt, credits: fix } },
        { type: "log.line", actor: "architect_agent", payload: { verb: "Edited", object: `agents/${part.key}.py · one more try` } },
        { type: "item.built", delayMs: 3000, actor: "verifier", payload: { assertions: [3, 3], screenshot: false, credits: 0 } },
      ],
      part.id,
    );
    if (!ok) return { ok: false, message: "The build just finished. Open the part again to decide." };
    await audit(admin, ctx.workspace.id, ctx.name, "part.retried", part.title, { during_build: true });
    revalidatePath(`/p/${part.project_id}`);
    return { ok: true };
  }

  const r = await startFollowupRun(admin, { projectId: part.project_id, userId: ctx.user.id, kind: "fix", focus: [part.key], estimate: fix });
  revalidatePath(`/p/${part.project_id}`);
  return r.ok ? { ok: true } : r;
}

/** Set aside for now: the part waits in Up next and isn't built or charged. Everything else keeps working. */
export async function setPartAside(input: { itemId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: BUILDERS_ONLY };
  const admin = createAdminDb();
  const part = await partOf(admin, input.itemId, ctx.workspace.id);
  if (!part) return { ok: false, message: "That part can't be set aside now." };
  // Blocked in a build that's still playing (A-9): set it aside in that build; its fixes so far are still charged.
  const b = part.status === "paused" ? null : await blockedInRun(admin, part.project_id, part.key);
  if (b) {
    const ok = await amendRun(admin, b, { ...b.part, status: "deferred" as never, statusDetail: "Set aside" }, [{ type: "item.deferred", actor: "user", payload: {} }], part.id);
    if (!ok) return { ok: false, message: "The build just finished. Open the part again to decide." };
    await audit(admin, ctx.workspace.id, ctx.name, "part.set_aside", part.title, { project: part.projects.name, during_build: true });
    revalidatePath(`/p/${part.project_id}`);
    return { ok: true };
  }
  if (!["paused", "agreed", "failed"].includes(part.status)) return { ok: false, message: "That part can't be set aside now." };
  await admin.from("items").update({ status: "deferred", status_detail: "Set aside" }).eq("id", part.id);
  await audit(admin, ctx.workspace.id, ctx.name, "part.set_aside", part.title, { project: part.projects.name });
  await refreshStatus(admin, part.project_id);
  revalidatePath(`/p/${part.project_id}`);
  return { ok: true };
}

/** Raise budget to N and continue (screen 7): Owners and Admins set the budget; the waiting parts build. */
export async function raiseBudgetAndContinue(input: { projectId: string; budget: number }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!canManageMembers(ctx.role)) return { ok: false, message: "Only Owners and Admins can raise a budget. Ask one, or set the parts aside." };
  const budget = z.number().int().min(1).max(100000).safeParse(input.budget);
  if (!budget.success) return { ok: false, message: "Use a whole number of credits, up to 100,000." };
  const admin = createAdminDb();
  const project = await projectOf(admin, input.projectId, ctx.workspace.id);
  if (!project) return { ok: false, message: "That project isn't in this workspace." };
  const { data: bp } = await admin.from("blueprints").select("id").eq("project_id", project.id).not("agreed_at", "is", null).order("version", { ascending: false }).limit(1).maybeSingle();
  const { data: waiting } = bp ? await admin.from("items").select("estimate_likely").eq("blueprint_id", bp.id).eq("status", "agreed") : { data: [] };
  if (!waiting?.length) return { ok: false, message: "Nothing is waiting for budget." };

  await admin.from("projects").update({ budget_credits: budget.data }).eq("id", project.id);
  await audit(admin, ctx.workspace.id, ctx.name, "budget.changed", project.name, { from: project.budget_credits, to: budget.data });
  const estimate = waiting.reduce((s, i) => s + Number(i.estimate_likely ?? 0), 0);
  const r = await startFollowupRun(admin, { projectId: project.id, userId: ctx.user.id, kind: "build", focus: null, estimate });
  revalidatePath(`/p/${project.id}`);
  return r.ok ? { ok: true } : r;
}

/** Set the N parts aside (screen 7): everything waiting for budget waits in Up next instead. */
export async function setWaitingAside(input: { projectId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: BUILDERS_ONLY };
  const admin = createAdminDb();
  const project = await projectOf(admin, input.projectId, ctx.workspace.id);
  if (!project) return { ok: false, message: "That project isn't in this workspace." };
  const { data: bp } = await admin.from("blueprints").select("id").eq("project_id", project.id).not("agreed_at", "is", null).order("version", { ascending: false }).limit(1).maybeSingle();
  if (bp) await admin.from("items").update({ status: "deferred", status_detail: "Set aside at the budget" }).eq("blueprint_id", bp.id).eq("status", "agreed");
  await audit(admin, ctx.workspace.id, ctx.name, "parts.set_aside", project.name, { reason: "budget" });
  await refreshStatus(admin, project.id);
  revalidatePath(`/p/${project.id}`);
  return { ok: true };
}

/** Stop here (screen 7): keep what works and launch it; the waiting parts stay in the plan for later. */
export async function stopHere(input: { projectId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: BUILDERS_ONLY };
  const admin = createAdminDb();
  const project = await projectOf(admin, input.projectId, ctx.workspace.id);
  if (!project) return { ok: false, message: "That project isn't in this workspace." };
  await admin.from("runs").update({ status: "done" }).eq("project_id", project.id).eq("status", "paused_budget");
  const { data: bp } = await admin.from("blueprints").select("id").eq("project_id", project.id).not("agreed_at", "is", null).order("version", { ascending: false }).limit(1).maybeSingle();
  if (bp) await admin.from("items").update({ status_detail: "Not built: stopped at the budget" }).eq("blueprint_id", bp.id).eq("status", "agreed");
  await audit(admin, ctx.workspace.id, ctx.name, "build.stopped", project.name, { reason: "budget" });
  await refreshStatus(admin, project.id);
  revalidatePath(`/p/${project.id}`);
  return { ok: true };
}

export type PartDetail = {
  check: { kind: string; description: string; writtenAt: string; writtenBy: string } | null;
  attempts: { attempt: number; result: "pass" | "fail"; summary: string | null; note: string | null; credits: number | null; at: string }[];
  credits: number;
  suggestion: (Suggestion & { provedWhen: string }) | null;
  retryCost: number;
};

/** A part's drawer: its check, every attempt with its cost, and the suggested fix when it's Blocked. Read under RLS. */
export async function loadPart(input: { itemId: string }): Promise<ActionResult<{ detail: PartDetail }>> {
  if (!uuid.safeParse(input.itemId).success) return { ok: false, message: "That part isn't in this project." };
  const db = await createServerDb();
  const { data: item } = await db.from("items").select("id, key, project_id, status, proved_when, cost_actual").eq("id", input.itemId).maybeSingle();
  if (!item) return { ok: false, message: "That part isn't in this project." };
  // Blocked in a build that's still playing: its tries come from the run (proofs are written when it settles).
  // The read above, under the person's own access, has already checked they can see this part.
  const live = item.status === "paused" ? null : await blockedInRun(createAdminDb(), item.project_id, item.key);
  const [{ data: checks }, { data: proofs }, { data: fixes }] = await Promise.all([
    db.from("checks").select("kind, description, written_at, written_by").eq("item_id", item.id).order("written_at", { ascending: false }).limit(1),
    db.from("proofs").select("attempt, result, summary, log, created_at").eq("item_id", item.id).order("attempt").order("created_at"),
    db.from("usage_ledger").select("credits, note").eq("item_id", item.id).eq("kind", "fix").order("created_at"),
  ]);
  const check = checks?.[0];
  const fixCost = (attempt: number) => {
    const f = (fixes ?? [])[attempt - 1];
    return f ? Number(f.credits) : null;
  };
  return {
    ok: true,
    detail: {
      check: check ? { kind: check.kind, description: check.description, writtenAt: check.written_at, writtenBy: check.written_by } : null,
      attempts: live
        ? live.part.attempts.map((x) => ({
            attempt: x.attempt,
            result: x.result,
            summary: x.result === "pass" ? "All assertions passed" : `Failed: ${x.measured ?? "check failed"}`,
            note: x.note,
            credits: x.credits,
            at: live.startedAt,
          }))
        : (proofs ?? []).map((p) => ({
        attempt: p.attempt,
        result: p.result as "pass" | "fail",
        summary: p.summary,
        note: p.log,
        credits: p.attempt > 0 ? fixCost(p.attempt) : null,
        at: p.created_at,
      })),
      credits: live ? live.part.credits + live.part.fixes.reduce((t, f) => t + f.credits, 0) : Number(item.cost_actual),
      suggestion: item.status === "paused" || live ? suggestionFor(item.proved_when) : null,
      retryCost: SCENARIO.cost.fix_credits[1],
    },
  };
}
