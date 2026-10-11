"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { OPEN_IN_DEV } from "@/lib/dev-preference";
import type { Json } from "@/lib/database.types";
import { DEFAULT_MODEL, MODEL_CHOICES, MODEL_LABEL } from "@/lib/models";
import { canBuild, canManageMembers } from "@/lib/permissions";
import { allowedModels } from "../blueprint/write-plan";
import { prepareUploads, removeProjectFiles, type UploadSlot } from "../uploads";
import { createAdminDb, createServerDb } from "../db";
import { goOffline } from "../offline";
import { builderDeleteRefusal, purgeDeleted } from "../trash";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";


async function audit(workspaceId: string, actor: string, action: string, target: string, details: Json = {}) {
  await createAdminDb().from("audit_log").insert({ workspace_id: workspaceId, actor, action, target, details });
}

/** A project in the person's current workspace, or null. */
async function loadProject(id: string, workspaceId: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const { data } = await createAdminDb()
    .from("projects")
    .select("id, workspace_id, name, owner_id, prompt, icon, model, budget_credits, status, current_version")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  return data;
}

const promptSchema = z
  .string()
  .trim()
  .min(1, "Describe what you want first.")
  .max(4000, "That's a lot to take in at once. Keep it under 4,000 characters, and add detail in chat afterwards.");

/**
 * Write the plan: creates a draft project holding the prompt and opens its workspace.
 * Nothing is built or charged here; the plan is written in the project (M2), and building waits for a click.
 */
export async function startProject(input: {
  prompt: string;
  model?: string;
  /** Files to attach: the project is created and upload slots come back instead of a redirect. */
  files?: { name: string; type: string; size: number }[];
  /** Lyzr Studio agents to use as parts instead of building new ones (Attach agent). */
  agents?: { id: string; name: string }[];
}): Promise<ActionResult<{ projectId?: string; uploads?: UploadSlot[] }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't start projects. Ask an Owner, Admin or Builder." };
  const prompt = promptSchema.safeParse(input.prompt);
  if (!prompt.success) return { ok: false, message: prompt.error.issues[0].message };
  const admin = createAdminDb();
  const model = z.enum(MODEL_CHOICES).catch(DEFAULT_MODEL).parse(input.model ?? DEFAULT_MODEL);
  if (!(await allowedModels(admin, ctx.workspace.id)).includes(model)) {
    return { ok: false, message: `${MODEL_LABEL[model]} isn't allowed in this workspace. Pick another model.` };
  }

  // Attached Studio agents travel with the prompt, so the plan writer uses them as parts (and the plan quotes them).
  const agents = z.array(z.object({ id: z.string().trim().min(1).max(64), name: z.string().trim().min(1).max(120) })).max(3).catch([]).parse(input.agents ?? []);
  const text = agents.length ? `${prompt.data}\n\n${attachedAgentsLine(agents)}` : prompt.data;

  const { data, error } = await admin
    .from("projects")
    .insert({ workspace_id: ctx.workspace.id, name: "Untitled app", owner_id: ctx.user.id, prompt: text, status: "draft", model })
    .select("id")
    .single();
  if (error || !data) return { ok: false, message: "The project couldn't be created. Nothing was charged. Try again." };
  if (input.files?.length) {
    const prepared = await prepareUploads(admin, ctx.workspace.id, data.id, input.files);
    if ("error" in prepared) {
      await admin.from("projects").delete().eq("id", data.id);
      return { ok: false, message: prepared.error ?? "The files couldn't be prepared." };
    }
    return { ok: true, projectId: data.id, uploads: prepared.slots };
  }
  redirect(`/p/${data.id}`);
}

/** "Use my Lyzr Studio agent “Research agent” (ID 68…) as a part, instead of building a new one for that job." */
function attachedAgentsLine(agents: { id: string; name: string }[]): string {
  const list = agents.map((a) => `“${a.name.replace(/[“”"]/g, "")}” (ID ${a.id.replace(/[^\w-]/g, "")})`);
  return `Use my existing Lyzr Studio ${agents.length === 1 ? "agent" : "agents"} ${list.join(" and ")} as ${agents.length === 1 ? "a part" : "parts"}, instead of building new ones for ${agents.length === 1 ? "that job" : "those jobs"}.`;
}

