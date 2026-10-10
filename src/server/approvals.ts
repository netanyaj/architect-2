import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { decisionProblem } from "@/lib/approvals";
import type { Json } from "@/lib/database.types";
import { canManageMembers } from "@/lib/permissions";
import { providerName } from "@/lib/providers";
import { goLive } from "./actions/launch";
import type { ActionResult } from "./actions/members";
import { mergePullRequest } from "./actions/pull-requests";
import type { AdminDb } from "./db";
import type { RuleAction } from "./policy";
import type { AppContext } from "./workspace";

/* Approvals (C-5) and allow-rules (C-10), simulated. Requests come from the rules; an Owner or Admin decides each one
   with a reason (required to reject). Approving unblocks what asked: the part's app, the Live deploy, the merge into
   main or the coding-agent token. "Allow" also records an allow-rule, so the same request doesn't wait again. */

const input = z.object({
  approvalId: z.string().min(1).max(64),
  decision: z.enum(["approve", "reject"]),
  scope: z.enum(["once", "rule"]).default("once"),
  reason: z.string().default(""),
});

/**
 * Decide one request. Returns a note when the decision is saved but what it unblocks can't happen yet (Live waits for
 * the team version, a merge waits for its checks); the person who asked can then go ahead without asking again.
 */
export async function decide(admin: AdminDb, ctx: AppContext, raw: z.input<typeof input>): Promise<ActionResult<{ note?: string }>> {
  if (!canManageMembers(ctx.role)) return { ok: false, message: "Only Owners and Admins decide on requests." };
  if (!ctx.workspace.governanceEnabled) return { ok: false, message: "Governance is off, so nothing needs approval. Turn it on in Settings to use the queue." };
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That request isn't in this workspace." };
  const { approvalId, decision, scope } = parsed.data;
  const reason = parsed.data.reason.trim();
  const problem = decisionProblem(decision, reason);
  if (problem) return { ok: false, message: problem };

  const { data: a } = await admin.from("approvals").select("id, workspace_id, project_id, kind, title, status, payload, decided_by_name").eq("id", approvalId).maybeSingle();
  if (!a || a.workspace_id !== ctx.workspace.id) return { ok: false, message: "That request isn't in this workspace." };
  if (a.status !== "waiting") return { ok: false, message: `${a.decided_by_name ?? "Someone"} already ${a.status === "approved" ? "approved" : "rejected"} this request. It's in Decided.` };
  const payload = (a.payload ?? {}) as Record<string, unknown>;
  const provider = typeof payload.provider === "string" ? payload.provider : null;
  const { data: project } = a.project_id ? await admin.from("projects").select("id, name").eq("id", a.project_id).maybeSingle() : { data: null };

  if (decision === "approve" && scope === "rule" && (a.kind === "token" || a.kind === "budget" || (a.kind !== "connector" && !project))) {
    return { ok: false, message: "This request can only be approved once." };
  }
  if (decision === "approve" && scope === "once" && a.kind === "connector" && !project) {
    return { ok: false, message: "This request isn't for one project. Approve it for every project, or reject it." };
  }
  if (a.kind === "connector" && project) {
    const { data: running } = await admin.from("runs").select("id").eq("project_id", project.id).in("status", ["queued", "running"]).limit(1);
    if (running?.length) return { ok: false, message: `A build is running on ${project.name}. Decide when it finishes.` };
  }

  // Claim the request first, so two admins deciding at once can't both act on it.
  const now = new Date().toISOString();
  const { data: claimed } = await admin
    .from("approvals")
    .update({
      status: decision === "approve" ? "approved" : "rejected",
      decided_by: ctx.user.id,
      decided_by_name: ctx.name,
      decided_at: now,
      reason: reason || null,
      payload: { ...payload, decision_scope: decision === "approve" ? scope : null } as Json,
    })
    .eq("id", a.id)
    .eq("status", "waiting")
    .select("id");
  if (!claimed?.length) return { ok: false, message: "Someone else just decided this request. It's in Decided." };

  const audit = (action: string, target: string, details: Record<string, unknown>) =>
    admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action, target, details: { ...details, simulated: true } as Json });
  await audit(decision === "approve" ? "approval.approved" : "approval.rejected", a.title, { kind: a.kind, project: project?.name ?? null, scope: decision === "approve" ? scope : null, reason: reason || null });

  let note: string | undefined;
  if (decision === "approve" && scope === "rule") {
    const action: RuleAction = a.kind === "connector" ? "connector" : a.kind === "deploy" ? "production_deploy" : "push_to_main";
    const everywhere = a.kind === "connector";
    await admin.from("allow_rules").insert({
      workspace_id: ctx.workspace.id,
      action,
      project_id: everywhere ? null : project!.id,
      target: everywhere ? provider : null,
      approval_id: a.id,
      reason: reason || null,
      created_by: ctx.user.id,
      created_by_name: ctx.name,
    });
    if (everywhere && provider) await allowService(admin, ctx.workspace.id, provider);
    await audit("rule.created", everywhere ? `${providerName(provider)} allowed in every project` : `${project!.name}: ${action === "production_deploy" ? "Live deploys" : "pushes to main"} without an admin`, { action, from_approval: a.id, reason: reason || null });
  }

  if (a.kind === "connector" && provider) {
    if (decision === "approve") {
      const projects = scope === "rule" ? await workspaceProjects(admin, ctx.workspace.id) : project ? [project.id] : [];
      await unblockService(admin, projects, provider);
      // Other projects waiting for the same service are covered by the rule.
      if (scope === "rule") {
        await admin
          .from("approvals")
          .update({ status: "approved", decided_by: ctx.user.id, decided_by_name: ctx.name, decided_at: now, reason: `Covered by the rule allowing ${providerName(provider)} everywhere` })
          .eq("workspace_id", ctx.workspace.id)
          .eq("kind", "connector")
          .eq("status", "waiting")
          .contains("payload", { provider });
      }
    } else if (project) {
      // The part is set aside with the reason; the rest of the project carries on without it.
      await admin.from("items").update({ status: "deferred", status_detail: `Not approved: ${reason}` }).eq("project_id", project.id).eq("provider", provider).eq("status", "needs_approval");
    }
  }

  if (a.kind === "token") {
    // The token row points at its request (0014); a seeded request has no token behind it.
    if (decision === "approve") await admin.from("project_tokens").update({ status: "active" }).eq("approval_id", a.id).eq("status", "waiting");
    else await admin.from("project_tokens").update({ status: "revoked", revoked_at: now }).eq("approval_id", a.id).eq("status", "waiting");
  }

  if (a.kind === "secret" && project && typeof payload.key === "string") {
    // The key was typed and thrown away when it was asked for; approving records it as set for Live.
    if (decision === "approve") await admin.from("project_keys").update({ status: "set" }).eq("approval_id", a.id).eq("status", "waiting");
    else await admin.from("project_keys").delete().eq("approval_id", a.id).eq("status", "waiting");
  }

  if (a.kind === "budget" && decision === "approve" && typeof payload.cap === "number") {
    // Raising the organisation's monthly cap (C-7): paid actions start again.
    const { data: row } = await admin.from("policies").select("id").eq("workspace_id", ctx.workspace.id).eq("kind", "budget").maybeSingle();
    if (row) await admin.from("policies").update({ config: { monthly_cap: payload.cap } }).eq("id", row.id);
    else await admin.from("policies").insert({ workspace_id: ctx.workspace.id, kind: "budget", config: { monthly_cap: payload.cap } });
    await audit("policy.changed", `Monthly cap raised to ${payload.cap} credits`, { policy: "budget", from_approval: a.id });
  }

  if (a.kind === "deploy" && project && decision === "approve") {
    // A seeded "Production deploy" part waits on this request; it works once Live is approved.
    await approveDeployParts(admin, project.id, ctx.name);
    const r = await goLive({ projectId: project.id });
    if (!r.ok) note = `Approved. ${project.name} isn't live yet: ${r.message} ${firstName(payload.requested_by_name)} can go live without asking again.`;
  }

  if (a.kind === "push" && decision === "approve" && typeof payload.pr_id === "string") {
    const r = await mergePullRequest({ prId: payload.pr_id });
    if (!r.ok) note = `Approved. It isn't merged yet: ${r.message} ${firstName(payload.requested_by_name)} can merge it without asking again.`;
  }

  revalidatePath("/governance/approvals");
  if (project) {
    revalidatePath(`/p/${project.id}`);
    revalidatePath(`/p/${project.id}/launch`);
    revalidatePath(`/p/${project.id}/settings`);
  }
  return { ok: true, note };
}

