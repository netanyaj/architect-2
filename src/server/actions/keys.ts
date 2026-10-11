"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { KEY_ENV_LABEL, keyValueProblem, type KeyEnv } from "@/lib/keys";
import { canBuild, canManageMembers } from "@/lib/permissions";
import { createAdminDb } from "../db";
import { loadPolicies } from "../policy";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";

const input = z.object({
  projectId: z.string().uuid(),
  name: z.string().max(64),
  environment: z.enum(["preview", "staging", "production"]),
  value: z.string().max(5000),
});

/**
 * Set a key for one version (Keys and passwords, C-10). Since M5.10 the value is kept, encrypted at rest in Vault,
 * and never read back or shown again: the page only knows it's set, by whom and when. Nothing is logged. Under
 * governance, with the rule on Live keys, a Builder's key for Live waits for an Owner or Admin (an approval request).
 */
export async function setProjectKey(raw: z.input<typeof input>): Promise<ActionResult<{ waiting: boolean }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't set keys. Ask an Owner, Admin or Builder." };
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That key isn't valid." };
  const { projectId, name, environment } = parsed.data;
  const problem = keyValueProblem(name, parsed.data.value);
  if (problem) return { ok: false, message: problem };
  const admin = createAdminDb();
  const { data: project } = await admin.from("projects").select("id, name, workspace_id").eq("id", projectId).maybeSingle();
  if (!project || project.workspace_id !== ctx.workspace.id) return { ok: false, message: "That project isn't in this workspace." };

  const { data: existing } = await admin.from("project_keys").select("id, status").eq("project_id", projectId).eq("name", name).eq("environment", environment).maybeSingle();
  if (existing?.status === "waiting") return { ok: false, message: "This key is already waiting for an Owner or Admin." };
  const { permissions } = await loadPolicies(admin, ctx.workspace.id);
  const waiting = environment === "production" && permissions.secrets && !canManageMembers(ctx.role);
  const now = new Date().toISOString();
  let approvalId: string | null = null;
  if (waiting) {
    const { data: approval } = await admin
      .from("approvals")
      .insert({
        workspace_id: ctx.workspace.id,
        project_id: projectId,
        kind: "secret",
        status: "waiting",
        title: `${project.name}: ${name} for Live`,
        requested_by: ctx.user.id,
        payload: { key: name, environment, requested_by_name: ctx.name },
      })
      .select("id")
      .single();
    approvalId = approval?.id ?? null;
  }
  const row = { project_id: projectId, name, environment, status: waiting ? "waiting" : "set", set_by: ctx.user.id, set_by_name: ctx.name, set_at: now, approval_id: approvalId };
  const saved = existing ? await admin.from("project_keys").update(row).eq("id", existing.id).select("id").single() : await admin.from("project_keys").insert(row).select("id").single();
  if (saved.error || !saved.data) return { ok: false, message: "The key couldn't be saved. Nothing was stored. Try again." };
  const { error: vaultError } = await admin.rpc("set_project_key_value", { p_key: saved.data.id, p_value: parsed.data.value });
  if (vaultError) {
    // Never "set" without its value: undo the row (or put the old one back) and say so.
    if (existing) await admin.from("project_keys").update({ status: existing.status }).eq("id", existing.id);
    else await admin.from("project_keys").delete().eq("id", saved.data.id);
    return { ok: false, message: "The key couldn't be stored safely. Nothing was saved. Try again." };
  }
  await admin.from("audit_log").insert({
    workspace_id: ctx.workspace.id,
    actor: ctx.name,
    action: waiting ? "key.requested" : "key.set",
    target: `${project.name}: ${name} (${KEY_ENV_LABEL[environment as KeyEnv]})`,
    details: { environment, encrypted: true },
  });
  revalidatePath(`/p/${projectId}/launch`);
  return { ok: true, waiting };
}
