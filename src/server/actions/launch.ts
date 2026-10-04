"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Json } from "@/lib/database.types";
import { launchState, type Deployment } from "@/lib/launch";
import { canBuild, canManageMembers } from "@/lib/permissions";
import { createAdminDb, type AdminDb } from "../db";
import { getAppContext, type AppContext } from "../workspace";
import type { ActionResult } from "./members";

/* Launch (screen 4): Test → Team → Live, simulated (BUILD-SPEC §1). Each step is a deployment row; going back
   deploys an earlier version again. The checklist is recomputed here, so the browser can't skip it. */

const uuid = z.string().uuid();
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";
const URLS = { staging: (s: string) => `${s}--team.architect.space`, production: (s: string) => `${s}.architect.app` };

async function loadState(admin: AdminDb, projectId: string, ctx: AppContext) {
  if (!uuid.safeParse(projectId).success) return null;
  const { data: project } = await admin.from("projects").select("id, name, workspace_id, current_version, status").eq("id", projectId).maybeSingle();
  if (!project || project.workspace_id !== ctx.workspace.id) return null;
  const { data: bp } = await admin.from("blueprints").select("id, version").eq("project_id", project.id).not("agreed_at", "is", null).order("version", { ascending: false }).limit(1).maybeSingle();
  if (!bp) return null;
  const [{ data: items }, { data: deps }, { data: envs }, { data: approvals }, { data: running }] = await Promise.all([
    admin.from("items").select("id, key, title, status, provider, estimate_likely").eq("blueprint_id", bp.id),
    admin.from("deployments").select("id, environment, blueprint_version, status, created_at").eq("project_id", project.id),
    admin.from("environments").select("name, status").eq("project_id", project.id),
    admin.from("approvals").select("id").eq("project_id", project.id).eq("kind", "deploy").eq("status", "waiting"),
    admin.from("runs").select("id").eq("project_id", project.id).in("status", ["queued", "running"]).limit(1),
  ]);
  const deployments: Deployment[] = (deps ?? [])
    .filter((d) => d.environment === "staging" || d.environment === "production")
    .map((d) => ({ id: d.id, environment: d.environment as Deployment["environment"], version: d.blueprint_version, status: d.status, createdAt: d.created_at, by: null }));
  const state = launchState({
    parts: (items ?? []).map((i) => ({ id: i.id, key: i.key, title: i.title, status: i.status, provider: i.provider, estimate: i.estimate_likely === null ? null : Number(i.estimate_likely) })),
    deployments,
    envLive: { staging: (envs ?? []).some((e) => e.name === "staging" && e.status === "live"), production: (envs ?? []).some((e) => e.name === "production" && e.status === "live") },
    currentVersion: bp.version,
    role: ctx.role,
    liveRequested: (approvals ?? []).length > 0,
    testsPassed: 0,
  });
  return { project, version: bp.version, state, building: Boolean(running?.length) };
}

async function deploy(admin: AdminDb, ctx: AppContext, project: { id: string; name: string; workspace_id: string }, env: "staging" | "production", version: number) {
  const now = new Date().toISOString();
  // The version before stays in the history (rolled back = no longer serving), so Go back can return to it.
  await admin.from("deployments").update({ status: "rolled_back" }).eq("project_id", project.id).eq("environment", env).eq("status", "live");
  await admin.from("deployments").insert({ project_id: project.id, environment: env, blueprint_version: version, status: "live", created_by: ctx.user.id, created_at: now, checks: [] as Json });
  const { data: existing } = await admin.from("environments").select("id").eq("project_id", project.id).eq("name", env).maybeSingle();
  if (existing) await admin.from("environments").update({ status: "live", url: URLS[env](slug(project.name)) }).eq("id", existing.id);
  else await admin.from("environments").insert({ project_id: project.id, name: env, status: "live", url: URLS[env](slug(project.name)) });
  await admin.from("audit_log").insert({
    workspace_id: project.workspace_id,
    actor: ctx.name,
    action: env === "production" ? "deploy.live" : "deploy.team",
    target: project.name,
    details: { version, simulated: true } as Json,
  });
}

/** Share with your team (the Team version): only once the checklist is clear. */
export async function shareWithTeam(input: { projectId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't share or launch." };
  const admin = createAdminDb();
  const s = await loadState(admin, input.projectId, ctx);
  if (!s) return { ok: false, message: "That project isn't in this workspace, or isn't built yet." };
  if (s.building) return { ok: false, message: "A build is running. Share when it finishes." };
  if (s.state.share.disabledReason) return { ok: false, message: s.state.share.disabledReason };
  await deploy(admin, ctx, s.project, "staging", s.version);
  revalidatePath(`/p/${s.project.id}/launch`);
  revalidatePath(`/p/${s.project.id}`);
  return { ok: true };
}

/** Go live: Owners and Admins deploy the team version to Live; a Builder's click asks them (an approval). */
export async function goLive(input: { projectId: string }): Promise<ActionResult<{ requested: boolean }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't share or launch." };
  const admin = createAdminDb();
  const s = await loadState(admin, input.projectId, ctx);
  if (!s) return { ok: false, message: "That project isn't in this workspace, or isn't built yet." };
  if (s.building) return { ok: false, message: "A build is running. Go live when it finishes." };
  if (s.state.goLive.disabledReason) return { ok: false, message: s.state.goLive.disabledReason };

  if (!canManageMembers(ctx.role)) {
    await admin.from("approvals").insert({
      workspace_id: s.project.workspace_id,
      project_id: s.project.id,
      kind: "deploy",
      title: `${s.project.name}: Live deploy of v${s.version}`,
      requested_by: ctx.user.id,
      payload: { environment: "production", version: s.version, requested_by_name: ctx.name } as Json,
    });
    revalidatePath(`/p/${s.project.id}/launch`);
    return { ok: true, requested: true };
  }
  await deploy(admin, ctx, s.project, "production", s.version);
  await admin.from("projects").update({ status: "live", updated_at: new Date().toISOString() }).eq("id", s.project.id);
  revalidatePath(`/p/${s.project.id}/launch`);
  revalidatePath(`/p/${s.project.id}`);
  revalidatePath("/projects");
  return { ok: true, requested: false };
}

/** Go back (BL-13): serve an earlier version again, in one click. Live needs an Owner or Admin. */
export async function goBack(input: { deploymentId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't change what's live." };
  if (!uuid.safeParse(input.deploymentId).success) return { ok: false, message: "That version isn't in this project." };
  const admin = createAdminDb();
  const { data: d } = await admin.from("deployments").select("id, project_id, environment, blueprint_version, status, projects!inner(id, name, workspace_id)").eq("id", input.deploymentId).maybeSingle();
  if (!d || d.projects.workspace_id !== ctx.workspace.id) return { ok: false, message: "That version isn't in this project." };
  if (d.status === "live") return { ok: false, message: "That version is the one running now." };
  if (d.environment === "production" && !canManageMembers(ctx.role)) return { ok: false, message: "Only Owners and Admins can change the Live version." };
  await deploy(admin, ctx, d.projects, d.environment as "staging" | "production", d.blueprint_version);
  revalidatePath(`/p/${d.project_id}/launch`);
  return { ok: true };
}
