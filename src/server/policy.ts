import "server-only";

import { dataFlow, egressOf, type EgressPolicy, type FlowPath } from "@/lib/egress";
import type { LiveDecision } from "@/lib/launch";
import { toModelChoice, type ModelChoice } from "@/lib/models";
import { appPolicyOf, BUDGET_STOPPED, budgetOf, budgetState, locationOf, modelPolicyOf, NO_RULES, OPEN_MODELS, permissionsOf, type AppPolicy, type LocationPolicy, type ModelPolicy, type OrgBudget, type PermissionRules } from "@/lib/policies";
import type { AdminDb } from "./db";
import { periodStart } from "./queries";

/* What the workspace's rules allow, read by the build, Connect, Launch and merge (C-3, C-10). Approvals and
   allow-rules can lift a rule for one project or for all of them; see ./approvals. */

export type RuleAction = "connector" | "production_deploy" | "push_to_main" | "external_call";

/** Active allow-rules matching an action, for one project (a rule with no project covers every project). */
export async function allowRuleFor(admin: AdminDb, workspaceId: string, action: RuleAction, projectId: string | null, target?: string): Promise<boolean> {
  const { data } = await admin.from("allow_rules").select("project_id, target, removed_at").eq("workspace_id", workspaceId).eq("action", action);
  return (data ?? []).some((r) => !r.removed_at && (r.project_id === null || r.project_id === projectId) && (target === undefined || r.target === target));
}

export type Policies = { governance: boolean; location: LocationPolicy; models: ModelPolicy; apps: AppPolicy; egress: EgressPolicy; permissions: PermissionRules; budget: OrgBudget };

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
  const stored = { location: locationOf(config("location")), models: modelPolicyOf(config("models")), apps: appPolicyOf(config("connectors")), egress: egressOf(config("egress")), permissions: permissionsOf(config("permission")), budget: budgetOf(config("budget")) };
  const governance = Boolean(ws?.governance_enabled);
  if (governance) return { governance, ...stored, stored };
  return { governance, location: { mode: "lyzr_cloud", region: null }, models: OPEN_MODELS, apps: { allow: [], whoCanConnect: "builders", scopes: {}, mcp: [] }, egress: stored.egress, permissions: NO_RULES, budget: { monthlyCap: null }, stored };
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

/** A service a project's parts call with an API key, held for Live by the external-calls rule (C-10). */
export type ExternalCall = { provider: string; parts: string[]; waiting: boolean };

/**
 * Parts that call an outside service with an API key (BL-9) need an Owner or Admin's OK before they run on Live, once
 * per service and project, while governance and the rule are on. An approved request or an allow-rule covers it.
 */
export async function externalCallHolds(admin: AdminDb, workspaceId: string, projectId: string, parts: { title: string; status: string; provider: string | null }[], policies: Policies): Promise<ExternalCall[]> {
  if (!policies.governance || !policies.permissions.external) return [];
  const { data: keyed } = await admin.from("connections").select("provider").eq("workspace_id", workspaceId).eq("kind", "api_key");
  const services = new Set((keyed ?? []).map((c) => c.provider));
  const byService = new Map<string, string[]>();
  for (const p of parts) {
    if (!p.provider || !services.has(p.provider) || p.status === "dropped" || p.status === "deferred") continue;
    byService.set(p.provider, [...(byService.get(p.provider) ?? []), p.title]);
  }
  if (!byService.size) return [];
  const [{ data: rules }, { data: requests }] = await Promise.all([
    admin.from("allow_rules").select("project_id, target, removed_at").eq("workspace_id", workspaceId).eq("action", "external_call"),
    admin.from("approvals").select("status, payload").eq("project_id", projectId).eq("kind", "external_call").in("status", ["waiting", "approved"]),
  ]);
  const out: ExternalCall[] = [];
  for (const [provider, titles] of byService) {
    const ruled = (rules ?? []).some((r) => !r.removed_at && r.target === provider && (r.project_id === null || r.project_id === projectId));
    const asked = (requests ?? []).filter((r) => (r.payload as { provider?: string } | null)?.provider === provider);
    if (ruled || asked.some((r) => r.status === "approved")) continue;
    out.push({ provider, parts: titles, waiting: asked.some((r) => r.status === "waiting") });
  }
  return out;
}

/** Services the workspace's parts use or holds an API key for: what Governance › Apps can list (C-3). */
export async function usedApps(admin: AdminDb, workspaceId: string): Promise<string[]> {
  const [{ data: items }, { data: conns }] = await Promise.all([
    admin.from("items").select("provider, projects!inner(workspace_id)").eq("projects.workspace_id", workspaceId).not("provider", "is", null),
    admin.from("connections").select("provider").eq("workspace_id", workspaceId).neq("kind", "mcp"),
  ]);
  return [...(items ?? []).map((i) => i.provider as string), ...(conns ?? []).map((c) => c.provider)];
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

/** Credits the workspace has used since its allowance last reset (the same period as the side nav's credits). */
export async function workspaceSpend(admin: AdminDb, workspaceId: string): Promise<number> {
  const { data: ws } = await admin.from("workspaces").select("credits_reset_on").eq("id", workspaceId).maybeSingle();
  if (!ws) return 0;
  const { data } = await admin.from("usage_ledger").select("credits").eq("workspace_id", workspaceId).gte("created_at", periodStart(ws.credits_reset_on));
  return (data ?? []).reduce((s, r) => s + Number(r.credits), 0);
}

/** The organisation's cap this month (C-7): where it stands, with governance on and a cap set. */
export async function orgBudget(admin: AdminDb, workspaceId: string, loaded?: Policies) {
  const policies = loaded ?? (await loadPolicies(admin, workspaceId));
  const cap = policies.governance ? policies.budget.monthlyCap : null;
  const spent = cap ? await workspaceSpend(admin, workspaceId) : 0;
  return { cap, spent, ...budgetState(cap, spent) };
}

/** Paid actions (writing a plan, Build, Apply, a fix, continuing) stop at 100% of the cap until an admin raises it. */
export async function budgetRefusal(admin: AdminDb, workspaceId: string): Promise<string | undefined> {
  return (await orgBudget(admin, workspaceId)).level === "stopped" ? BUDGET_STOPPED : undefined;
}
