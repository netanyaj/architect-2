/**
 * Keys and passwords (C-10), simulated: per version, a key is provided by Architect (a connection, Lyzr's key, the
 * app's database), set by a person (who, when; the value is never stored), waiting for an admin, or missing. A key
 * missing for Live holds Go live. Shared by client and server; no I/O.
 */
import type { EnvKey } from "./dev-view";
import { providerName } from "./providers";

export type KeyEnv = "preview" | "staging" | "production";
export const KEY_ENVS: KeyEnv[] = ["preview", "staging", "production"];
export const KEY_ENV_LABEL: Record<KeyEnv, string> = { preview: "Test version", staging: "Team version", production: "Live" };

export type StoredKey = { name: string; environment: KeyEnv; status: "set" | "waiting"; by: string; at: string };
export type KeyCell = { state: "auto" | "set" | "waiting" | "missing"; by?: string; at?: string; note?: string };
export type KeyRow = { name: string; why: string; service: string | null; cells: Record<KeyEnv, KeyCell> };

export function keyRows(env: EnvKey[], stored: StoredKey[]): KeyRow[] {
  return env.map((k) => {
    const cell = (e: KeyEnv): KeyCell => {
      const s = stored.find((x) => x.name === k.name && x.environment === e);
      if (s) return { state: s.status, by: s.by, at: s.at };
      // `test` is true when Architect provides it: a connected app, Lyzr's own key, the app's database.
      if (k.test) return { state: "auto", note: k.service ? `From your ${providerName(k.service)} connection` : "Provided by Architect" };
      return { state: "missing", note: k.service ? `Connect ${providerName(k.service)}, or set it` : undefined };
    };
    return { name: k.name, why: k.why, service: k.service ?? null, cells: { preview: cell("preview"), staging: cell("staging"), production: cell("production") } };
  });
}

/** Keys Live can't run without. A key that comes from connecting an app is left to that app's Connect row. */
export function missingForLive(rows: KeyRow[]): string[] {
  return rows.filter((r) => !r.service && (r.cells.production.state === "missing" || r.cells.production.state === "waiting")).map((r) => r.name);
}

export const KEY_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;

/** Why a value can't be saved, or null. The value itself is checked and thrown away. */
export function keyValueProblem(name: string, value: string): string | null {
  if (!KEY_NAME.test(name)) return "Key names use capital letters, digits and underscores, like HUBSPOT_ACCESS_TOKEN.";
  if (!value.trim()) return "Type the value first.";
  if (value.length > 4096) return "That value is longer than 4,096 characters.";
  return null;
}
