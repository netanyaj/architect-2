"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Json } from "@/lib/database.types";
import { DEPLOY_STEPS, DOMAIN_CHECK_MS, DomainName, launchState, Listing, type Access, type Deployment, type DomainState, type LaunchSettings } from "@/lib/launch";
import { canBuild, canManageMembers } from "@/lib/permissions";
import { createAdminDb, type AdminDb } from "../db";
import { getAppContext, type AppContext } from "../workspace";
import type { ActionResult } from "./members";

/* Launch (screen 4, reviews/deploy-flow-review-2026-10-05.md): Test → (Team) → Live, simulated (BUILD-SPEC §1).
   Each step is a deployment row; going back deploys an earlier version again. The checklist and the workspace's
   governance setting are read here, so the browser can't skip them. */

const uuid = z.string().uuid();
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";
const URLS = { staging: (s: string) => `${s}--team.architect.space`, production: (s: string) => `${s}.architect.app` };
type Env = "staging" | "production";

const FAILURE = { step: "Health check", reason: "The new version didn't answer within 30 seconds, so it wasn't switched on." };

type Project = { id: string; name: string; workspace_id: string; launch_settings: unknown };

async function loadState(admin: AdminDb, projectId: string, ctx: AppContext) {
  if (!uuid.safeParse(projectId).success) return null;
  const { data: project } = await admin.from("projects").select("id, name, workspace_id, current_version, status, launch_settings").eq("id", projectId).maybeSingle();
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
    .map((d) => ({ id: d.id, environment: d.environment as Env, version: d.blueprint_version, status: d.status, createdAt: d.created_at, by: null }));
  const state = launchState({
    parts: (items ?? []).map((i) => ({ id: i.id, key: i.key, title: i.title, status: i.status, provider: i.provider, estimate: i.estimate_likely === null ? null : Number(i.estimate_likely) })),
    deployments,
    envLive: { staging: (envs ?? []).some((e) => e.name === "staging" && e.status === "live"), production: (envs ?? []).some((e) => e.name === "production" && e.status === "live") },
    currentVersion: bp.version,
    role: ctx.role,
    governance: ctx.workspace.governanceEnabled,
    liveRequested: (approvals ?? []).length > 0,
    testsPassed: 0,
  });
  return { project, version: bp.version, state, building: Boolean(running?.length) };
}

/**
 * One simulated deploy through its steps. On failure (the `deployfail` variant) the new version is recorded as
 * failed with the step and reason, and the version before keeps serving (review gap 9).
 */
async function deploy(admin: AdminDb, ctx: AppContext, project: Project, env: Env, version: number, opts: { fail?: boolean } = {}) {
  const now = new Date().toISOString();
  const steps = DEPLOY_STEPS.map((step) => ({ step, ok: !(opts.fail && step === FAILURE.step) }));
  if (opts.fail) {
    await admin.from("deployments").insert({ project_id: project.id, environment: env, blueprint_version: version, status: "failed", created_by: ctx.user.id, created_at: now, checks: { steps, failure: FAILURE } as Json });
    await admin.from("audit_log").insert({ workspace_id: project.workspace_id, actor: ctx.name, action: "deploy.failed", target: project.name, details: { env, version, ...FAILURE, simulated: true } as Json });
    return false;
  }
  // The version before stays in the history (rolled back = no longer serving), so Go back can return to it.
  await admin.from("deployments").update({ status: "rolled_back" }).eq("project_id", project.id).eq("environment", env).eq("status", "live");
  await admin.from("deployments").insert({ project_id: project.id, environment: env, blueprint_version: version, status: "live", created_by: ctx.user.id, created_at: now, checks: { steps } as Json });
  const settings = (project.launch_settings ?? {}) as LaunchSettings;
  const custom = settings.domains?.[env]?.status === "secured" ? settings.domains[env]!.name : null;
  const url = custom ?? URLS[env](slug(project.name));
  const { data: existing } = await admin.from("environments").select("id").eq("project_id", project.id).eq("name", env).maybeSingle();
  if (existing) await admin.from("environments").update({ status: "live", url }).eq("id", existing.id);
  else await admin.from("environments").insert({ project_id: project.id, name: env, status: "live", url });
  await admin.from("audit_log").insert({
    workspace_id: project.workspace_id,
    actor: ctx.name,
    action: env === "production" ? "deploy.live" : "deploy.team",
    target: project.name,
    details: { version, simulated: true } as Json,
  });
  return true;
}

const failed = (env: Env) => ({
  ok: false as const,
  message: `${env === "production" ? "Going live" : "Sharing"} failed at the ${FAILURE.step.toLowerCase()}. ${FAILURE.reason} The version before is still running. Try again, or ask a person.`,
});

