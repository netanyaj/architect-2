"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AUTO, MODEL_CHOICES, MODEL_LABEL } from "@/lib/models";
import { canBuild } from "@/lib/permissions";
import { allowedModels } from "../blueprint/write-plan";
import { weakensCheck, type VersionItem } from "@/lib/plan-diff";
import { parseSim, startRun } from "../sim/run";
import { createAdminDb, createServerDb, type AdminDb } from "../db";
import { budgetRefusal } from "../policy";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";

const uuid = z.string().uuid();

/**
 * The plan a row belongs to, if it's in the person's workspace and still a draft (agreed plans change only through
 * a new version). Returns a refusal message otherwise.
 */
async function draftPlanOf(admin: AdminDb, blueprintId: string, workspaceId: string): Promise<{ projectId: string } | { error: string }> {
  const { data } = await admin.from("blueprints").select("id, agreed_at, generation, project_id, projects!inner(workspace_id)").eq("id", blueprintId).maybeSingle();
  if (!data || data.projects.workspace_id !== workspaceId) return { error: "That plan isn't in this workspace." };
  if (data.agreed_at) return { error: "This version is agreed. Ask for the change in chat, and it becomes a new version." };
  if (data.generation === "writing") return { error: "Wait for the plan to finish writing." };
  return { projectId: data.project_id };
}

async function guard() {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ctx, refused: "Viewers can't change the plan. Ask an Owner, Admin or Builder." };
  return { ctx, refused: undefined };
}

/** Answer a question about the plan. Blocking questions hold Build until they're answered (A-0, A-2). */
export async function answerQuestion(input: { questionId: string; value: string }): Promise<ActionResult> {
  const { ctx, refused } = await guard();
  if (refused) return { ok: false, message: refused };
  if (!uuid.safeParse(input.questionId).success) return { ok: false, message: "That question isn't in this plan." };
  const admin = createAdminDb();
  const { data: q } = await admin.from("questions").select("id, blueprint_id, options").eq("id", input.questionId).maybeSingle();
  if (!q) return { ok: false, message: "That question isn't in this plan." };
  const plan = await draftPlanOf(admin, q.blueprint_id, ctx.workspace.id);
  if ("error" in plan) return { ok: false, message: plan.error };
  const options = (q.options as { value: string }[]).map((o) => o.value);
  if (!options.includes(input.value)) return { ok: false, message: "Pick one of the answers shown." };

  await admin.from("questions").update({ answer: input.value, answered_by: ctx.user.id, answered_at: new Date().toISOString() }).eq("id", q.id);
  revalidatePath(`/p/${plan.projectId}`);
  return { ok: true };
}

/** Change one of the "Choices I made for you" to one of its alternatives. */
export async function changeDefault(input: { defaultId: string; value: string }): Promise<ActionResult> {
  const { ctx, refused } = await guard();
  if (refused) return { ok: false, message: refused };
  if (!uuid.safeParse(input.defaultId).success) return { ok: false, message: "That choice isn't in this plan." };
  const admin = createAdminDb();
  const { data: d } = await admin.from("defaults").select("id, blueprint_id, value, alternatives").eq("id", input.defaultId).maybeSingle();
  if (!d) return { ok: false, message: "That choice isn't in this plan." };
  const plan = await draftPlanOf(admin, d.blueprint_id, ctx.workspace.id);
  if ("error" in plan) return { ok: false, message: plan.error };
  const allowed = [d.value, ...((d.alternatives as string[]) ?? [])];
  if (!allowed.includes(input.value)) return { ok: false, message: "Pick one of the choices shown, or describe another in chat." };

  // The old value becomes an alternative, so the person can switch back.
  const alternatives = [d.value, ...((d.alternatives as string[]) ?? [])].filter((v) => v !== input.value);
  await admin.from("defaults").update({ value: input.value, alternatives }).eq("id", d.id);
  revalidatePath(`/p/${plan.projectId}`);
  return { ok: true };
}

const itemEdit = z.object({
  itemId: uuid,
  title: z.string().trim().min(1, "A part needs a title.").max(60, "Keep the title under 60 characters."),
  description: z.string().trim().max(200, "Keep the description under 200 characters."),
  provedWhen: z.string().trim().min(1, "Say how Architect can check it works.").max(160, "Keep the check under 160 characters."),
});

