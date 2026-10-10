import "server-only";

import { dataFlow, egressOf, type EgressPolicy, type FlowPath } from "@/lib/egress";
import type { LiveDecision } from "@/lib/launch";
import { toModelChoice, type ModelChoice } from "@/lib/models";
import { appPolicyOf, locationOf, modelPolicyOf, OPEN_MODELS, type AppPolicy, type LocationPolicy, type ModelPolicy } from "@/lib/policies";
import type { AdminDb } from "./db";

/* What the workspace's rules allow, read by the build, Connect, Launch and merge (C-3, C-10). Approvals and
   allow-rules can lift a rule for one project or for all of them; see ./approvals. */

export type RuleAction = "connector" | "production_deploy" | "push_to_main";

/** Active allow-rules matching an action, for one project (a rule with no project covers every project). */
export async function allowRuleFor(admin: AdminDb, workspaceId: string, action: RuleAction, projectId: string | null, target?: string): Promise<boolean> {
  const { data } = await admin.from("allow_rules").select("project_id, target, removed_at").eq("workspace_id", workspaceId).eq("action", action);
  return (data ?? []).some((r) => !r.removed_at && (r.project_id === null || r.project_id === projectId) && (target === undefined || r.target === target));
}

export type Policies = { governance: boolean; location: LocationPolicy; models: ModelPolicy; apps: AppPolicy; egress: EgressPolicy };

/**
 * The workspace's policies (C-1 to C-3). They apply only while governance is on: off, every model and app is
 * allowed and anyone who can build connects apps. The Governance pages still show what's stored.
 */
export async function loadPolicies(admin: AdminDb, workspaceId: string): Promise<Policies & { stored: Omit<Policies, "governance"> }> {
  const [{ data: ws }, { data: rows }] = await Promise.all([
    admin.from("workspaces").select("governance_enabled").eq("id", workspaceId).maybeSingle(),
    admin.from("policies").select("kind, config").eq("workspace_id", workspaceId),
  ]);
  const config = (kind: string) => (rows ?? []).find((r) => r.kind === kind)?.config;
  const stored = { location: locationOf(config("location")), models: modelPolicyOf(config("models")), apps: appPolicyOf(config("connectors")), egress: egressOf(config("egress")) };
  const governance = Boolean(ws?.governance_enabled);
  if (governance) return { governance, ...stored, stored };
  return { governance, location: { mode: "lyzr_cloud", region: null }, models: OPEN_MODELS, apps: { allow: [], whoCanConnect: "builders", scopes: {}, mcp: [] }, egress: stored.egress, stored };
}

/**
 * Of these services, the ones a project can't use without an admin (C-3): those not on the allowed list, less any
 * approved for this project (an approved request) or allowed by a rule. Nothing is blocked with governance off.
 */
export async function blockedServices(admin: AdminDb, workspaceId: string, projectId: string | null, providers: (string | null)[], loaded?: Policies): Promise<string[]> {
  const wanted = [...new Set(providers.filter((p): p is string => Boolean(p)))];
  if (!wanted.length) return [];
  const { governance, apps } = loaded ?? (await loadPolicies(admin, workspaceId));
  if (!governance) return [];
  const [{ data: approved }, { data: rules }] = await Promise.all([
    projectId
      ? admin.from("approvals").select("payload").eq("workspace_id", workspaceId).eq("project_id", projectId).eq("kind", "connector").eq("status", "approved")
      : Promise.resolve({ data: [] as { payload: unknown }[] }),
    admin.from("allow_rules").select("project_id, target, removed_at").eq("workspace_id", workspaceId).eq("action", "connector"),
  ]);
  const ok = new Set([
    ...apps.allow,
    ...(approved ?? []).map((a) => String((a.payload as { provider?: string } | null)?.provider ?? "")),
    ...(rules ?? []).filter((r) => !r.removed_at && (r.project_id === null || r.project_id === projectId)).map((r) => r.target ?? ""),
  ]);
  return wanted.filter((p) => !ok.has(p));
}

/** The newest decision on each Live deploy request of a project, newest first (Launch picks the current version's). */
export async function liveDecisions(admin: AdminDb, projectId: string): Promise<LiveDecision[]> {
  const { data } = await admin.from("approvals").select("status, payload, decided_by_name, decided_at, reason").eq("project_id", projectId).eq("kind", "deploy").in("status", ["approved", "rejected"]);
  return (data ?? [])
    .sort((a, b) => String(b.decided_at ?? "").localeCompare(String(a.decided_at ?? "")))
    .map((d) => ({ status: d.status as LiveDecision["status"], by: d.decided_by_name ?? "an admin", reason: d.reason, version: (d.payload as { version?: number } | null)?.version ?? null }));
}

/**
 * Where a project's data would go (C-4): its apps' hosts and its agents' models. Empty with governance off, when no
 * policy applies. Agents not opened yet (no row) use the policy's default for app agents.
 */
export async function projectFlows(admin: AdminDb, projectId: string, policies: Policies, parts?: { key: string; title: string; status: string; grp: string; provider: string | null }[]): Promise<FlowPath[]> {
  if (!policies.governance) return [];
  let list = parts;
  if (!list) {
    const { data: bp } = await admin.from("blueprints").select("id").eq("project_id", projectId).not("agreed_at", "is", null).order("version", { ascending: false }).limit(1).maybeSingle();
    if (!bp) return [];
    const { data } = await admin.from("items").select("key, title, status, grp, provider").eq("blueprint_id", bp.id);
    list = data ?? [];
  }
  const { data: rows } = await admin.from("agents").select("name, model, item_key").eq("project_id", projectId);
  const active = list.filter((p) => p.status !== "deferred" && p.status !== "dropped");
  // Only agents whose part is still in the plan send anything.
  const agents = (rows ?? []).filter((a) => active.some((p) => p.key === a.item_key));
  const agentModels: { name: string; model: ModelChoice }[] = agents.length
    ? agents.map((a) => ({ name: a.name, model: toModelChoice(a.model) }))
    : active.filter((p) => p.grp === "agents").map((p) => ({ name: p.title, model: policies.models.agentDefault }));
  return dataFlow({ parts: list, agentModels, egress: policies.egress, models: policies.models });
}