/** Share with your team (the Team version): only once the checklist is clear. Optional without governance. */
export async function shareWithTeam(input: { projectId: string; sim?: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't share or launch." };
  const admin = createAdminDb();
  const s = await loadState(admin, input.projectId, ctx);
  if (!s) return { ok: false, message: "That project isn't in this workspace, or isn't built yet." };
  if (s.building) return { ok: false, message: "A build is running. Share when it finishes." };
  if (s.state.share.disabledReason) return { ok: false, message: s.state.share.disabledReason };
  const ok = await deploy(admin, ctx, s.project, "staging", s.version, { fail: input.sim === "deployfail" });
  revalidatePath(`/p/${s.project.id}/launch`);
  revalidatePath(`/p/${s.project.id}`);
  return ok ? { ok: true } : failed("staging");
}

/**
 * Go live / Update live. With governance on, Owners and Admins deploy the team version and a Builder's click asks
 * them (an approval). With it off, anyone who can build goes live from the test version (review gap 1).
 */
export async function goLive(input: { projectId: string; sim?: string }): Promise<ActionResult<{ requested: boolean }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't share or launch." };
  const admin = createAdminDb();
  const s = await loadState(admin, input.projectId, ctx);
  if (!s) return { ok: false, message: "That project isn't in this workspace, or isn't built yet." };
  if (s.building) return { ok: false, message: "A build is running. Go live when it finishes." };
  if (s.state.goLive.disabledReason) return { ok: false, message: s.state.goLive.disabledReason };

  if (s.state.goLive.request) {
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
  const ok = await deploy(admin, ctx, s.project, "production", s.version, { fail: input.sim === "deployfail" });
  revalidatePath(`/p/${s.project.id}/launch`);
  if (!ok) return failed("production");
  await admin.from("projects").update({ status: "live", updated_at: new Date().toISOString() }).eq("id", s.project.id);
  revalidatePath(`/p/${s.project.id}`);
  revalidatePath("/projects");
  return { ok: true, requested: false };
}

/** Go back (BL-13, after the confirmation): serve an earlier version again. Live needs an Owner or Admin under governance. */
export async function goBack(input: { deploymentId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't change what's live." };
  if (!uuid.safeParse(input.deploymentId).success) return { ok: false, message: "That version isn't in this project." };
  const admin = createAdminDb();
  const { data: d } = await admin
    .from("deployments")
    .select("id, project_id, environment, blueprint_version, status, projects!inner(id, name, workspace_id, launch_settings)")
    .eq("id", input.deploymentId)
    .maybeSingle();
  if (!d || d.projects.workspace_id !== ctx.workspace.id) return { ok: false, message: "That version isn't in this project." };
  if (d.status === "live") return { ok: false, message: "That version is the one running now." };
  if (d.status === "failed") return { ok: false, message: "That version never went out. Pick one that ran." };
  if (d.environment === "production" && ctx.workspace.governanceEnabled && !canManageMembers(ctx.role)) {
    return { ok: false, message: "Only Owners and Admins can change the Live version." };
  }
  await deploy(admin, ctx, d.projects, d.environment as Env, d.blueprint_version);
  revalidatePath(`/p/${d.project_id}/launch`);
  return { ok: true };
}

async function editableProject(admin: AdminDb, projectId: string, ctx: AppContext) {
  if (!canBuild(ctx.role) || !uuid.safeParse(projectId).success) return null;
  const { data } = await admin.from("projects").select("id, name, workspace_id, launch_settings, test_share_token").eq("id", projectId).maybeSingle();
  return data && data.workspace_id === ctx.workspace.id ? data : null;
}

async function saveSettings(admin: AdminDb, ctx: AppContext, project: { id: string; name: string; workspace_id: string; launch_settings: unknown }, patch: Partial<LaunchSettings>, action: string) {
  const next = { ...((project.launch_settings ?? {}) as LaunchSettings), ...patch };
  await admin.from("projects").update({ launch_settings: next as Json }).eq("id", project.id);
  await admin.from("audit_log").insert({ workspace_id: project.workspace_id, actor: ctx.name, action, target: project.name, details: patch as Json });
  revalidatePath(`/p/${project.id}/launch`);
}

/** Who can open it (review gap 2): anyone with the link, signed-in people at your domain, or invited people only. */
export async function setAccess(input: { projectId: string; access: Access }): Promise<ActionResult> {
  const ctx = await getAppContext();
  const admin = createAdminDb();
  const project = await editableProject(admin, input.projectId, ctx);
  if (!project) return { ok: false, message: "Viewers can't change who can open the app." };
  const access = z.enum(["link", "domain", "invited"]).safeParse(input.access);
  if (!access.success) return { ok: false, message: "Pick one of the three choices." };
  await saveSettings(admin, ctx, project, { access: access.data }, "launch.access");
  return { ok: true };
}

/** Built-in analytics (review gap 12), off by default where the workspace runs in a private cloud. */
export async function setAnalytics(input: { projectId: string; on: boolean }): Promise<ActionResult> {
  const ctx = await getAppContext();
  const admin = createAdminDb();
  const project = await editableProject(admin, input.projectId, ctx);
  if (!project) return { ok: false, message: "Viewers can't change analytics." };
  await saveSettings(admin, ctx, project, { analytics: Boolean(input.on) }, "launch.analytics");
  return { ok: true };
}

/** Marketplace (review gap 4): your workspace or Public Agentlets, with today's listing form. */
export async function saveListing(input: { projectId: string; listing: unknown }): Promise<ActionResult> {
  const ctx = await getAppContext();
  const admin = createAdminDb();
  const project = await editableProject(admin, input.projectId, ctx);
  if (!project) return { ok: false, message: "Viewers can't list apps." };
  const parsed = Listing.safeParse(input.listing);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  if (parsed.data.scope === "public" && ctx.workspace.governanceEnabled && !canManageMembers(ctx.role)) {
    return { ok: false, message: "Only Owners and Admins can list an app in Public Agentlets." };
  }
  await saveSettings(admin, ctx, project, { listing: { ...parsed.data, tags: [...new Set(parsed.data.tags.map((t) => t.toLowerCase()))] } }, "launch.listing");
  return { ok: true };
}

/**
 * Custom domain steps (review gap 10), simulated: enter the domain → add the CNAME → Checking → Secured.
 * `step` "start" saves the domain; "check" starts checking; "verify" secures it once checking has run its course.
 */
export async function setDomain(input: { projectId: string; env: Env; step: "start" | "check" | "verify" | "remove"; name?: string }): Promise<ActionResult<{ status?: DomainState["status"] }>> {
  const ctx = await getAppContext();
  const admin = createAdminDb();
  const project = await editableProject(admin, input.projectId, ctx);
  if (!project) return { ok: false, message: "Viewers can't change web addresses." };
  if (input.env !== "staging" && input.env !== "production") return { ok: false, message: "Pick the team or live version." };
  const settings = (project.launch_settings ?? {}) as LaunchSettings;
  const domains = { ...(settings.domains ?? {}) };
  const now = new Date().toISOString();
  const current = domains[input.env];

  if (input.step === "start") {
    const name = DomainName.safeParse(input.name ?? "");
    if (!name.success) return { ok: false, message: name.error.issues[0].message };
    if (name.data.endsWith(".architect.app") || name.data.endsWith(".architect.space")) return { ok: false, message: "Use your own domain; architect addresses are given automatically." };
    domains[input.env] = { name: name.data, status: "dns", since: now };
  } else if (input.step === "check") {
    if (!current) return { ok: false, message: "Add the domain first." };
    domains[input.env] = { ...current, status: "checking", since: now };
  } else if (input.step === "verify") {
    if (!current || current.status !== "checking") return { ok: false, message: "Start the check first." };
    if (Date.now() - Date.parse(current.since) < DOMAIN_CHECK_MS) return { ok: true, status: "checking" };
    domains[input.env] = { ...current, status: "secured", since: now };
  } else {
    delete domains[input.env];
  }
  await saveSettings(admin, ctx, project, { domains }, `domain.${input.step}`);
  return { ok: true, status: domains[input.env]?.status };
}

/** Share the test version by a view-only link (review gap 3); the sample-data banner stays on it. */
export async function shareTestLink(input: { projectId: string; on: boolean }): Promise<ActionResult<{ token: string | null }>> {
  const ctx = await getAppContext();
  const admin = createAdminDb();
  const project = await editableProject(admin, input.projectId, ctx);
  if (!project) return { ok: false, message: "Viewers can't share the test version." };
  const token = input.on ? (project.test_share_token ?? randomUUID()) : null;
  await admin.from("projects").update({ test_share_token: token }).eq("id", project.id);
  await admin.from("audit_log").insert({ workspace_id: project.workspace_id, actor: ctx.name, action: input.on ? "test_link.shared" : "test_link.stopped", target: project.name, details: {} as Json });
  revalidatePath(`/p/${project.id}/launch`);
  return { ok: true, token };
}

/** The workspace's governance setting (Settings): approvals and the Team step, or the fast path. Owners and Admins. */
export async function setGovernance(input: { on: boolean }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!canManageMembers(ctx.role)) return { ok: false, message: "Only Owners and Admins can change governance." };
  const admin = createAdminDb();
  await admin.from("workspaces").update({ governance_enabled: Boolean(input.on) }).eq("id", ctx.workspace.id);
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: input.on ? "governance.on" : "governance.off", target: ctx.workspace.name, details: {} as Json });
  revalidatePath("/", "layout");
  return { ok: true };
}
