import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/database.types";

/** Service-role client for test setup and cleanup only (never shipped to the browser). */
export function adminDb() {
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type TestUser = { id: string; email: string; password: string };

/** A confirmed email account, so tests don't depend on reading an inbox. */
export async function createTestUser(label: string): Promise<TestUser> {
  const email = `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const password = `e2e-${Math.random().toString(36).slice(2)}-Pw1`;
  const { data, error } = await adminDb().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    // First name from the label ("viewer" → "Viewer Tester"), so each account's workspace name differs.
    user_metadata: { full_name: `${label.charAt(0).toUpperCase()}${label.slice(1)} Tester` },
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  return { id: data.user.id, email, password };
}

/** Removes the account and every workspace it owns (projects and the rest cascade). */
export async function deleteTestUser(user: TestUser) {
  const db = adminDb();
  const { data: owned } = await db.from("members").select("workspace_id").eq("user_id", user.id).eq("role", "owner");
  for (const m of owned ?? []) await db.from("workspaces").delete().eq("id", m.workspace_id);
  await db.auth.admin.deleteUser(user.id);
}

/** The test user's seeded demo workspace. */
export async function demoWorkspace(user: TestUser): Promise<string> {
  const { data } = await adminDb().from("members").select("workspace_id, workspaces!inner(kind)").eq("user_id", user.id).eq("role", "owner").eq("workspaces.kind", "demo").single();
  return data!.workspace_id;
}

/** Connects a workspace's own Lyzr key (M5.10) without the UI, using the key the tests run with. */
export async function connectLyzr(workspaceId: string, user: TestUser) {
  const key = process.env.LYZR_API_KEY;
  if (!key) throw new Error("LYZR_API_KEY isn't set for the tests.");
  const { error } = await adminDb().rpc("set_workspace_secret", { p_workspace: workspaceId, p_name: "lyzr_api_key", p_value: key, p_by: user.id, p_by_name: "Tester" });
  if (error) throw new Error(`connectLyzr: ${error.message}`);
}
