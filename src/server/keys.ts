import "server-only";

import { envKeys, type DevPart } from "@/lib/dev-view";
import { keyRows, type KeyEnv, type KeyRow, type StoredKey } from "@/lib/keys";
import type { AdminDb } from "./db";
import type { SavedImport } from "./import";

/**
 * A project's keys and passwords per version (C-10, simulated): the ones its parts and its repo need, with what's
 * recorded for each. Values are never stored anywhere, so none can be read back.
 */
export async function projectKeyRows(
  admin: AdminDb,
  input: { projectId: string; parts: Pick<DevPart, "status" | "provider" | "grp">[]; connected: string[]; envLive: { staging: boolean; production: boolean } },
): Promise<KeyRow[]> {
  const [{ data: imp }, { data: stored }] = await Promise.all([
    admin.from("repo_imports").select("analysis").eq("project_id", input.projectId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("project_keys").select("name, environment, status, set_by_name, set_at").eq("project_id", input.projectId),
  ]);
  const saved = (imp?.analysis ?? null) as unknown as SavedImport | null;
  const env = envKeys({ parts: input.parts as DevPart[], repoKeys: imp ? (saved?.analysis.keys ?? []) : null, connected: input.connected, envLive: input.envLive });
  const rows: StoredKey[] = (stored ?? []).map((k) => ({ name: k.name, environment: k.environment as KeyEnv, status: k.status as StoredKey["status"], by: k.set_by_name, at: k.set_at }));
  return keyRows(env, rows);
}
