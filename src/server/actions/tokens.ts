"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SCOPES, TOKEN_PREFIX, type Scope } from "@/lib/mcp";
import { canBuild, canManageMembers } from "@/lib/permissions";
import { createAdminDb } from "../db";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";

/* Project tokens for coding agents (F4), simulated: no server accepts them. Only a hash and the last 4 characters
   are stored; the token is shown once. With governance on, a token waits for an Owner or Admin. */

const uuid = z.string().uuid();
/** 32 random bytes, base64url (43 characters). */
const newToken = () => TOKEN_PREFIX + randomBytes(32).toString("base64url");
const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

const input = z.object({
  projectId: uuid,
  name: z.string().trim().min(1, "Name the token, e.g. “Sam's Claude Code”.").max(60, "Keep the name under 60 characters."),
  scopes: z.array(z.enum(SCOPES.map((s) => s.id) as [Scope, ...Scope[]])).min(1, "Pick at least one thing the agent may do.").max(SCOPES.length),
});

export async function createProjectToken(raw: z.input<typeof input>): Promise<ActionResult<{ token: string; status: "waiting" | "active" }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't make tokens. Ask an Owner, Admin or Builder." };
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "That token isn't valid." };
  const admin = createAdminDb();
  const { data: project } = await admin.from("projects").select("id, name, workspace_id").eq("id", parsed.data.projectId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!project) return { ok: false, message: "That project isn't in this workspace." };
  const { count } = await admin.from("project_tokens").select("id", { count: "exact", head: true }).eq("project_id", project.id).neq("status", "revoked");
  if ((count ?? 0) >= 10) return { ok: false, message: "A project can have up to 10 tokens. Revoke one first." };

  const token = newToken();
  const status = ctx.workspace.governanceEnabled ? ("waiting" as const) : ("active" as const);
  const { data: row, error } = await admin
    .from("project_tokens")
    .insert({ project_id: project.id, name: parsed.data.name, scopes: [...new Set(parsed.data.scopes)], token_hash: hashOf(token), last4: token.slice(-4), status, created_by: ctx.user.id })
    .select("id")
    .single();
  if (error || !row) return { ok: false, message: "The token couldn't be made. Try again." };
  if (status === "waiting") {
    const { data: approval } = await admin
      .from("approvals")
      .insert({ workspace_id: ctx.workspace.id, project_id: project.id, kind: "token", title: `${project.name}: coding agent token “${parsed.data.name}”`, requested_by: ctx.user.id, payload: { token_id: row.id, scopes: parsed.data.scopes } })
      .select("id")
      .single();
    if (approval) await admin.from("project_tokens").update({ approval_id: approval.id }).eq("id", row.id);
  }
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "token.created", target: `${project.name}: ${parsed.data.name}`, details: { scopes: parsed.data.scopes, status, simulated: true } });
  revalidatePath(`/p/${project.id}/settings`);
  return { ok: true, token, status };
}

async function tokenInWorkspace(tokenId: string, workspaceId: string) {
  if (!uuid.safeParse(tokenId).success) return null;
  const { data } = await createAdminDb().from("project_tokens").select("id, name, status, approval_id, project_id, projects!inner(id, name, workspace_id)").eq("id", tokenId).maybeSingle();
  return data && data.projects.workspace_id === workspaceId ? data : null;
}

/** An Owner or Admin approves a waiting token (the Approvals page is M5; the token row offers it meanwhile). */
export async function approveProjectToken(raw: { tokenId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!canManageMembers(ctx.role)) return { ok: false, message: "Only Owners and Admins approve tokens." };
  const t = await tokenInWorkspace(raw.tokenId, ctx.workspace.id);
  if (!t) return { ok: false, message: "That token isn't in this workspace." };
  if (t.status !== "waiting") return { ok: false, message: t.status === "active" ? "That token is already active." : "That token was revoked." };
  const admin = createAdminDb();
  const now = new Date().toISOString();
  await admin.from("project_tokens").update({ status: "active" }).eq("id", t.id);
  if (t.approval_id) await admin.from("approvals").update({ status: "approved", decided_by: ctx.user.id, decided_at: now }).eq("id", t.approval_id);
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "token.approved", target: `${t.projects.name}: ${t.name}`, details: {} });
  revalidatePath(`/p/${t.project_id}/settings`);
  return { ok: true };
}

/** Revoke: the token stops working at once (in the real product, the MCP server refuses it). */
export async function revokeProjectToken(raw: { tokenId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't revoke tokens." };
  const t = await tokenInWorkspace(raw.tokenId, ctx.workspace.id);
  if (!t) return { ok: false, message: "That token isn't in this workspace." };
  if (t.status === "revoked") return { ok: true };
  const admin = createAdminDb();
  const now = new Date().toISOString();
  await admin.from("project_tokens").update({ status: "revoked", revoked_at: now }).eq("id", t.id);
  if (t.approval_id && t.status === "waiting") await admin.from("approvals").update({ status: "rejected", decided_by: ctx.user.id, decided_at: now, reason: "Revoked before approval" }).eq("id", t.approval_id);
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "token.revoked", target: `${t.projects.name}: ${t.name}`, details: {} });
  revalidatePath(`/p/${t.project_id}/settings`);
  return { ok: true };
}
