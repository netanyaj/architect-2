import "server-only";

import type { IconName } from "@/components/ax/icon";
import { detectTools, projectIcon, summarizeProject, type ProjectInput, type ProjectSummary } from "@/lib/project-status";
import { canBuild } from "@/lib/permissions";
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
  const [projects, approvals, usage, members, trash] = await Promise.all([
    db.from("projects").select("id", { count: "exact", head: true }).eq("workspace_id", ws),
    db.from("approvals").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("status", "waiting"),
    db.from("usage_ledger").select("credits").eq("workspace_id", ws).gte("created_at", periodStart(ctx.workspace.creditsResetOn)),
    db.from("members").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("status", "active"),
    // Trash (M5.8): what this person may restore. Viewers never delete, so they have none.
    canBuild(ctx.role) ? db.rpc("list_deleted_projects", { p_workspace: ws }) : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const used = (usage.data ?? []).reduce((sum, r) => sum + Number(r.credits), 0);
  return {
    projectCount: projects.count ?? 0,
    approvalsWaiting: approvals.count ?? 0,
    memberCount: members.count ?? 1,
    trashCount: (trash.data ?? []).length,
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
  /** Service ids its current parts use ("hubspot", "clearbit"). */
  providers: string[];
  summary: ProjectSummary;
  prompt: string | null;
  budgetCredits: number | null;
  /** Built or live: Launch (Share) is open. */
  launchable: boolean;
  /** Imported from a repo (B-1): opens in Developer view by default ("Open projects in Developer view"). */
  repo: boolean;
  /** An Architect 1.0 app (F9): its repo, and the 2.0 project it moved to. */
  legacy: { repo: string; movedTo: { id: string; name: string } | null } | null;
};

/** Every project in the current workspace with its summary, newest first. */
export async function listProjects(ctx: AppContext): Promise<ProjectRow[]> {
  const db = await createServerDb();
  const ws = ctx.workspace.id;
  const [{ data: projects, error }, { data: owners }, { data: usage }] = await Promise.all([
    db
      .from("projects")
      .select("id, name, icon, status, owner_id, owner_display_name, updated_at, budget_credits, prompt, legacy_repo, moved_to, repo_full_name, items(status, title, grp, blueprint_id, provider), blueprints(id, version), runs(status, started_at)")
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
      repo: Boolean(p.repo_full_name),
      providers: [...new Set(items.map((i) => i.provider).filter((x): x is string => Boolean(x)))],
      summary: summarizeProject({
        status: p.status as ProjectInput["status"],
        budgetCredits: p.budget_credits === null ? null : Number(p.budget_credits),
        items,
        runStatus: run?.status,
        prompt: p.prompt,
        legacy: p.legacy_repo ? { movedTo: (projects ?? []).find((x) => x.id === p.moved_to)?.name ?? null } : null,
      }),
      prompt: p.prompt,
      budgetCredits: p.budget_credits === null ? null : Number(p.budget_credits),
      launchable: !p.legacy_repo && (p.status === "built" || p.status === "live"),
      legacy: p.legacy_repo ? { repo: p.legacy_repo, movedTo: (() => { const m = (projects ?? []).find((x) => x.id === p.moved_to); return m ? { id: m.id, name: m.name } : null; })() } : null,
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

export type HelpContext = {
  firstName: string;
  /** Projects that are stuck, for the greeting: "Lead scorer is blocked at its budget". */
  stuck: { name: string; phrase: string }[];
  suggestions: string[];
};

/** What the Help panel opens with: a greeting that names what's stuck, and 3 suggested questions. */
export async function getHelpContext(ctx: AppContext): Promise<HelpContext> {
  const projects = await listProjects(ctx);
  const stuck: HelpContext["stuck"] = [];
  const suggestions: string[] = [];
  for (const p of projects.filter((p) => p.summary.needsYou)) {
    const t = p.summary.next.text;
    if (t.startsWith("Blocked: raise budget")) {
      stuck.push({ name: p.name, phrase: "is blocked at its budget" });
      suggestions.push(`Why did ${p.name} stop?`);
    } else if (t.startsWith("Waiting for IT")) {
      stuck.push({ name: p.name, phrase: "is waiting for IT" });
      suggestions.push(`Who approves ${p.name}?`);
    } else if (t.startsWith("Needs you: connect")) {
      stuck.push({ name: p.name, phrase: `needs you to ${t.replace("Needs you: ", "")}` });
      suggestions.push(`How do I ${t.replace("Needs you: ", "")}?`);
    } else {
      stuck.push({ name: p.name, phrase: "is blocked" });
      suggestions.push(`Why is ${p.name} blocked?`);
    }
  }
  for (const q of ["How are credits worked out?", "How do I invite someone?", "What's simulated in this prototype?"]) {
    if (suggestions.length < 3) suggestions.push(q);
  }
  return { firstName: ctx.name.split(" ")[0], stuck: stuck.slice(0, 2), suggestions: suggestions.slice(0, 3) };
}
