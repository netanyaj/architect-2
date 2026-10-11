import "server-only";

import type { AdminDb } from "./db";
import { removeProjectFiles } from "./uploads";

/**
 * Whether a Builder may delete a project (M5.5 review): they own it, it isn't Live, it isn't shared with the team,
 * and nobody else has worked on it (a plan version or a comment by someone else). Owners and Admins always may.
 * Returns why not, or null.
 */
export async function builderDeleteRefusal(admin: AdminDb, project: { id: string; owner_id: string | null; status: string }, userId: string): Promise<string | null> {
  if (project.owner_id !== userId) return "A Builder can delete only their own projects. Ask an Owner or Admin.";
  if (project.status === "live") return "It's live. Ask an Owner or Admin to delete it.";
  const [{ data: team }, { data: plans }, { data: comments }] = await Promise.all([
    admin.from("environments").select("status").eq("project_id", project.id).eq("name", "staging").maybeSingle(),
    admin.from("blueprints").select("created_by").eq("project_id", project.id),
    admin.from("part_comments").select("author_id").eq("project_id", project.id),
  ]);
  if (team?.status === "live") return "It's shared with your team. Ask an Owner or Admin to delete it.";
  if ((plans ?? []).some((b) => b.created_by && b.created_by !== userId) || (comments ?? []).some((c) => c.author_id && c.author_id !== userId)) {
    return "Someone else has worked on it. Ask an Owner or Admin to delete it.";
  }
  return null;
}

/** Projects deleted more than 30 days ago go for good, with their stored files. Returns how many. */
export async function purgeDeleted(admin: AdminDb, workspaceId: string | null): Promise<number> {
  const { data, error } = await admin.rpc("purge_deleted_projects", { p_workspace: workspaceId ?? undefined });
  if (error) return 0;
  const rows = (data ?? []) as { id: string; workspace_id: string }[];
  for (const r of rows) await removeProjectFiles(admin, r.workspace_id, r.id);
  return rows.length;
}