/** Copies the project and its latest plan as a new draft. Nothing built is copied, and nothing is charged. */
export async function duplicateProject(input: { projectId: string }): Promise<ActionResult<{ projectId: string }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't duplicate projects." };
  const source = await loadProject(input.projectId, ctx.workspace.id);
  if (!source) return { ok: false, message: "That project isn't in this workspace any more." };

  const admin = createAdminDb();
  const { data: copy, error } = await admin
    .from("projects")
    .insert({
      workspace_id: ctx.workspace.id,
      name: `${source.name} copy`,
      owner_id: ctx.user.id,
      prompt: source.prompt,
      icon: source.icon,
      model: source.model,
      budget_credits: source.budget_credits,
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !copy) return { ok: false, message: "The copy couldn't be made. Try again." };

  const { data: plan } = await admin
    .from("blueprints")
    .select("id, prompt, summary, total_low, total_high, total_likely, est_minutes")
    .eq("project_id", source.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (plan) {
    const { data: newPlan } = await admin
      .from("blueprints")
      .insert({
        project_id: copy.id,
        version: 1,
        status: "draft",
        prompt: plan.prompt,
        summary: plan.summary,
        total_low: plan.total_low,
        total_high: plan.total_high,
        total_likely: plan.total_likely,
        est_minutes: plan.est_minutes,
        created_by: ctx.user.id,
      })
      .select("id")
      .single();
    const { data: items } = await admin
      .from("items")
      .select("key, grp, title, description, proved_when, source_quote, estimate_low, estimate_high, estimate_likely, confidence, position, status")
      .eq("blueprint_id", plan.id);
    const kept = (items ?? []).filter((i) => i.status !== "dropped");
    if (newPlan && kept.length) {
      // The copy is a fresh plan: every part starts as proposed, with no cost spent.
      await admin.from("items").insert(kept.map((i) => ({ ...i, status: "proposed", blueprint_id: newPlan.id, project_id: copy.id })));
      await admin.from("projects").update({ current_version: 1 }).eq("id", copy.id);
    }
  }
  await audit(ctx.workspace.id, ctx.name, "project.duplicated", source.name, { copy: copy.id });
  revalidatePath("/projects");
  revalidatePath("/home");
  return { ok: true, projectId: copy.id };
}

/**
 * Delete a project: it moves to Trash for 30 days, where it can be restored. Owners and Admins can delete
 * any project; a Builder only their own, if it isn't Live or shared with the team and nobody else has worked on it.
 * A Live project goes offline first. Deleting permanently is the Owner's, from Trash.
 */
export async function deleteProject(input: { projectId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't delete projects." };
  const project = await loadProject(input.projectId, ctx.workspace.id);
  if (!project) return { ok: false, message: "That project isn't in this workspace any more." };
  const admin = createAdminDb();
  if (!canManageMembers(ctx.role)) {
    const refusal = await builderDeleteRefusal(admin, project, ctx.user.id);
    if (refusal) return { ok: false, message: refusal };
  }
  if (project.status === "live") await goOffline(admin, project, { name: ctx.name, userId: ctx.user.id });
  const { error } = await admin.from("projects").update({ deleted_at: new Date().toISOString(), deleted_by: ctx.user.id, deleted_by_name: ctx.name }).eq("id", project.id);
  if (error) return { ok: false, message: "The project couldn't be deleted. Try again." };
  await audit(ctx.workspace.id, ctx.name, "project.deleted", project.name, { recoverable_days: 30 });
  // The nav's Trash count and the Trash page change too.
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Trash (was Recently deleted): the projects this person deleted, or all of the workspace's for Owners and Admins. Purges first. */
export async function recentlyDeleted(): Promise<ActionResult<{ projects: { id: string; name: string; deletedAt: string; deletedBy: string | null; canDeleteForever: boolean }[] }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: true, projects: [] };
  await purgeDeleted(createAdminDb(), ctx.workspace.id);
  const db = await createServerDb();
  const { data, error } = await db.rpc("list_deleted_projects", { p_workspace: ctx.workspace.id });
  if (error) return { ok: false, message: "Trash couldn't be loaded. Try again." };
  return { ok: true, projects: (data ?? []).map((p) => ({ id: p.id, name: p.name, deletedAt: p.deleted_at, deletedBy: p.deleted_by_name, canDeleteForever: ctx.role === "owner" })) };
}

/** Restore from Trash (the person who deleted it, or an Owner or Admin; checked in the database). */
export async function restoreProject(input: { projectId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!z.string().uuid().safeParse(input.projectId).success) return { ok: false, message: "That project can't be restored." };
  const db = await createServerDb();
  const { data: ws, error } = await db.rpc("restore_project", { p_project: input.projectId });
  if (error || ws !== ctx.workspace.id) return { ok: false, message: error?.message.includes("Only the person") ? "Only the person who deleted it, or an Owner or Admin, can restore it." : "That project can't be restored any more." };
  const { data: p } = await createAdminDb().from("projects").select("name").eq("id", input.projectId).single();
  await audit(ctx.workspace.id, ctx.name, "project.restored", p?.name ?? input.projectId);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Delete permanently, from Trash: the workspace Owner only (checked in the database). Files go too. */
export async function deleteProjectForever(input: { projectId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (ctx.role !== "owner") return { ok: false, message: "Only the workspace Owner can delete a project permanently." };
  if (!z.string().uuid().safeParse(input.projectId).success) return { ok: false, message: "That project isn't in Trash." };
  const admin = createAdminDb();
  const { data: p } = await admin.from("projects").select("name").eq("id", input.projectId).maybeSingle();
  const db = await createServerDb();
  const { data: ws, error } = await db.rpc("delete_project_forever", { p_project: input.projectId });
  if (error || !ws) return { ok: false, message: "That project isn't in Trash." };
  await removeProjectFiles(admin, ws, input.projectId);
  await audit(ctx.workspace.id, ctx.name, "project.deleted_forever", p?.name ?? input.projectId);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Set or clear a project's credit budget (Owners and Admins). The build pauses when it reaches it. */
export async function setProjectBudget(input: { projectId: string; credits: number | null }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!canManageMembers(ctx.role)) return { ok: false, message: "Only Owners and Admins can change budgets." };
  const credits = z.number().int("Use a whole number of credits.").min(1, "A budget needs at least 1 credit.").max(100000, "That's above the workspace's limit of 100,000 credits.").nullable().safeParse(input.credits);
  if (!credits.success) return { ok: false, message: credits.error.issues[0].message };
  const project = await loadProject(input.projectId, ctx.workspace.id);
  if (!project) return { ok: false, message: "That project isn't in this workspace any more." };

  const { error } = await createAdminDb().from("projects").update({ budget_credits: credits.data }).eq("id", project.id);
  if (error) return { ok: false, message: "The budget couldn't be saved. Try again." };
  await audit(ctx.workspace.id, ctx.name, "budget.changed", project.name, { from: project.budget_credits, to: credits.data });
  revalidatePath("/settings");
  revalidatePath("/projects");
  return { ok: true };
}

/**
 * Light or dark: a user setting, saved on the account (so it follows the person to other browsers) and in a cookie
 * (so pages render in it without a round trip). Developer view uses it too.
 */
/** "Open projects in Developer view", saved to the person's account. */
export async function setOpenInDev(value: string): Promise<ActionResult> {
  if (!OPEN_IN_DEV.some((o) => o.value === value)) return { ok: false, message: "Pick one of the choices shown." };
  const db = await createServerDb();
  const { error } = await db.auth.updateUser({ data: { open_in_dev: value } });
  if (error) return { ok: false, message: "That couldn't be saved. Try again." };
  // Read first on the next page, as the theme is: the session's copy of the account catches up later.
  (await cookies()).set("ax_open_in_dev", value, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setTheme(theme: "system" | "light" | "dark"): Promise<ActionResult> {
  if (theme !== "light" && theme !== "dark" && theme !== "system") return { ok: false, message: "Pick System, Light or Dark." };
  const db = await createServerDb();
  const { error } = await db.auth.updateUser({ data: { theme } });
  if (error) return { ok: false, message: "Your theme couldn't be saved. Try again." };
  (await cookies()).set("ax_theme", theme, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
  return { ok: true };
}
