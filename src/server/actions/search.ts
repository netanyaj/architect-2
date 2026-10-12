"use server";

import { canBuild, canManageMembers, canResetDemo } from "@/lib/permissions";
import { providerName } from "@/lib/providers";
import { createServerDb } from "../db";
import { getAppContext } from "../workspace";

export type SearchIndex = {
  projects: { id: string; name: string; status: string }[];
  agents: { id: string; name: string; projectId: string; projectName: string }[];
  connections: { provider: string; name: string; connected: boolean }[];
  workspaces: { id: string; label: string; current: boolean }[];
  canBuild: boolean;
  admin: boolean;
  /** Settings › Demo data applies: the Owner of a team workspace. */
  demoData: boolean;
};

/** What ⌘K searches (M5.10): this workspace's projects, agents and connections, read with the person's own access. */
export async function searchIndex(): Promise<SearchIndex> {
  const ctx = await getAppContext();
  const db = await createServerDb();
  const [{ data: projects }, { data: agents }, { data: connections }] = await Promise.all([
    db.from("projects").select("id, name, status").eq("workspace_id", ctx.workspace.id).is("deleted_at", null).is("legacy_repo", null).order("updated_at", { ascending: false }).limit(200),
    db.from("agents").select("id, name, project_id").eq("workspace_id", ctx.workspace.id).not("project_id", "is", null).limit(300),
    db.from("connections").select("provider, status, kind, name").eq("workspace_id", ctx.workspace.id),
  ]);
  const names = new Map((projects ?? []).map((p) => [p.id, p.name]));
  return {
    projects: (projects ?? []).map((p) => ({ id: p.id, name: p.name, status: p.status })),
    agents: (agents ?? []).filter((a) => names.has(a.project_id!)).map((a) => ({ id: a.id, name: a.name, projectId: a.project_id!, projectName: names.get(a.project_id!)! })),
    connections: (connections ?? []).map((c) => ({ provider: c.kind === "mcp" ? `mcp-${c.name}` : c.provider, name: c.kind === "mcp" ? `${c.name ?? "MCP server"} (MCP)` : providerName(c.provider), connected: c.status === "connected" })),
    workspaces: ctx.memberships.map((m) => ({ id: m.workspaceId, label: m.label, current: m.workspaceId === ctx.workspace.id })),
    canBuild: canBuild(ctx.role),
    admin: canManageMembers(ctx.role) && ctx.workspace.governanceEnabled,
    demoData: canResetDemo(ctx.role) && ctx.workspace.kind !== "personal",
  };
}
