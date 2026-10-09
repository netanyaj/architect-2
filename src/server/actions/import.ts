"use server";

import { z } from "zod";
import { askObject, GatewayRateLimited, GatewaySlow, GatewayUnavailable } from "@/lib/gateway";
import { DEFAULT_MODEL } from "@/lib/models";
import { canBuild } from "@/lib/permissions";
import { analyzeRepo, checkBehaviour, repoPlanRequest, type BehaviourPart, type RepoAnalysis } from "@/lib/repo-analysis";
import { createAdminDb } from "../db";
import { GitHubProblem, listBranches, listRepos, readRepoFiles, readTree, type RepoSummary } from "../github";
import type { SavedImport } from "../import";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";

const BUILDERS_ONLY = "Viewers can't import repos. Ask an Owner, Admin or Builder.";
// "owner/repo"; neither part may be "." or "..".
const repoName = z.string().regex(/^(?!\.\.?\/)[\w.-]+\/(?!\.\.?$)[\w.-]+$/);
const branchName = z.string().min(1).max(250).regex(/^[^\s~^:?*[\\]+$/);
const folderName = z.string().max(300).regex(/^\/[\w./ -]*$/);

/** The installation, if this workspace has it (confirmed through the person's GitHub sign-in). */
async function installationOf(workspaceId: string, installationId: number) {
  if (!Number.isSafeInteger(installationId) || installationId <= 0) return null;
  const { data } = await createAdminDb()
    .from("github_installations")
    .select("installation_id")
    .eq("workspace_id", workspaceId)
    .eq("installation_id", installationId)
    .maybeSingle();
  return data ? Number(data.installation_id) : null;
}

const problem = (err: unknown) => (err instanceof GitHubProblem ? err.message : "GitHub didn't answer. Nothing was lost. Try again in a minute.");
const NOT_CONNECTED = "This workspace isn't connected to that GitHub account. Install the GitHub App, or connect it again.";

/** The repos one installation can read. */
export async function importRepos(input: { installationId: number }): Promise<ActionResult<{ repos: RepoSummary[] }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: BUILDERS_ONLY };
  const id = await installationOf(ctx.workspace.id, input.installationId);
  if (!id) return { ok: false, message: NOT_CONNECTED };
  try {
    const repos = await listRepos(id);
    if (!repos.length) return { ok: false, message: "The GitHub App can't read any repos yet. Add one with Install on more repos." };
    return { ok: true, repos };
  } catch (err) {
    return { ok: false, message: problem(err) };
  }
}

/** A repo's branches, and the folders on one branch (for the subfolder picker). */
export async function importRepoDetails(input: { installationId: number; repo: string; branch?: string }): Promise<ActionResult<{ branches: string[]; branch: string; folders: string[] }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: BUILDERS_ONLY };
  if (!repoName.safeParse(input.repo).success || (input.branch !== undefined && !branchName.safeParse(input.branch).success)) return { ok: false, message: "Choose a repo and branch from the list." };
  const id = await installationOf(ctx.workspace.id, input.installationId);
  if (!id) return { ok: false, message: NOT_CONNECTED };
  try {
    const branches = await listBranches(id, input.repo);
    if (!branches.length) return { ok: false, message: `${input.repo} is empty, so there's nothing to import yet. Push some code to it, then try again.` };
    const repos = await listRepos(id);
    const fallback = repos.find((r) => r.fullName === input.repo)?.defaultBranch ?? branches[0];
    const branch = input.branch && branches.includes(input.branch) ? input.branch : branches.includes(fallback) ? fallback : branches[0];
    const tree = await readTree(id, input.repo, branch);
    const folders = tree.folders.filter((f) => f.split("/").length <= 2).sort();
    return { ok: true, branches, branch, folders };
  } catch (err) {
    return { ok: false, message: problem(err) };
  }
}

const Behaviour = z.object({
  parts: z.array(z.object({ title: z.string(), description: z.string(), tests: z.array(z.string()), agent: z.string() })),
});

const BEHAVIOUR_INSTRUCTIONS = `You describe what an existing app does today, for a plan that keeps it working.
Return 3 to 8 parts of its current behaviour. Each part does one thing a person using the app would notice.
Split different outcomes into separate parts: when tests check different outcomes (for example one test checks a
priority and another checks a team), they belong to different parts ("Sort tickets by urgency", "Send to the right team").
An AI agent in the code is a part of its own, apart from any rule-based code that does a similar job; tests of
rule-based code never belong to the agent's part.
- title: plain words, sentence case, at most 6 words, no code names.
- description: one sentence on what it does today.
- tests: the exact names of the listed tests that check this part. Use only names from the list, each test at most once. Leave it empty if no test checks it.
- agent: for each AI agent listed, one part is that agent; give its exact name here. Otherwise an empty string.
Never invent tests, files or features that aren't in the analysis.`;

function behaviourPrompt(repo: string, a: RepoAnalysis): string {
  return [
    `Repo: ${repo}`,
    `Stack: ${a.stack}`,
    a.readme ? `README: ${a.readme}` : "",
    a.routes.length ? `API routes: ${a.routes.join("; ")}` : "",
    a.agents.length ? `AI agents: ${a.agents.map((g) => `${g.name} (${g.framework}${g.role ? `, ${g.role}` : ""}) in ${g.file}`).join("; ")}` : "",
    a.knownIssues.length ? `Known issues: ${a.knownIssues.join("; ")}` : "",
    `Tests (${a.tests.length}):`,
    ...a.tests.map((t) => `- "${t.name}" in ${t.file}`),
  ]
    .filter(Boolean)
    .join("\n");
}

