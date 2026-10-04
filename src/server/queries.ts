import "server-only";

import type { IconName } from "@/components/ax/icon";
import { detectTools, projectIcon, summarizeProject, type ProjectInput, type ProjectSummary } from "@/lib/project-status";
import { createServerDb } from "./db";
import type { AppContext } from "./workspace";

/** First day of the current credit period, given the reset date (credits reset monthly). */
export function periodStart(resetOn: string): string {
  const reset = new Date(`${resetOn}T00:00:00Z`);
  const start = new Date(Date.UTC(reset.getUTCFullYear(), reset.getUTCMonth() - 1, reset.getUTCDate()));
  return start.toISOString();
}

/** "2026-11-01" → "1 Nov" */
export function formatResetDate(resetOn: string): string {
  const d = new Date(`${resetOn}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** What the side nav shows: counts and credits, all from the database under RLS. */
export async function getNavData(ctx: AppContext) {
  const db = await createServerDb();
  const ws = ctx.workspace.id;
  const [projects, approvals, usage] = await Promise.all([
    db.from("projects").select("id", { count: "exact", head: true }).eq("workspace_id", ws),
    db.from("approvals").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("status", "waiting"),
    db.from("usage_ledger").select("credits").eq("workspace_id", ws).gte("created_at", periodStart(ctx.workspace.creditsResetOn)),
  ]);
  const used = (usage.data ?? []).reduce((sum, r) => sum + Number(r.credits), 0);
  return {
    projectCount: projects.count ?? 0,
    approvalsWaiting: approvals.count ?? 0,
    credits: {
      left: Math.max(0, Math.round(ctx.workspace.creditsTotal - used)),
      total: ctx.workspace.creditsTotal,
      resetsOn: formatResetDate(ctx.workspace.creditsResetOn),
    },
  };
}

export type ProjectRow = {
  id: string;
  name: string;
  icon: IconName;
  ownerId: string | null;
  ownerName: string;
  updatedAt: string;
  creditsUsed: number;
  tools: string[];
  summary: ProjectSummary;
  prompt: string | null;
  budgetCredits: number | null;
};

/** Every project in the current workspace with its summary, newest first. */
export async function listProjects(ctx: AppContext): Promise<ProjectRow[]> {
  const db = await createServerDb();
  const ws = ctx.workspace.id;
  const [{ data: projects, error }, { data: owners }, { data: usage }] = await Promise.all([
    db
      .from("projects")
      .select("id, name, icon, status, owner_id, owner_display_name, updated_at, budget_credits, prompt, items(status, title, grp, blueprint_id), blueprints(id, version), runs(status, started_at)")
      .eq("workspace_id", ws)
      .order("updated_at", { ascending: false }),
    db.from("members").select("user_id, display_name").eq("workspace_id", ws).eq("status", "active"),
    db.from("usage_ledger").select("project_id, credits").eq("workspace_id", ws),
  ]);
  if (error) throw new Error(`Couldn't load projects: ${error.message}`);

  const spent = new Map<string, number>();
  for (const u of usage ?? []) if (u.project_id) spent.set(u.project_id, (spent.get(u.project_id) ?? 0) + Number(u.credits));

  return (projects ?? []).map((p) => {
    // Only the current (latest) version's parts count.
    const latest = [...(p.blueprints ?? [])].sort((a, b) => b.version - a.version)[0];
    const items = latest ? p.items.filter((i) => i.blueprint_id === latest.id) : [];
    const run = [...(p.runs ?? [])].sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""))[0];
    const ownerName =
      p.owner_display_name ??
      (p.owner_id === ctx.user.id ? ctx.name : owners?.find((o) => o.user_id === p.owner_id)?.display_name) ??
      "Someone";
    return {
      id: p.id,
      name: p.name,
      icon: projectIcon(p.icon),
      ownerId: p.owner_id,
      ownerName: ownerName.split(" ")[0],
      updatedAt: p.updated_at,
      creditsUsed: Math.round(spent.get(p.id) ?? 0),
      tools: detectTools([p.prompt, ...items.map((i) => i.title)]),
      summary: summarizeProject({
        status: p.status as ProjectInput["status"],
        budgetCredits: p.budget_credits === null ? null : Number(p.budget_credits),
        items,
        runStatus: run?.status,
        prompt: p.prompt,
      }),
      prompt: p.prompt,
      budgetCredits: p.budget_credits === null ? null : Number(p.budget_credits),
    };
  });
}

/** Credits used in the current period (for "372 credits used this month"). */
export async function creditsUsedThisPeriod(ctx: AppContext): Promise<number> {
  const db = await createServerDb();
  const { data } = await db
    .from("usage_ledger")
    .select("credits")
    .eq("workspace_id", ctx.workspace.id)
    .gte("created_at", periodStart(ctx.workspace.creditsResetOn));
  return Math.round((data ?? []).reduce((s, r) => s + Number(r.credits), 0));
}