const firstName = (v: unknown) => (typeof v === "string" && v ? v.split(" ")[0] : "The person who asked");

async function workspaceProjects(admin: AdminDb, workspaceId: string): Promise<string[]> {
  const { data } = await admin.from("projects").select("id").eq("workspace_id", workspaceId);
  return (data ?? []).map((p) => p.id);
}

/** The connector policy: the service moves from not allowed to allowed. */
async function allowService(admin: AdminDb, workspaceId: string, provider: string) {
  const { data: policy } = await admin.from("policies").select("id, config").eq("workspace_id", workspaceId).eq("kind", "connectors").maybeSingle();
  const config = (policy?.config ?? {}) as { allow?: string[]; deny?: string[] };
  const next = { ...config, allow: [...new Set([...(config.allow ?? []), provider])], deny: (config.deny ?? []).filter((p) => p !== provider) };
  if (policy) await admin.from("policies").update({ config: next as Json }).eq("id", policy.id);
  else await admin.from("policies").insert({ workspace_id: workspaceId, kind: "connectors", config: next as Json });
}

/** The reverse, when a rule allowing a service everywhere is removed. */
export async function denyService(admin: AdminDb, workspaceId: string, provider: string) {
  const { data: policy } = await admin.from("policies").select("id, config").eq("workspace_id", workspaceId).eq("kind", "connectors").maybeSingle();
  if (!policy) return;
  const config = (policy.config ?? {}) as { allow?: string[]; deny?: string[] };
  const next = { ...config, allow: (config.allow ?? []).filter((p) => p !== provider), deny: [...new Set([...(config.deny ?? []), provider])] };
  await admin.from("policies").update({ config: next as Json }).eq("id", policy.id);
}