export type ImportView = { importId: string; repo: string; branch: string; folder: string; sha: string; analysis: RepoAnalysis; behaviour: BehaviourPart[]; behaviourError: string | null };

/**
 * Understand it (B-2): read the tree and key files within the caps, run static analysis, then ask the gateway to
 * describe today's behaviour as parts with the tests that prove them (the model labels; the server keeps only tests
 * that exist). Saved as an import in this workspace. Reading GitHub is real; nothing is changed in the repo.
 */
export async function analyzeImport(input: { installationId: number; repo: string; branch: string; folder: string }): Promise<ActionResult<{ view: ImportView }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: BUILDERS_ONLY };
  if (!repoName.safeParse(input.repo).success || !branchName.safeParse(input.branch).success || !folderName.safeParse(input.folder).success || input.folder.includes("..")) {
    return { ok: false, message: "Choose a repo, branch and folder from the lists." };
  }
  const id = await installationOf(ctx.workspace.id, input.installationId);
  if (!id) return { ok: false, message: NOT_CONNECTED };

  let analysis: RepoAnalysis;
  let sha: string;
  try {
    const tree = await readTree(id, input.repo, input.branch);
    sha = tree.sha;
    const read = await readRepoFiles(id, input.repo, tree.sha, tree.entries, input.folder);
    analysis = analyzeRepo({ paths: read.paths, files: read.files, skippedLarge: read.skippedLarge, truncated: tree.truncated });
  } catch (err) {
    return { ok: false, message: problem(err) };
  }

  let behaviour: BehaviourPart[] = [];
  let behaviourError: string | null = null;
  try {
    const r = await askObject({ instructions: BEHAVIOUR_INSTRUCTIONS, prompt: behaviourPrompt(input.repo, analysis), schema: Behaviour, model: DEFAULT_MODEL, fast: true });
    behaviour = checkBehaviour(r.object.parts, analysis.tests, analysis.agents);
  } catch (err) {
    behaviourError =
      err instanceof GatewayRateLimited || err instanceof GatewaySlow || err instanceof GatewayUnavailable
        ? `${err.message} The analysis above is complete; try Understand it again for what it does today.`
        : "Architect couldn't describe what it does today. The analysis above is complete; try again.";
  }

  const saved: SavedImport = { analysis, behaviour, behaviourError };
  const { data: row, error } = await createAdminDb()
    .from("repo_imports")
    .insert({ workspace_id: ctx.workspace.id, installation_id: id, full_name: input.repo, branch: input.branch, folder: input.folder, commit_sha: sha, analysis: saved as unknown as import("@/lib/database.types").Json, created_by: ctx.user.id })
    .select("id")
    .single();
  if (error || !row) return { ok: false, message: "The analysis couldn't be saved. Try again." };
  return { ok: true, view: { importId: row.id, repo: input.repo, branch: input.branch, folder: input.folder, sha, analysis, behaviour, behaviourError } };
}

/**
 * Write the plan: makes the project from the import (keeping the repo's stack, B-8) with a request built from the
 * analysis, and opens it, where the plan is written as any other (M2). Nothing is built: Build still waits for a
 * click. A repo Architect can't run as it is needs Configure (a start command) or Port (consent) first (B-3).
 */
export async function planFromImport(input: { importId: string; port?: boolean; runCommand?: string }): Promise<ActionResult<{ projectId: string }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: BUILDERS_ONLY };
  if (!z.string().uuid().safeParse(input.importId).success) return { ok: false, message: "That import isn't here. Start again." };
  const admin = createAdminDb();
  const { data: imp } = await admin.from("repo_imports").select("id, full_name, branch, folder, analysis, project_id").eq("id", input.importId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!imp?.analysis) return { ok: false, message: "That import isn't here. Start again." };
  if (imp.project_id) return { ok: true, projectId: imp.project_id };
  const saved = imp.analysis as unknown as SavedImport;
  const runCommand = input.runCommand?.trim().slice(0, 200) || null;
  if (!saved.analysis.runnable.ok && !input.port && !runCommand) {
    return { ok: false, message: `Choose Configure or Port first: ${saved.analysis.runnable.reason}` };
  }
  const port = Boolean(input.port);
  const prompt = repoPlanRequest({ repo: imp.full_name, branch: imp.branch, folder: imp.folder, analysis: saved.analysis, behaviour: saved.behaviour, port });
  const { data: project, error } = await admin
    .from("projects")
    .insert({
      workspace_id: ctx.workspace.id,
      name: imp.full_name.split("/")[1],
      owner_id: ctx.user.id,
      prompt,
      status: "draft",
      model: DEFAULT_MODEL,
      icon: "repo",
      stack: port ? "default" : saved.analysis.stack,
      repo_full_name: imp.full_name,
    })
    .select("id")
    .single();
  if (error || !project) return { ok: false, message: "The project couldn't be created. Nothing was charged. Try again." };
  await admin
    .from("repo_imports")
    .update({ project_id: project.id, analysis: { ...saved, port, runCommand } as unknown as import("@/lib/database.types").Json })
    .eq("id", imp.id);
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "repo.imported", target: imp.full_name, details: { branch: imp.branch, folder: imp.folder, port } });
  return { ok: true, projectId: project.id };
}
