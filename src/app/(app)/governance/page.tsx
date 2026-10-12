import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { track } from "@/server/analytics";
import { tourDone } from "@/server/tour";
import { modelAvailability } from "@/lib/gateway";
import { canManageMembers } from "@/lib/permissions";
import { auditEntries, type AuditRow } from "@/lib/audit";
import { knownApps } from "@/lib/policies";
import { createAdminDb } from "@/server/db";
import { loadPolicies, projectFlows, usedApps, workspaceSpend } from "@/server/policy";
import { getAppContext } from "@/server/workspace";
import { GovernanceView, type Section } from "./governance-view";

export const metadata: Metadata = { title: "Governance · Architect" };

const SECTIONS: Section[] = ["location", "models", "apps", "egress", "rules", "budgets", "audit"];

/** The organisation's policies (C-1 to C-4, C-6, C-7, C-10), master–detail like screen 11. Owners and Admins, governance on. */
export default async function GovernancePage({ searchParams }: PageProps<"/governance">) {
  const ctx = await getAppContext();
  if (!canManageMembers(ctx.role) || !ctx.workspace.governanceEnabled) notFound();
  const sp = await searchParams;
  const admin = createAdminDb();
  const [policies, used, { data: projects }] = await Promise.all([
    loadPolicies(admin, ctx.workspace.id),
    usedApps(admin, ctx.workspace.id),
    admin.from("projects").select("id, name, budget_credits").eq("workspace_id", ctx.workspace.id).is("deleted_at", null).order("updated_at", { ascending: false }),
  ]);
  const { data: mcpRows } = await admin.from("connections").select("id, url, status, tools").eq("workspace_id", ctx.workspace.id).eq("kind", "mcp");
  const [{ data: usage }, { data: audit }, spent] = await Promise.all([
    admin.from("usage_ledger").select("project_id, credits").eq("workspace_id", ctx.workspace.id),
    admin.from("audit_log").select("id, created_at, actor, action, target, details").eq("workspace_id", ctx.workspace.id).order("created_at", { ascending: false }).limit(500),
    workspaceSpend(admin, ctx.workspace.id),
  ]);
  const spentBy = (id: string) => Math.round((usage ?? []).filter((u) => u.project_id === id).reduce((s, u) => s + Number(u.credits), 0));
  const names = (projects ?? []).map((p) => p.name);
  const { stored } = policies;
  // Every project's data flow (C-4), for the Data and egress section.
  const flows = await Promise.all((projects ?? []).map(async (p) => ({ id: p.id, name: p.name, paths: await projectFlows(admin, p.id, policies) })));
  const section = SECTIONS.includes(sp.section as Section) ? (sp.section as Section) : "location";
  // The tour's last step (M5.10) is done once Governance has been seen.
  after(async () => {
    if (!(await tourDone(admin, ctx.user.id, ctx.workspace.id)).includes("governance")) await track("tour_step", { user: ctx.user, workspaceId: ctx.workspace.id, detail: "governance_seen" });
  });
  return (
    <GovernanceView
      workspaceName={ctx.workspace.name}
      initialSection={section}
      location={stored.location}
      models={stored.models}
      apps={stored.apps}
      egress={stored.egress}
      flows={flows}
      permissions={stored.permissions}
      budget={{ cap: stored.budget.monthlyCap, spent: Math.round(spent), allowance: ctx.workspace.creditsTotal }}
      projectBudgets={(projects ?? []).map((p) => ({ id: p.id, name: p.name, cap: p.budget_credits === null ? null : Number(p.budget_credits), spent: spentBy(p.id) }))}
      audit={auditEntries((audit ?? []) as AuditRow[], names)}
      availability={modelAvailability()}
      known={knownApps(used)}
      mcpConnections={(mcpRows ?? []).map((c) => ({ id: c.id, url: c.url ?? "", connected: c.status === "connected", tools: Array.isArray(c.tools) ? c.tools.length : 0 }))}
    />
  );
}
