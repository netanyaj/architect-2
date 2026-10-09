import "server-only";

import { matchBehaviour, type BehaviourPart, type RepoAnalysis } from "@/lib/repo-analysis";
import type { AdminDb } from "./db";
import { createServerDb } from "./db";
import { installUrl, manageUrl } from "./github";
import type { AppContext } from "./workspace";

/** What an import saves in repo_imports.analysis. */
export type SavedImport = { analysis: RepoAnalysis; behaviour: BehaviourPart[]; behaviourError: string | null; port?: boolean; runCommand?: string | null };

export type ImportInstallation = { installationId: number; accountLogin: string; accountType: string; manageUrl: string };

export type ImportPageData = {
  installations: ImportInstallation[];
  installUrl: string | null;
  /** Repos already imported as projects in this workspace: full name → project id. */
  imported: Record<string, string>;
  canAct: boolean;
};

/** The import page: the workspace's confirmed installations (read under RLS) and repos already imported. */
export async function importPageData(ctx: AppContext): Promise<ImportPageData> {
  const db = await createServerDb();
  const [{ data: installs }, { data: projects }] = await Promise.all([
    db.from("github_installations").select("installation_id, account_login, account_type").eq("workspace_id", ctx.workspace.id).order("created_at"),
    db.from("projects").select("id, repo_full_name").eq("workspace_id", ctx.workspace.id).not("repo_full_name", "is", null),
  ]);
  let url: string | null = null;
  try {
    url = installUrl();
  } catch {
    url = null;
  }
  return {
    installations: (installs ?? []).map((i) => {
      const base = { installationId: Number(i.installation_id), accountLogin: i.account_login, accountType: i.account_type };
      return { ...base, manageUrl: manageUrl(base) };
    }),
    installUrl: url,
    imported: Object.fromEntries((projects ?? []).map((p) => [p.repo_full_name!, p.id])),
    canAct: ctx.role !== "viewer",
  };
}

/**
 * After a plan from a repo is written: each plan part that is today's behaviour and has tests gets those tests as
 * its check and proof, and Works (B-2). A part whose test the code marks as failing keeps its proof but stays to
 * build, so Build fixes it. Agent parts that are the repo's CrewAI or LangGraph agents keep that framework.
 * Returns the keys of parts that already work (Build doesn't charge for them).
 */
export async function applyRepoProofs(admin: AdminDb, input: { projectId: string; blueprintId: string }): Promise<Set<string>> {
  const works = new Set<string>();
  const { data: imp } = await admin.from("repo_imports").select("full_name, analysis").eq("project_id", input.projectId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const saved = (imp?.analysis ?? null) as SavedImport | null;
  if (!saved?.analysis) return works;
  const { data: items } = await admin.from("items").select("id, key, title, description, grp, framework").eq("blueprint_id", input.blueprintId);
  const now = Date.now();
  for (const item of items ?? []) {
    const part = matchBehaviour(item.title, saved.behaviour);
    // The repo's own agents keep their framework: the part names the agent (checked against the code), or its words do.
    if (item.grp === "agents") {
      const text = `${item.title} ${item.description ?? ""}`.toLowerCase();
      const found =
        saved.analysis.agents.find((a) => a.framework !== "lyzr" && a.name === part?.agent) ??
        saved.analysis.agents.find((a) => a.framework !== "lyzr" && (text.includes(a.name.toLowerCase()) || (a.role !== null && text.includes(a.role.toLowerCase())) || text.includes(a.framework)));
      const framework = found ? found.framework : item.framework === "crewai" || item.framework === "langgraph" ? "lyzr" : item.framework;
      if (framework !== item.framework) await admin.from("items").update({ framework }).eq("id", item.id);
    }
    if (!part?.tests.length) continue;
    const tests = saved.analysis.tests.filter((t) => part.tests.includes(t.name));
    if (!tests.length) continue;
    const failing = tests.filter((t) => t.knownFailing);
    const files = Array.from(new Set(tests.map((t) => t.file)));
    const { data: check } = await admin
      .from("checks")
      .insert({
        item_id: item.id,
        kind: files.some((f) => /e2e|playwright|cypress|\.spec\./.test(f)) ? "ui_test" : "api_test",
        description: `Your tests in ${files.join(", ")}: ${tests.map((t) => `"${t.name}"`).join(", ")}`,
        written_by: "your tests",
        written_at: new Date(now - 1000).toISOString(),
      })
      .select("id")
      .single();
    const passed = tests.length - failing.length;
    await admin.from("proofs").insert({
      item_id: item.id,
      check_id: check?.id ?? null,
      attempt: 0,
      result: failing.length ? "fail" : "pass",
      assertions_passed: passed,
      assertions_total: tests.length,
      summary: failing.length
        ? `${passed} of ${tests.length} of your tests pass; "${failing[0].name}" is marked as failing in your code`
        : `${tests.length} of your tests prove it`,
      log: "From the repo. Running them is simulated in this prototype.",
    });
    if (failing.length) {
      await admin.from("items").update({ status_detail: `Your test "${failing[0].name}" fails today. Build fixes it.` }).eq("id", item.id);
    } else {
      await admin.from("items").update({ status: "built", status_detail: `Works today · ${tests.length} of your tests`, estimate_low: 0, estimate_likely: 0, estimate_high: 0, est_seconds: 0 }).eq("id", item.id);
      works.add(item.key);
    }
  }
  return works;
}
