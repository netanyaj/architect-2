"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkEditProblem, checkEditWeakens, checkRerunEstimate, RECHECKABLE } from "@/lib/check-edit";
import type { Json } from "@/lib/database.types";
import { canBuild } from "@/lib/permissions";
import { RECHECK_MS } from "../code-edits";
import { createAdminDb, type AdminDb } from "../db";
import { budgetRefusal } from "../policy";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";

/* Edit a built part's check (A-7). Two steps, so the cost is always seen before anything is spent: preview (the
   estimate, and whether the edit weakens the check), then Re-run the check, which records the new check (who, when),
   charges the estimate and has the checker run it again (simulated, settled like a code edit's re-run). */

const input = z.object({ itemId: z.string().uuid(), provedWhen: z.string().max(400), reason: z.string().max(200).optional() });

type Estimate = ReturnType<typeof checkRerunEstimate>;

async function partFor(admin: AdminDb, itemId: string, workspaceId: string) {
  const { data } = await admin
    .from("items")
    .select("id, key, title, status, proved_when, estimate_likely, blueprint_id, project_id, projects!inner(id, name, workspace_id, budget_credits)")
    .eq("id", itemId)
    .maybeSingle();
  return data && data.projects.workspace_id === workspaceId ? data : null;
}

async function problemFor(admin: AdminDb, part: NonNullable<Awaited<ReturnType<typeof partFor>>>, provedWhen: string, estimate: Estimate): Promise<string | null> {
  if (!RECHECKABLE.includes(part.status)) return "Only a part that's built has a check to run again. Change it in the plan instead.";
  const problem = checkEditProblem(part.proved_when, provedWhen);
  if (problem) return problem;
  const { data: running } = await admin.from("runs").select("id").eq("project_id", part.project_id).in("status", ["queued", "running"]).limit(1);
  if (running?.length) return "A build is running. Edit the check when it finishes.";
  const budget = part.projects.budget_credits;
  if (budget !== null) {
    const { data: usage } = await admin.from("usage_ledger").select("credits").eq("project_id", part.project_id);
    const spent = (usage ?? []).reduce((t, u) => t + Number(u.credits), 0);
    if (spent + estimate.likely > Number(budget)) return "That would go past the project's budget. Raise the budget first.";
  }
  return null;
}

/** Step 1: what re-running costs, and whether the edit weakens the check. Spends nothing. */
export async function previewCheckEdit(raw: z.input<typeof input>): Promise<ActionResult<{ estimate: Estimate; weakens: boolean }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can read checks but can't change them." };
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That part isn't in this project." };
  const admin = createAdminDb();
  const part = await partFor(admin, parsed.data.itemId, ctx.workspace.id);
  if (!part) return { ok: false, message: "That part isn't in this project." };
  const estimate = checkRerunEstimate(part.estimate_likely === null ? null : Number(part.estimate_likely));
  const problem = await problemFor(admin, part, parsed.data.provedWhen, estimate);
  if (problem) return { ok: false, message: problem };
  return { ok: true, estimate, weakens: checkEditWeakens(part.proved_when, parsed.data.provedWhen) };
}

/** Step 2, on the person's click: save the new check and run it again. */
export async function editCheck(raw: z.input<typeof input>): Promise<ActionResult<{ credits: number }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can read checks but can't change them." };
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That part isn't in this project." };
  const admin = createAdminDb();
  const part = await partFor(admin, parsed.data.itemId, ctx.workspace.id);
  if (!part) return { ok: false, message: "That part isn't in this project." };
  const estimate = checkRerunEstimate(part.estimate_likely === null ? null : Number(part.estimate_likely));
  const problem = (await problemFor(admin, part, parsed.data.provedWhen, estimate)) ?? (await budgetRefusal(admin, ctx.workspace.id)) ?? null;
  if (problem) return { ok: false, message: problem };
  const after = parsed.data.provedWhen.trim();
  const weakens = checkEditWeakens(part.proved_when, after);
  const reason = (parsed.data.reason ?? "").trim();
  if (weakens && !reason) return { ok: false, message: "This check asks for less than before. Say why; it's saved on the part." };

  const now = new Date();
  const { data: old } = await admin.from("checks").select("kind").eq("item_id", part.id).order("written_at", { ascending: false }).limit(1).maybeSingle();
  // A new check, written by the person: the old one stays in the history (written before the code, by the verifier).
  await admin.from("checks").insert({ item_id: part.id, kind: old?.kind ?? "eval", description: after, written_by: ctx.name, written_at: now.toISOString(), locked: true });
  await admin
    .from("items")
    .update({
      proved_when: after,
      status: "building",
      status_detail: `Re-running its check · check edited by ${ctx.name}`,
      edited_at: now.toISOString(),
      ...(weakens ? { drop_reason: `Weakened: ${reason}` } : {}),
    })
    .eq("id", part.id);
  await admin.from("usage_ledger").insert({ workspace_id: ctx.workspace.id, project_id: part.project_id, item_id: part.id, kind: "change", credits: estimate.likely, note: `Check re-run · ${part.title}` });
  await admin.from("events").insert({
    project_id: part.project_id,
    item_id: part.id,
    type: "check.edited",
    actor: "user",
    actor_label: ctx.name,
    payload: { part_key: part.key, part_title: part.title, before: part.proved_when, after, prior_status: part.status, settle_at: new Date(now.getTime() + RECHECK_MS).toISOString(), settled: false, credits: estimate.likely } as unknown as Json,
  });
  await admin.from("audit_log").insert({
    workspace_id: ctx.workspace.id,
    actor: ctx.name,
    action: "check.edited",
    target: `${part.projects.name}: ${part.title}`,
    details: { before: part.proved_when, after, weakened: weakens, reason: weakens ? reason : null, credits: estimate.likely, simulated: true },
  });
  revalidatePath(`/p/${part.project_id}`);
  return { ok: true, credits: estimate.likely };
}
