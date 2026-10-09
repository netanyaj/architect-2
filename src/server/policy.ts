import "server-only";

import type { LiveDecision } from "@/lib/launch";
import type { AdminDb } from "./db";

/* What the workspace's rules allow, read by the build, Connect, Launch and merge (C-3, C-10). Approvals and
   allow-rules can lift a rule for one project or for all of them; see ./approvals. */

export type RuleAction = "connector" | "production_deploy" | "push_to_main";

/** Active allow-rules matching an action, for one project (a rule with no project covers every project). */
export async function allowRuleFor(admin: AdminDb, workspaceId: string, action: RuleAction, projectId: string | null, target?: string): Promise<boolean> {
  const { data } = await admin.from("allow_rules").select("project_id, target, removed_at").eq("workspace_id", workspaceId).eq("action", action);
  return (data ?? []).some((r) => !r.removed_at && (r.project_id === null || r.project_id === projectId) && (target === undefined || r.target === target));
}

/**
 * Services a project can't use without an admin: the connector policy's deny list, less any service approved for
 * this project (an approved request) or allowed everywhere by a rule.
 */
export async function deniedForProject(admin: AdminDb, workspaceId: string, projectId: string): Promise<string[]> {
  const [{ data: policy }, { data: approved }, { data: rules }] = await Promise.all([
    admin.from("policies").select("config").eq("workspace_id", workspaceId).eq("kind", "connectors").maybeSingle(),
    admin.from("approvals").select("payload").eq("workspace_id", workspaceId).eq("project_id", projectId).eq("kind", "connector").eq("status", "approved"),
    admin.from("allow_rules").select("project_id, target, removed_at").eq("workspace_id", workspaceId).eq("action", "connector"),
  ]);
  const deny = ((policy?.config as { deny?: string[] } | null)?.deny ?? []).map(String);
  const ok = new Set([
    ...(approved ?? []).map((a) => String((a.payload as { provider?: string } | null)?.provider ?? "")),
    ...(rules ?? []).filter((r) => !r.removed_at && (r.project_id === null || r.project_id === projectId)).map((r) => r.target ?? ""),
  ]);
  return deny.filter((p) => !ok.has(p));
}

/** The newest decision on each Live deploy request of a project, newest first (Launch picks the current version's). */
export async function liveDecisions(admin: AdminDb, projectId: string): Promise<LiveDecision[]> {
  const { data } = await admin.from("approvals").select("status, payload, decided_by_name, decided_at, reason").eq("project_id", projectId).eq("kind", "deploy").in("status", ["approved", "rejected"]);
  return (data ?? [])
    .sort((a, b) => String(b.decided_at ?? "").localeCompare(String(a.decided_at ?? "")))
    .map((d) => ({ status: d.status as LiveDecision["status"], by: d.decided_by_name ?? "an admin", reason: d.reason, version: (d.payload as { version?: number } | null)?.version ?? null }));
}
