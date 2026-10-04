"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Json } from "@/lib/database.types";
import { canBuild, canManageMembers } from "@/lib/permissions";
import { createAdminDb } from "../db";
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
    .select("id, workspace_id, name, owner_id, prompt, icon, model, budget_credits")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
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
export async function startProject(input: { prompt: string; talkFirst?: boolean }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't start projects. Ask an Owner, Admin or Builder." };
  const prompt = promptSchema.safeParse(input.prompt);
  if (!prompt.success) return { ok: false, message: prompt.error.issues[0].message };

  const { data, error } = await createAdminDb()
    .from("projects")
    .insert({ workspace_id: ctx.workspace.id, name: "Untitled app", owner_id: ctx.user.id, prompt: prompt.data, status: "draft" })
    .select("id")
    .single();
  if (error || !data) return { ok: false, message: "The project couldn't be created. Nothing was charged. Try again." };
  redirect(`/p/${data.id}`);
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

/** Owners and Admins can delete any project; a Builder can delete their own. Usage history goes with it. */
export async function deleteProject(input: { projectId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  const project = await loadProject(input.projectId, ctx.workspace.id);
  if (!project) return { ok: false, message: "That project isn't in this workspace any more." };
  const allowed = canManageMembers(ctx.role) || (ctx.role === "builder" && project.owner_id === ctx.user.id);
  if (!allowed) return { ok: false, message: "Only the project's owner, an Owner or an Admin can delete it." };

  const admin = createAdminDb();
  // Support tickets point at projects without a cascade: keep the ticket, drop the link.
  await admin.from("support_tickets").update({ project_id: null }).eq("project_id", project.id);
  const { error } = await admin.from("projects").delete().eq("id", project.id);
  if (error) return { ok: false, message: "The project couldn't be deleted. Try again." };
  await audit(ctx.workspace.id, ctx.name, "project.deleted", project.name);
  revalidatePath("/projects");
  revalidatePath("/home");
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

/** Light or dark, for this browser. (Developer view defaults to dark on its own.) */
export async function setTheme(theme: "light" | "dark"): Promise<ActionResult> {
  if (theme !== "light" && theme !== "dark") return { ok: false, message: "Pick Light or Dark." };
  (await cookies()).set("ax_theme", theme, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
  return { ok: true };
}
