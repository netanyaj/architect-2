import "server-only";

import type { AdminDb } from "./db";

/** A workspace's own Lyzr key (M5.10), in Vault. Read on the server only; the browser sees its last 4 characters. */
export async function workspaceLyzrKey(admin: AdminDb, workspaceId: string): Promise<string | null> {
  const { data, error } = await admin.rpc("workspace_secret", { p_workspace: workspaceId, p_name: "lyzr_api_key" });
  return error || !data ? null : data;
}

export type LyzrKeyStatus = { connected: false } | { connected: true; last4: string; setBy: string; setAt: string };

export async function lyzrKeyStatus(admin: AdminDb, workspaceId: string): Promise<LyzrKeyStatus> {
  const { data } = await admin.from("workspace_secrets").select("last4, set_by_name, set_at").eq("workspace_id", workspaceId).eq("name", "lyzr_api_key").maybeSingle();
  return data ? { connected: true, last4: data.last4, setBy: data.set_by_name, setAt: data.set_at } : { connected: false };
}
