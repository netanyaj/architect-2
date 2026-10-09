import "server-only";

import { prBranch, prChecks, prTitle, type PullRequestView } from "@/lib/pull-requests";
import type { AdminDb } from "./db";

/**
 * Opens the PR for a build or change on a project imported from a repo (Simulated, B-4): a branch for the version
 * and a PR into main listing the parts the run builds. Returns the PR number, or null when there's nothing to open.
 */
export async function openPullRequest(admin: AdminDb, runId: string): Promise<number | null> {
  const { data: run } = await admin.from("runs").select("id, project_id, blueprint_id, kind").eq("id", runId).maybeSingle();
  if (!run?.blueprint_id || (run.kind !== "build" && run.kind !== "change")) return null;
  const { data: project } = await admin.from("projects").select("id, name, repo_full_name").eq("id", run.project_id).maybeSingle();
  if (!project?.repo_full_name) return null;
  const [{ data: bp }, { data: items }, { data: existing }] = await Promise.all([
    admin.from("blueprints").select("version").eq("id", run.blueprint_id).single(),
    admin.from("items").select("key, title, status, position").eq("blueprint_id", run.blueprint_id).eq("status", "agreed").order("position"),
    admin.from("pull_requests").select("number").eq("project_id", project.id).order("number", { ascending: false }).limit(1),
  ]);
  const parts = (items ?? []).map((i) => ({ key: i.key, title: i.title }));
  if (!parts.length) return null;
  // Numbers continue the repo's own; the first is #12 (the repo has history before Architect).
  const number = (existing?.[0]?.number ?? 11) + 1;
  const { error } = await admin.from("pull_requests").insert({
    project_id: project.id,
    run_id: run.id,
    blueprint_id: run.blueprint_id,
    number,
    branch: prBranch(project.name, bp?.version ?? 1),
    title: prTitle(run.kind, parts),
    parts,
  });
  return error ? null : number;
}

/** A project's PRs, newest first, with each part's current status and tests (its check, written before the code). */
export async function loadPullRequests(admin: AdminDb, projectId: string, names: Map<string, string>): Promise<PullRequestView[]> {
  const { data: prs } = await admin
    .from("pull_requests")
    .select("id, number, branch, base, title, status, parts, blueprint_id, run_id, created_at, merged_at, merged_by")
    .eq("project_id", projectId)
    .order("number", { ascending: false });
  if (!prs?.length) return [];
  const blueprintIds = [...new Set(prs.map((p) => p.blueprint_id).filter(Boolean))] as string[];
  const runIds = [...new Set(prs.map((p) => p.run_id).filter(Boolean))] as string[];
  const [{ data: items }, { data: runs }, { data: approvals }, { data: rules }] = await Promise.all([
    admin.from("items").select("id, key, blueprint_id, status, checks(description, written_at)").in("blueprint_id", blueprintIds),
    runIds.length ? admin.from("runs").select("id, status").in("id", runIds) : Promise.resolve({ data: [] as { id: string; status: string }[] }),
    admin.from("approvals").select("payload, status, decided_by_name, decided_at, reason").eq("project_id", projectId).eq("kind", "push"),
    admin.from("allow_rules").select("removed_at").eq("project_id", projectId).eq("action", "push_to_main"),
  ]);
  const prOf = (a: { payload: unknown }) => (a.payload as { pr_id?: string } | null)?.pr_id;
  const requested = new Set((approvals ?? []).filter((a) => a.status === "waiting").map(prOf).filter(Boolean));
  const decided = (approvals ?? []).filter((a) => a.status !== "waiting").sort((a, b) => String(b.decided_at ?? "").localeCompare(String(a.decided_at ?? "")));
  const rule = (rules ?? []).some((r) => !r.removed_at);
  return prs.map((pr) => {
    const parts = ((pr.parts ?? []) as { key: string; title: string }[]).map((p) => {
      const item = (items ?? []).find((i) => i.blueprint_id === pr.blueprint_id && i.key === p.key);
      const checks = [...((item?.checks ?? []) as { description: string; written_at: string }[])].sort((a, b) => b.written_at.localeCompare(a.written_at));
      return { key: p.key, title: p.title, status: item?.status ?? "agreed", tests: checks.slice(0, 1).map((c) => c.description) };
    });
    const runStatus = (runs ?? []).find((r) => r.id === pr.run_id)?.status ?? null;
    return {
      id: pr.id,
      number: pr.number,
      branch: pr.branch,
      base: pr.base,
      title: pr.title,
      status: pr.status as PullRequestView["status"],
      checks: prChecks(runStatus, parts),
      parts,
      createdAt: pr.created_at,
      mergedAt: pr.merged_at,
      mergedBy: pr.merged_by ? (names.get(pr.merged_by) ?? "someone") : null,
      pushRequested: requested.has(pr.id),
      pushDecision: (() => {
        const d = decided.find((a) => prOf(a) === pr.id);
        return d ? { status: d.status as "approved" | "rejected", by: d.decided_by_name ?? "an admin", reason: d.reason } : null;
      })(),
      pushAllowed: rule || decided.some((a) => prOf(a) === pr.id && a.status === "approved"),
    };
  });
}