/** Parts that waited for this service now ask to connect it (Connect sits on the part, F5). */
async function unblockService(admin: AdminDb, projectIds: string[], provider: string) {
  if (!projectIds.length) return;
  await admin
    .from("items")
    .update({ status: "needs_connection", status_detail: `Approved · connect ${providerName(provider)} to use it` })
    .in("project_id", projectIds)
    .eq("provider", provider)
    .eq("status", "needs_approval");
}

/** Parts with no service that waited for Live approval (the seeded "Production deploy") work, with a passing proof. */
async function approveDeployParts(admin: AdminDb, projectId: string, by: string) {
  const { data: parts } = await admin.from("items").select("id, provider").eq("project_id", projectId).eq("status", "needs_approval");
  for (const p of (parts ?? []).filter((x) => !x.provider)) {
    const { data: check } = await admin.from("checks").insert({ item_id: p.id, kind: "http", description: "Live deploy approved by an Owner or Admin" }).select("id").single();
    if (check) await admin.from("proofs").insert({ item_id: p.id, check_id: check.id, attempt: 0, result: "pass", assertions_passed: 1, assertions_total: 1, summary: `Approved by ${by}` });
    await admin.from("items").update({ status: "built", status_detail: null }).eq("id", p.id);
  }
}

/** Remove an allow-rule: later requests of that kind wait for an admin again. Kept in the table, marked removed. */
export async function removeRule(admin: AdminDb, ctx: AppContext, ruleId: string): Promise<ActionResult> {
  if (!canManageMembers(ctx.role)) return { ok: false, message: "Only Owners and Admins change the rules." };
  if (!z.string().uuid().safeParse(ruleId).success) return { ok: false, message: "That rule isn't in this workspace." };
  const { data: r } = await admin.from("allow_rules").select("id, workspace_id, action, project_id, target, removed_at").eq("id", ruleId).maybeSingle();
  if (!r || r.workspace_id !== ctx.workspace.id) return { ok: false, message: "That rule isn't in this workspace." };
  if (r.removed_at) return { ok: true };
  await admin.from("allow_rules").update({ removed_at: new Date().toISOString() }).eq("id", r.id);
  if (r.action === "connector" && r.target && !r.project_id) await denyService(admin, ctx.workspace.id, r.target);
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "rule.removed", target: r.target ? providerName(r.target) : r.action, details: { action: r.action, project_id: r.project_id, simulated: true } });
  revalidatePath("/governance/approvals");
  return { ok: true };
}
