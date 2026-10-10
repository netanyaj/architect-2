"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Json } from "@/lib/database.types";
import { canBuild, canManageMembers } from "@/lib/permissions";
import { providerName } from "@/lib/providers";
import { createAdminDb } from "../db";
import { externalCallHolds, loadPolicies } from "../policy";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";

/* The external-calls rule (C-10), from Launch: a part that calls an outside service with an API key waits for an
   Owner or Admin's OK before Live. An Owner or Admin allows it here for this project (an allow-rule, audited); a
   Builder asks, and the request lands in Approvals. Simulated: no call is made either way. */

const input = z.object({ projectId: z.string().uuid(), provider: z.string().min(1).max(60), why: z.string().max(300).optional() });

export async function allowExternalCall(raw: z.input<typeof input>): Promise<ActionResult<{ asked: boolean }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't change what a project may call." };
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That project isn't in this workspace." };
  const { projectId, provider } = parsed.data;
  const admin = createAdminDb();
  const { data: project } = await admin.from("projects").select("id, name, workspace_id").eq("id", projectId).maybeSingle();
  if (!project || project.workspace_id !== ctx.workspace.id) return { ok: false, message: "That project isn't in this workspace." };
  const { data: bp } = await admin.from("blueprints").select("id").eq("project_id", projectId).order("version", { ascending: false }).limit(1).maybeSingle();
  const { data: parts } = bp ? await admin.from("items").select("title, status, provider").eq("blueprint_id", bp.id) : { data: [] };
  const holds = await externalCallHolds(admin, ctx.workspace.id, projectId, parts ?? [], await loadPolicies(admin, ctx.workspace.id));
  const hold = holds.find((h) => h.provider === provider);
  const name = providerName(provider);
  if (!hold) return { ok: false, message: `${name} doesn't need an admin's OK in ${project.name} any more.` };

  if (canManageMembers(ctx.role)) {
    await admin.from("allow_rules").insert({ workspace_id: ctx.workspace.id, action: "external_call", project_id: projectId, target: provider, reason: "Allowed from Launch", created_by: ctx.user.id, created_by_name: ctx.name });
    await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "rule.created", target: `${project.name}: ${name} called with a key`, details: { action: "external_call", provider, simulated: true } as Json });
    revalidatePath(`/p/${projectId}/launch`);
    return { ok: true, asked: false };
  }
  if (hold.waiting) return { ok: false, message: "Your request is waiting for an Owner or Admin." };
  await admin.from("approvals").insert({
    workspace_id: ctx.workspace.id,
    project_id: projectId,
    kind: "external_call",
    status: "waiting",
    title: `${project.name}: call ${name} with a key`,
    requested_by: ctx.user.id,
    payload: { provider, parts: hold.parts, requested_by_name: ctx.name, why: parsed.data.why ?? null } as Json,
  });
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "approval.requested", target: `${project.name}: call ${name} with a key`, details: { kind: "external_call", provider, simulated: true } as Json });
  revalidatePath(`/p/${projectId}/launch`);
  revalidatePath("/governance/approvals");
  return { ok: true, asked: true };
}
