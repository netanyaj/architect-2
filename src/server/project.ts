import "server-only";

import type { Role } from "@/lib/db";
import { detectTools, projectIcon, summarizeProject, type ProjectInput } from "@/lib/project-status";
import { createServerDb } from "./db";
import type { AppContext } from "./workspace";

export type WorkspaceItem = {
  id: string;
  key: string;
  title: string;
  description: string | null;
  provedWhen: string;
  grp: string;
  status: string;
  statusDetail: string | null;
  estimate: number | null;
  position: number;
};

export type ProjectWorkspace = {
  id: string;
  name: string;
  icon: ReturnType<typeof projectIcon>;
  status: ProjectInput["status"];
  prompt: string | null;
  ownerName: string;
  updatedAt: string;
  budgetCredits: number | null;
  plan: { version: number; status: string; summary: string | null; totalLikely: number | null; estMinutes: number | null } | null;
  items: WorkspaceItem[];
  runStatus: string | null;
  tools: string[];
  summary: ReturnType<typeof summarizeProject>;
  /** The person's role in the project's workspace. */
  role: Role;
  /** Set when the project lives in another workspace the person belongs to (they need to switch first). */
  otherWorkspace: { id: string; label: string } | null;
  creditsLeft: number;
};

/** One project for its workspace screen, read under RLS (so only members see it). Null when it doesn't exist. */
export async function getProjectWorkspace(id: string, ctx: AppContext, creditsLeft: number): Promise<ProjectWorkspace | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = await createServerDb();
  const { data: p } = await db
    .from("projects")
    .select(
      "id, workspace_id, name, icon, status, prompt, owner_id, owner_display_name, updated_at, budget_credits, blueprints(id, version, status, summary, total_likely, est_minutes), runs(status, started_at)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!p) return null;

  const latest = [...(p.blueprints ?? [])].sort((a, b) => b.version - a.version)[0] ?? null;
  const { data: items } = latest
    ? await db
        .from("items")
        .select("id, key, title, description, proved_when, grp, status, status_detail, estimate_likely, position")
        .eq("blueprint_id", latest.id)
        .order("position")
    : { data: [] };

  let ownerName = p.owner_display_name;
  if (!ownerName) {
    if (p.owner_id === ctx.user.id) ownerName = "you";
    else {
      const { data: owner } = await db.from("members").select("display_name").eq("workspace_id", p.workspace_id).eq("user_id", p.owner_id ?? "").maybeSingle();
      ownerName = owner?.display_name?.split(" ")[0] ?? "someone";
    }
  }

  const membership = ctx.memberships.find((m) => m.workspaceId === p.workspace_id);
  const run = [...(p.runs ?? [])].sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""))[0];
  const list = (items ?? []).map((i) => ({
    id: i.id,
    key: i.key,
    title: i.title,
    description: i.description,
    provedWhen: i.proved_when,
    grp: i.grp,
    status: i.status,
    statusDetail: i.status_detail,
    estimate: i.estimate_likely === null ? null : Number(i.estimate_likely),
    position: i.position,
  }));

  return {
    id: p.id,
    name: p.name,
    icon: projectIcon(p.icon),
    status: p.status as ProjectInput["status"],
    prompt: p.prompt,
    ownerName,
    updatedAt: p.updated_at,
    budgetCredits: p.budget_credits === null ? null : Number(p.budget_credits),
    plan: latest
      ? {
          version: latest.version,
          status: latest.status,
          summary: latest.summary,
          totalLikely: latest.total_likely === null ? null : Number(latest.total_likely),
          estMinutes: latest.est_minutes,
        }
      : null,
    items: list,
    runStatus: run?.status ?? null,
    tools: detectTools([p.prompt, ...list.map((i) => i.title)]),
    summary: summarizeProject({
      status: p.status as ProjectInput["status"],
      budgetCredits: p.budget_credits === null ? null : Number(p.budget_credits),
      items: list,
      runStatus: run?.status,
    }),
    role: membership?.role ?? "viewer",
    otherWorkspace: p.workspace_id === ctx.workspace.id || !membership ? null : { id: membership.workspaceId, label: membership.label },
    creditsLeft,
  };
}
