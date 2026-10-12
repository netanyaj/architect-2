"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { apiKeyProblem, apiKeyServiceId } from "@/lib/api-keys";
import { canBuild, canManageMembers } from "@/lib/permissions";
import { connectRefusal, scopeOf } from "@/lib/policies";
import { providerName } from "@/lib/providers";
import { createAdminDb } from "../db";
import { blockedServices, loadPolicies } from "../policy";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";

/**
 * Connect an app. SIMULATED in this prototype (BUILD-SPEC section 1): there is no real OAuth, the status just
 * flips to connected. The UI labels it with the Simulated tag. Refuses apps the connector policy blocks.
 */
export async function connectProvider(input: { connectionId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't connect apps. Ask an Owner, Admin or Builder." };
  if (!z.string().uuid().safeParse(input.connectionId).success) return { ok: false, message: "That app isn't in this workspace." };

  const admin = createAdminDb();
  const { data: conn } = await admin
    .from("connections")
    .select("id, provider, status, kind")
    .eq("id", input.connectionId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!conn) return { ok: false, message: "That app isn't in this workspace." };
  if (conn.status === "connected") return { ok: true };
  if (conn.kind === "api_key") return { ok: false, message: "This one connects with a key. Use Add the key." };

  if ((await blockedServices(admin, ctx.workspace.id, null, [conn.provider])).length) {
    return { ok: false, message: "Your organisation's policy doesn't allow this app. IT has to approve it first." };
  }
  const policies = await loadPolicies(admin, ctx.workspace.id);
  const refusal = connectRefusal(policies.apps, policies.governance, canManageMembers(ctx.role));
  if (refusal) return { ok: false, message: refusal };

  const scopes = policies.governance ? [scopeOf(policies.apps, conn.provider)] : ["read_write"];
  const { error } = await admin.from("connections").update({ status: "connected", scopes }).eq("id", conn.id);
  if (error) return { ok: false, message: "The app couldn't be connected. Try again." };
  await admin.from("audit_log").insert({
    workspace_id: ctx.workspace.id,
    actor: ctx.name,
    action: "connection.connected",
    target: conn.provider,
    details: { simulated: true },
  });
  // Parts built against sample data while they waited for this service now work with real data (BL-9).
  const { data: projects } = await admin.from("projects").select("id").eq("workspace_id", ctx.workspace.id);
  const ids = (projects ?? []).map((p) => p.id);
  if (ids.length) await admin.from("items").update({ status: "built", status_detail: null }).in("project_id", ids).eq("provider", conn.provider).eq("status", "needs_connection");
  revalidatePath("/connections");
  return { ok: true };
}

const MAX_API_KEYS = 30;

/**
 * Add or replace an API key connection (BL-9). SIMULATED: the key is checked and thrown away; only that it's set,
 * by whom and when, is recorded. Under governance the service must be an allowed app, as for any connection (C-3).
 */
export async function setApiKey(input: { name: string; value: string }): Promise<ActionResult<{ provider: string }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't add keys. Ask an Owner, Admin or Builder." };
  const problem = apiKeyProblem(input.name ?? "", input.value ?? "");
  if (problem) return { ok: false, message: problem };
  const provider = apiKeyServiceId(input.name);
  const name = providerName(provider);

  const admin = createAdminDb();
  const { data: existing } = await admin.from("connections").select("id, kind").eq("workspace_id", ctx.workspace.id).eq("provider", provider).maybeSingle();
  if (existing && existing.kind !== "api_key") return { ok: false, message: `${name} connects by signing in, not with a key. Use Connect ${name} instead.` };
  if ((await blockedServices(admin, ctx.workspace.id, null, [provider])).length) {
    return { ok: false, message: `${name} isn't on your organisation's allowed apps. An Owner or Admin can add it in Governance › Apps.` };
  }
  const policies = await loadPolicies(admin, ctx.workspace.id);
  const refusal = connectRefusal(policies.apps, policies.governance, canManageMembers(ctx.role));
  if (refusal) return { ok: false, message: refusal };

  const row = { status: "connected", set_by_name: ctx.name, set_at: new Date().toISOString() };
  if (existing) {
    await admin.from("connections").update(row).eq("id", existing.id);
  } else {
    const { count } = await admin.from("connections").select("id", { count: "exact", head: true }).eq("workspace_id", ctx.workspace.id).eq("kind", "api_key");
    if ((count ?? 0) >= MAX_API_KEYS) return { ok: false, message: `Up to ${MAX_API_KEYS} API keys per workspace.` };
    const { error } = await admin.from("connections").insert({ workspace_id: ctx.workspace.id, provider, kind: "api_key", scopes: [], ...row });
    if (error) return { ok: false, message: "The key couldn't be saved. Try again." };
  }
  // The value is never logged or stored: the audit row says only that it was set.
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: existing ? "connection.api_key_replaced" : "connection.api_key_set", target: provider, details: { simulated: true } });
  const { data: projects } = await admin.from("projects").select("id").eq("workspace_id", ctx.workspace.id);
  const ids = (projects ?? []).map((p) => p.id);
  if (ids.length) await admin.from("items").update({ status: "built", status_detail: null }).in("project_id", ids).eq("provider", provider).eq("status", "needs_connection");
  revalidatePath("/connections");
  return { ok: true, provider };
}

/** Clear an API key: the connection stays, Not set, so the parts that use it show they need it. */
export async function clearApiKey(input: { connectionId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't remove keys." };
  if (!z.string().uuid().safeParse(input.connectionId).success) return { ok: false, message: "That key isn't in this workspace." };
  const admin = createAdminDb();
  const { data: conn } = await admin.from("connections").select("id, provider, kind").eq("id", input.connectionId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!conn || conn.kind !== "api_key") return { ok: false, message: "That key isn't in this workspace." };
  await admin.from("connections").update({ status: "missing", set_by_name: null, set_at: null }).eq("id", conn.id);
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "connection.api_key_removed", target: conn.provider, details: { simulated: true } });
  revalidatePath("/connections");
  return { ok: true };
}
