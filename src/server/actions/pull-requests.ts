"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { mergeBlocker } from "@/lib/pull-requests";
import { canBuild, canManageMembers } from "@/lib/permissions";
import { createAdminDb } from "../db";
import { loadPullRequests } from "../pull-requests";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";

/**
 * Merge a PR into main: the push to main, which always needs the person's click (Simulated: nothing is written to
 * GitHub). Under governance a Builder's click asks an Owner or Admin instead (the permission rule on push).
 */
export async function mergePullRequest(input: { prId: string }): Promise<ActionResult<{ requested: boolean }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't merge pull requests." };
  if (!z.string().uuid().safeParse(input.prId).success) return { ok: false, message: "That pull request isn't here." };
  const admin = createAdminDb();
  const { data: row } = await admin.from("pull_requests").select("id, number, branch, project_id, projects!inner(id, name, workspace_id)").eq("id", input.prId).maybeSingle();
  if (!row || row.projects.workspace_id !== ctx.workspace.id) return { ok: false, message: "That pull request isn't here." };
  const pr = (await loadPullRequests(admin, row.project_id, new Map())).find((p) => p.id === row.id);
  if (!pr) return { ok: false, message: "That pull request isn't here." };
  const owner = !ctx.workspace.governanceEnabled || canManageMembers(ctx.role) || pr.pushAllowed;
  const blocked = mergeBlocker(pr, owner);
  if (blocked) return { ok: false, message: blocked };

  if (!owner) {
    if (!pr.pushRequested) {
      await admin.from("approvals").insert({
        workspace_id: ctx.workspace.id,
        project_id: row.project_id,
        kind: "push",
        status: "waiting",
        title: `${row.projects.name}: push PR #${row.number} to main`,
        requested_by: ctx.user.id,
        payload: { pr_id: row.id, pr_number: row.number, branch: row.branch, requested_by_name: ctx.name.split(" ")[0] },
      });
    }
    return { ok: true, requested: true };
  }
  const { error } = await admin.from("pull_requests").update({ status: "merged", merged_by: ctx.user.id, merged_at: new Date().toISOString() }).eq("id", row.id).eq("status", "open");
  if (error) return { ok: false, message: "The pull request couldn't be merged. Try again." };
  await admin.from("approvals").update({ status: "approved", decided_by: ctx.user.id, decided_at: new Date().toISOString() }).eq("project_id", row.project_id).eq("kind", "push").eq("status", "waiting").contains("payload", { pr_id: row.id });
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "pr.merged", target: `${row.projects.name} PR #${row.number}`, details: { branch: row.branch, simulated: true } });
  revalidatePath(`/p/${row.project_id}`);
  return { ok: true, requested: false };
}