/** Edit a part's wording before Build. Its price doesn't change; its check is what gets built and tested. */
export async function editItem(input: {
  itemId: string;
  title: string;
  description: string;
  provedWhen: string;
  /** Required when the edit weakens the part's check (A-3): keep it as asked, set the part aside, or drop the stronger check. */
  decision?: { decision: "keep" | "defer" | "drop"; reason?: string };
}): Promise<ActionResult<{ applied?: "edit" | "kept" | "deferred" }> & { conflict?: { before: string; after: string } }> {
  const { ctx, refused } = await guard();
  if (refused) return { ok: false, message: refused };
  const parsed = itemEdit.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const admin = createAdminDb();
  const { data: item } = await admin.from("items").select("id, blueprint_id, proved_when").eq("id", parsed.data.itemId).maybeSingle();
  if (!item) return { ok: false, message: "That part isn't in this plan." };
  const plan = await draftPlanOf(admin, item.blueprint_id, ctx.workspace.id);
  if ("error" in plan) return { ok: false, message: plan.error };

  // The conflict guard covers edits too: a check that loses a line or a number needs a decision first.
  if (weakensCheck(item.proved_when, parsed.data.provedWhen)) {
    const d = input.decision;
    if (!d) {
      return { ok: false, message: "This edit weakens what the part is checked for. Keep it, set the part aside, or drop the stronger check.", conflict: { before: item.proved_when, after: parsed.data.provedWhen } };
    }
    const now = new Date().toISOString();
    if (d.decision === "keep") {
      await admin.from("items").update({ title: parsed.data.title, description: parsed.data.description, edited_at: now }).eq("id", item.id);
      revalidatePath(`/p/${plan.projectId}`);
      return { ok: true, applied: "kept" };
    }
    if (d.decision === "defer") {
      await admin.from("items").update({ status: "deferred", status_detail: "Set aside", edited_at: now }).eq("id", item.id);
      revalidatePath(`/p/${plan.projectId}`);
      return { ok: true, applied: "deferred" };
    }
    const reason = (d.reason ?? "").trim();
    if (!reason) return { ok: false, message: "Say why you're dropping the stronger check. It's saved on the plan." };
    await admin
      .from("items")
      .update({ title: parsed.data.title, description: parsed.data.description, proved_when: parsed.data.provedWhen, drop_reason: `Weakened: ${reason.slice(0, 200)}`, edited_at: now })
      .eq("id", item.id);
    revalidatePath(`/p/${plan.projectId}`);
    return { ok: true, applied: "edit" };
  }

  await admin
    .from("items")
    .update({ title: parsed.data.title, description: parsed.data.description, proved_when: parsed.data.provedWhen, edited_at: new Date().toISOString() })
    .eq("id", item.id);
  revalidatePath(`/p/${plan.projectId}`);
  return { ok: true };
}

/** Pick the model for this project (BL-3). The page asks first when a plan already exists. */
export async function setProjectModel(input: { projectId: string; model: string }): Promise<ActionResult> {
  const { ctx, refused } = await guard();
  if (refused) return { ok: false, message: refused };
  // Auto (M5.8) is always allowed: it resolves to an allowed model at each step.
  const model = z.enum([...MODEL_CHOICES, AUTO]).safeParse(input.model);
  if (!model.success || !uuid.safeParse(input.projectId).success) return { ok: false, message: "Pick one of the models shown." };
  const admin = createAdminDb();
  if (model.data !== AUTO && !(await allowedModels(admin, ctx.workspace.id)).includes(model.data)) {
    return { ok: false, message: `${MODEL_LABEL[model.data]} isn't allowed in this workspace.` };
  }
  const { data, error } = await admin.from("projects").update({ model: model.data }).eq("id", input.projectId).eq("workspace_id", ctx.workspace.id).select("id");
  if (error || !data?.length) return { ok: false, message: "That project isn't in this workspace." };
  revalidatePath(`/p/${input.projectId}`);
  return { ok: true };
}

const BUILD_REFUSALS: Record<string, string> = {
  blocking_questions_open: "Answer the open question first. It holds Build because there's no safe default.",
  cannot_build: "Viewers can't build. Ask an Owner, Admin or Builder.",
  plan_not_ready: "Wait for the plan to finish writing.",
  already_agreed: "This version is already agreed and its build is queued.",
  run_in_progress: "A build is already running on this project. Wait for it to finish.",
};

/**
 * Build · ~N credits. The only way a build starts (CLAUDE.md rule 1): the database's Build gate agrees this version,
 * agrees its parts and queues a run started by this person, in one transaction. Refuses with the reason otherwise.
 */
export async function buildPlan(input: { blueprintId: string; sim?: string }): Promise<ActionResult<{ runId: string }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: BUILD_REFUSALS.cannot_build };
  if (!uuid.safeParse(input.blueprintId).success) return { ok: false, message: "That plan isn't in this workspace." };
  const admin = createAdminDb();
  const { data: bp } = await admin.from("blueprints").select("id, project_id, total_likely, projects!inner(workspace_id, budget_credits)").eq("id", input.blueprintId).maybeSingle();
  if (!bp || bp.projects.workspace_id !== ctx.workspace.id) return { ok: false, message: "That plan isn't in this workspace." };
  // The organisation's monthly cap (C-7): paid actions stop at 100% until an admin raises it.
  const stopped = await budgetRefusal(admin, ctx.workspace.id);
  if (stopped) return { ok: false, message: stopped };

  const { data: runId, error } = await admin.rpc("agree_and_build", { p_blueprint: bp.id, p_user: ctx.user.id, p_kind: "build" });
  if (error || !runId) {
    const code = Object.keys(BUILD_REFUSALS).find((k) => error?.message.includes(k));
    if (error?.message.includes("over_budget")) {
      return {
        ok: false,
        message: `This plan's ~${Math.round(Number(bp.total_likely))} credits would go past the project's ${Number(bp.projects.budget_credits)}-credit budget. Raise the budget in Settings, or set parts aside first.`,
      };
    }
    return { ok: false, message: code ? BUILD_REFUSALS[code] : "Build couldn't start. Nothing was charged. Try again." };
  }
  await startRun(admin, runId, parseSim(input.sim));
  revalidatePath(`/p/${bp.project_id}`);
  revalidatePath("/projects");
  return { ok: true, runId };
}

/** One version's parts, for Compare versions (A-5). Read with the person's own access (RLS). */
export async function loadVersionItems(input: { blueprintId: string }): Promise<ActionResult<{ items: VersionItem[] }>> {
  if (!uuid.safeParse(input.blueprintId).success) return { ok: false, message: "That version isn't in this project." };
  const db = await createServerDb();
  const { data, error } = await db
    .from("items")
    .select("key, grp, title, description, proved_when, source_quote, item_class, size, provider, status, drop_reason, position")
    .eq("blueprint_id", input.blueprintId)
    .order("position");
  if (error) return { ok: false, message: "That version couldn't be loaded. Try again." };
  return { ok: true, items: (data ?? []) as VersionItem[] };
}
