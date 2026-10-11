"use server";

import { revalidatePath } from "next/cache";
import { canManageMembers } from "@/lib/permissions";
import { createAdminDb } from "../db";
import { listLyzrAgents, LyzrError } from "../lyzr";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";

const ADMINS_ONLY = "Only Owners and Admins can connect or remove the workspace's Lyzr key.";

/**
 * Connections › Lyzr Studio › Connect with your Lyzr API key (M5.10). Checked with Lyzr first (it must list the
 * account's agents), then kept encrypted in Vault. The browser never gets it back; only its last 4 characters.
 * A new key is a new Studio account, so agents made with the old one are forgotten here (they stay in that Studio).
 */
export async function setLyzrKey(input: { value: string }): Promise<ActionResult<{ last4: string }>> {
  const ctx = await getAppContext();
  if (!canManageMembers(ctx.role)) return { ok: false, message: ADMINS_ONLY };
  const value = (input.value ?? "").trim();
  if (value.length < 12 || value.length > 200 || /\s/.test(value)) return { ok: false, message: "That doesn't look like a Lyzr API key. Copy it from Lyzr Studio › Account › API keys." };
  try {
    await listLyzrAgents(value);
  } catch (err) {
    const status = err instanceof LyzrError ? err.status : undefined;
    return {
      ok: false,
      message: status === 401 || status === 403 ? "Lyzr didn't accept that key. Check it in Lyzr Studio › Account › API keys." : "Lyzr Studio didn't answer, so the key couldn't be checked. Nothing was saved. Try again.",
    };
  }
  const admin = createAdminDb();
  const { error } = await admin.rpc("set_workspace_secret", { p_workspace: ctx.workspace.id, p_name: "lyzr_api_key", p_value: value, p_by: ctx.user.id, p_by_name: ctx.name });
  if (error) return { ok: false, message: "The key couldn't be saved. Nothing changed. Try again." };
  await admin.from("agents").update({ lyzr_agent_id: null, studio_synced_at: null, studio_error: null }).eq("workspace_id", ctx.workspace.id);
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "lyzr.key_set", target: "Lyzr Studio", details: { last4: value.slice(-4) } });
  revalidatePath("/connections");
  return { ok: true, last4: value.slice(-4) };
}

/** Removes the workspace's Lyzr key. Its agents stay in that Studio; here, Studio actions are Simulated again. */
export async function removeLyzrKey(): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!canManageMembers(ctx.role)) return { ok: false, message: ADMINS_ONLY };
  const admin = createAdminDb();
  const { error } = await admin.rpc("delete_workspace_secret", { p_workspace: ctx.workspace.id, p_name: "lyzr_api_key" });
  if (error) return { ok: false, message: "The key couldn't be removed. Try again." };
  await admin.from("agents").update({ lyzr_agent_id: null, studio_synced_at: null, studio_error: null }).eq("workspace_id", ctx.workspace.id);
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "lyzr.key_removed", target: "Lyzr Studio", details: {} });
  revalidatePath("/connections");
  return { ok: true };
}
