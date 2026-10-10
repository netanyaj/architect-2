"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { editProblem } from "@/lib/code-edits";
import { canBuild } from "@/lib/permissions";
import { recordCodeEdit, settleCodeEdits } from "../code-edits";
import { createAdminDb, createServerDb } from "../db";
import { GitHubProblem, readFileAt, readTreeAt, VIEW_MAX_BYTES } from "../github";
import type { SavedImport } from "../import";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";

/* Developer view on an imported project: the repo's real files at the imported commit, read through the GitHub App.
   Read-only, for anyone who can see the project (Viewers too). */

const uuid = z.string().uuid();
const filePath = z.string().min(1).max(500).refine((p) => !p.split("/").some((s) => s === ".." || s === "." || s === ""), "Not a file path.");

export type RepoView = {
  repo: string;
  branch: string;
  commit: string;
  entries: { path: string; size: number }[];
  truncated: boolean;
  keys: { name: string; service: string | null; lyzrInstead: boolean }[];
  testCommand: string | null;
};

/** The project's import and its installation, if this person can see the project and the workspace still has it. */
async function importOf(projectId: string) {
  if (!uuid.safeParse(projectId).success) return null;
  const db = await createServerDb();
  const { data: project } = await db.from("projects").select("id, workspace_id, repo_full_name").eq("id", projectId).maybeSingle();
  if (!project?.repo_full_name) return null;
  const admin = createAdminDb();
  const { data: imp } = await admin
    .from("repo_imports")
    .select("full_name, branch, commit_sha, installation_id, analysis")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!imp?.installation_id || !imp.commit_sha) return null;
  const { data: install } = await admin
    .from("github_installations")
    .select("installation_id")
    .eq("workspace_id", project.workspace_id)
    .eq("installation_id", imp.installation_id)
    .maybeSingle();
  return { imp, installed: Boolean(install) };
}

const LOST = "This workspace isn't connected to the GitHub account this repo came from any more. Connect it again from Import a repo.";

export async function loadRepoView(input: { projectId: string }): Promise<ActionResult<{ view: RepoView }>> {
  const found = await importOf(input.projectId);
  if (!found) return { ok: false, message: "This project wasn't imported from a repo." };
  if (!found.installed) return { ok: false, message: LOST };
  const { imp } = found;
  try {
    const tree = await readTreeAt(Number(imp.installation_id), imp.full_name, imp.commit_sha!);
    const saved = imp.analysis as unknown as SavedImport | null;
    return {
      ok: true,
      view: {
        repo: imp.full_name,
        branch: imp.branch,
        commit: imp.commit_sha!,
        entries: tree.entries,
        truncated: tree.truncated,
        keys: saved?.analysis.keys ?? [],
        testCommand: saved?.analysis.testCommand ?? null,
      },
    };
  } catch (err) {
    return { ok: false, message: err instanceof GitHubProblem ? err.message : "GitHub didn't answer. Try again in a minute." };
  }
}

export async function loadRepoFile(input: { projectId: string; path: string }): Promise<ActionResult<{ file: { kind: "text"; text: string } | { kind: "large" | "binary"; size: number } }>> {
  if (!filePath.safeParse(input.path).success) return { ok: false, message: "That file isn't in this repo." };
  const found = await importOf(input.projectId);
  if (!found) return { ok: false, message: "This project wasn't imported from a repo." };
  if (!found.installed) return { ok: false, message: LOST };
  try {
    const file = await readFileAt(Number(found.imp.installation_id), found.imp.full_name, found.imp.commit_sha!, input.path);
    return { ok: true, file };
  } catch (err) {
    return { ok: false, message: err instanceof GitHubProblem ? err.message : `GitHub didn't answer. Try again in a minute. Files over ${VIEW_MAX_BYTES / 1024} KB aren't shown.` };
  }
}

const editInput = z.object({
  projectId: uuid,
  path: filePath,
  partKey: z.string().min(1).max(120),
  before: z.string().max(200_000),
  content: z.string().max(200_000),
});

/**
 * Save an edit made in Developer view (simulated: nothing is written to a repo). The edit names the part it belongs
 * to; that part's check runs again, and only the checker marks it Works (the same rule as a coding agent's change).
 * On a project from a repo, the edit goes on the open pull request, or a new one.
 */
export async function saveCodeEdit(raw: z.input<typeof editInput>): Promise<ActionResult<{ prNumber: number | null; rechecks: boolean }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can read the code but can't change it." };
  const parsed = editInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That file can't be edited." };
  const { projectId, path, partKey, before, content } = parsed.data;
  const problem = editProblem(path, content, before);
  if (problem) return { ok: false, message: problem };
  const admin = createAdminDb();
  const { data: project } = await admin.from("projects").select("id, name, workspace_id, repo_full_name, current_version").eq("id", projectId).maybeSingle();
  if (!project || project.workspace_id !== ctx.workspace.id) return { ok: false, message: "That project isn't in this workspace." };
  const { data: running } = await admin.from("runs").select("id").eq("project_id", projectId).in("status", ["queued", "running"]).limit(1);
  if (running?.length) return { ok: false, message: "A build is running. Save the edit when it finishes." };
  const { data: bp } = await admin.from("blueprints").select("id, version").eq("project_id", projectId).order("version", { ascending: false }).limit(1).maybeSingle();
  if (!bp) return { ok: false, message: "Write the plan first: an edit belongs to one of its parts." };
  const { data: part } = await admin.from("items").select("id, key, title, status").eq("blueprint_id", bp.id).eq("key", partKey).maybeSingle();
  if (!part || part.status === "dropped") return { ok: false, message: "Pick one of the plan's parts for this edit." };

  const r = await recordCodeEdit(admin, {
    projectId,
    projectName: project.name,
    repo: project.repo_full_name,
    version: bp.version,
    blueprintId: bp.id,
    part,
    path,
    before,
    content,
    actor: { userId: ctx.user.id, name: ctx.name, kind: "person" },
  });
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "code.edited", target: `${project.name}: ${path}`, details: { part: part.title, pr: r.prNumber, simulated: true } });
  revalidatePath(`/p/${projectId}`);
  return { ok: true, ...r };
}

/** Called by the page when an edit's re-run check is due, so the part's state moves on without a reload. */
export async function settleEdits(input: { projectId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!uuid.safeParse(input.projectId).success) return { ok: false, message: "That project isn't in this workspace." };
  const admin = createAdminDb();
  const { data: project } = await admin.from("projects").select("workspace_id").eq("id", input.projectId).maybeSingle();
  if (!project || project.workspace_id !== ctx.workspace.id) return { ok: false, message: "That project isn't in this workspace." };
  await settleCodeEdits(admin, input.projectId);
  revalidatePath(`/p/${input.projectId}`);
  return { ok: true };
}
