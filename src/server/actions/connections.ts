"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canBuild, canManageMembers } from "@/lib/permissions";
import { connectRefusal, scopeOf } from "@/lib/policies";
import { createAdminDb } from "../db";
import { blockedServices, loadPolicies } from "../policy";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";

/**
 * Connect an app. SIMULATED in this prototype (BUILD-SPEC §1): there is no real OAuth, the status just
 * flips to connected. The UI labels it with the Simulated tag. Refuses apps the connector policy blocks.
 */
export async function connectProvider(input: { connectionId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't connect apps. Ask an Owner, Admin or Builder." };
  if (!z.string().uuid().safeParse(input.connectionId).success) return { ok: false, message: "That app isn't in this workspace." };

  const admin = createAdminDb();
  const { data: conn } = await admin
    .from("connections")
    .select("id, provider, status")
    .eq("id", input.connectionId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!conn) return { ok: false, message: "That app isn't in this workspace." };
  if (conn.status === "connected") return { ok: true };

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
