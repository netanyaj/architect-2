import "server-only";

import type { ActionResult } from "./actions/members";
import type { AdminDb } from "./db";

/**
 * Live stops answering; its data and versions are kept, and the version that was live is recorded so Go live again
 * brings it back. Used by Take offline, and by deleting a Live project (it goes offline first).
 */
export async function goOffline(admin: AdminDb, project: { id: string; name: string; workspace_id: string; current_version: number | null }, by: { name: string; userId: string }): Promise<ActionResult> {
  const [{ data: live }, { data: env }] = await Promise.all([
    admin.from("deployments").select("id, blueprint_version").eq("project_id", project.id).eq("environment", "production").eq("status", "live").maybeSingle(),
    admin.from("environments").select("id, status").eq("project_id", project.id).eq("name", "production").maybeSingle(),
  ]);
  if (!live && env?.status !== "live") return { ok: false, message: "Nothing is live to take offline." };
  const version = live?.blueprint_version ?? project.current_version ?? 1;
  if (live) await admin.from("deployments").update({ status: "offline" }).eq("id", live.id);
  // A seeded live app has no deployment history: record the version that was live, so it can come back.
  else await admin.from("deployments").insert({ project_id: project.id, environment: "production", blueprint_version: version, status: "offline", created_by: by.userId });
  if (env) await admin.from("environments").update({ status: "offline" }).eq("id", env.id);
  await admin.from("projects").update({ status: "built", updated_at: new Date().toISOString() }).eq("id", project.id);
  await admin.from("audit_log").insert({ workspace_id: project.workspace_id, actor: by.name, action: "deploy.offline", target: project.name, details: { version, simulated: true } });
  return { ok: true };
}
