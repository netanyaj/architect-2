import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { approvalView, queueRules, ruleTitle, type AllowRule, type ApprovalInput, type ApprovalKind, type ApprovalStatus } from "@/lib/approvals";
import { canManageMembers } from "@/lib/permissions";
import { createAdminDb } from "@/server/db";
import { getAppContext } from "@/server/workspace";
import { ApprovalsView, type RuleItem } from "./approvals-view";

export const metadata: Metadata = { title: "Approvals · Architect" };

/** The approval queue (C-5, screen 11). Owners and Admins only, and only while governance is on. */
export default async function ApprovalsPage({ searchParams }: PageProps<"/governance/approvals">) {
  const ctx = await getAppContext();
  if (!canManageMembers(ctx.role) || !ctx.workspace.governanceEnabled) notFound();
  const sp = await searchParams;
  const admin = createAdminDb();
  const ws = ctx.workspace.id;
  const [{ data: rows }, { data: members }, { data: policies }, { data: rules }] = await Promise.all([
    admin.from("approvals").select("id, kind, title, status, created_at, decided_at, decided_by_name, reason, payload, requested_by, project_id, projects(id, name)").eq("workspace_id", ws).order("created_at", { ascending: false }),
    admin.from("members").select("user_id, display_name, email").eq("workspace_id", ws),
    admin.from("policies").select("kind, config").eq("workspace_id", ws),
    admin.from("allow_rules").select("id, action, target, reason, created_by_name, created_at, removed_at, projects(name)").eq("workspace_id", ws).is("removed_at", null).order("created_at", { ascending: false }),
  ]);
  const names = new Map((members ?? []).filter((m) => m.user_id).map((m) => [m.user_id!, m.display_name ?? m.email ?? "Someone"]));
  const egress = (policies ?? []).find((p) => p.kind === "egress")?.config as { hosts?: string[] } | undefined;

  // A Live deploy request shows how many of the project's parts work (screen 11: "41 of 42 tests pass").
  const deployProjects = [...new Set((rows ?? []).filter((r) => r.kind === "deploy" && r.project_id).map((r) => r.project_id!))];
  const works = new Map<string, { done: number; total: number }>();
  for (const id of deployProjects) {
    const { data: bp } = await admin.from("blueprints").select("id").eq("project_id", id).not("agreed_at", "is", null).order("version", { ascending: false }).limit(1).maybeSingle();
    if (!bp) continue;
    const { data: items } = await admin.from("items").select("status").eq("blueprint_id", bp.id);
    const counted = (items ?? []).filter((i) => i.status !== "deferred" && i.status !== "dropped");
    works.set(id, { done: counted.filter((i) => i.status === "built" || i.status === "sample_data").length, total: counted.length });
  }

  const views = (rows ?? []).map((r) => {
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    const input: ApprovalInput = {
      id: r.id,
      kind: r.kind as ApprovalKind,
      title: r.title,
      status: r.status as ApprovalStatus,
      createdAt: r.created_at,
      decidedAt: r.decided_at,
      decidedByName: r.decided_by_name,
      reason: r.reason,
      project: r.projects ? { id: r.projects.id, name: r.projects.name } : null,
      // Seeded requests name a teammate who has no account; otherwise the member who asked.
      requestedByName: typeof payload.requested_by_name === "string" ? payload.requested_by_name : r.requested_by ? (names.get(r.requested_by) ?? null) : null,
      payload,
      works: r.project_id ? (works.get(r.project_id) ?? null) : null,
      egressHosts: egress?.hosts ?? [],
    };
    return { ...approvalView(input), createdAt: r.created_at };
  });

  const ruleItems: RuleItem[] = [
    ...queueRules((policies ?? []).map((p) => ({ kind: p.kind, config: (p.config ?? {}) as Record<string, unknown> }))).map((q, i) => ({ id: `policy-${i}`, kind: "policy" as const, title: q.title, detail: q.detail })),
    ...(rules ?? []).map((r) => {
      const rule: AllowRule = { id: r.id, action: r.action as AllowRule["action"], projectName: r.projects?.name ?? null, target: r.target, createdByName: r.created_by_name, createdAt: r.created_at, reason: r.reason };
      return { id: r.id, kind: "allow" as const, title: ruleTitle(rule), detail: "Made from an approval. Requests it covers don't wait for an admin.", createdByName: rule.createdByName, createdAt: rule.createdAt, reason: rule.reason };
    }),
  ];

  const tab = sp.tab === "decided" || sp.tab === "rules" ? sp.tab : "waiting";
  return <ApprovalsView approvals={views} rules={ruleItems} initialTab={tab} initialId={typeof sp.id === "string" ? sp.id : undefined} />;
}
