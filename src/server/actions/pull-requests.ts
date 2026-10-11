"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { mergeBlocker, prBranch, prTitle } from "@/lib/pull-requests";
import { canBuild, canManageMembers } from "@/lib/permissions";
import { createAdminDb } from "../db";
import { loadPolicies } from "../policy";
import { loadCodeEdits } from "../code-edits";
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
  // The permission rule on pushes to main (C-10): off, a Builder merges without asking.
  const { permissions } = await loadPolicies(admin, ctx.workspace.id);
  const owner = !ctx.workspace.governanceEnabled || canManageMembers(ctx.role) || pr.pushAllowed || !permissions.push;
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

/**
 * Open PR from Developer view (Simulated, B-4): on a project from a repo, a pull request from the branch into main
 * listing the parts with changes (code edits, else the latest version's built parts). One open PR at a time; nothing
 * is written to GitHub. Builders and up.
 */
export async function openPullRequestNow(input: { projectId: string }): Promise<ActionResult<{ number: number }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't open pull requests." };
  if (!z.string().uuid().safeParse(input.projectId).success) return { ok: false, message: "That project isn't in this workspace." };
  const admin = createAdminDb();
  const { data: project } = await admin.from("projects").select("id, name, workspace_id, repo_full_name").eq("id", input.projectId).maybeSingle();
  if (!project || project.workspace_id !== ctx.workspace.id) return { ok: false, message: "That project isn't in this workspace." };
  if (!project.repo_full_name) return { ok: false, message: "Only a project from a repo has pull requests." };
  const { data: prs } = await admin.from("pull_requests").select("number, status").eq("project_id", project.id).order("number", { ascending: false });
  const open = (prs ?? []).find((p) => p.status === "open");
  if (open) return { ok: false, message: `PR #${open.number} is already open. Merge it first, or add to it.` };
  const { data: bp } = await admin.from("blueprints").select("id, version").eq("project_id", project.id).order("version", { ascending: false }).limit(1).maybeSingle();
  if (!bp) return { ok: false, message: "Write the plan first." };
  const { files } = await loadCodeEdits(admin, project.id);
  const { data: items } = await admin.from("items").select("key, title, status, status_detail").eq("blueprint_id", bp.id).order("position");
  const editedKeys = new Set(files.map((f) => f.partKey));
  const parts = (items ?? [])
    .filter((i) => (editedKeys.size ? editedKeys.has(i.key) : ["built", "sample_data", "needs_connection"].includes(i.status) && !(i.status_detail ?? "").startsWith("Works today")))
    .map((i) => ({ key: i.key, title: i.title }));
  if (!parts.length) return { ok: false, message: "Nothing has changed on the branch yet. Build, or edit a file, first." };
  const number = (prs?.[0]?.number ?? 11) + 1;
  const used = (prs ?? []).length > 0;
  const { error } = await admin.from("pull_requests").insert({
    project_id: project.id,
    blueprint_id: bp.id,
    number,
    branch: `${prBranch(project.name, bp.version)}${used ? `-${number}` : ""}`,
    title: prTitle(editedKeys.size ? "change" : "build", parts).replace(/^(Build|Change): /, "Developer view: "),
    parts,
  });
  if (error) return { ok: false, message: "The pull request couldn't be opened. Try again." };
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "pr.opened", target: `${project.name} PR #${number}`, details: { parts: parts.length, simulated: true } });
  revalidatePath(`/p/${project.id}`);
  return { ok: true, number };
}
