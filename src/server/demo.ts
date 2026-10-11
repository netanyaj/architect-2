import "server-only";

import type { AdminDb } from "./db";

/** Demo visitors (anonymous sign-ins) and their workspaces go after 7 days, in the daily cron. */
export const DEMO_DAYS = 7;

export async function deleteExpiredDemoUsers(admin: AdminDb, now = new Date()): Promise<number> {
  const cutoff = now.getTime() - DEMO_DAYS * 24 * 3600_000;
  const expired: string[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const u of data.users) if (u.is_anonymous && new Date(u.created_at).getTime() < cutoff) expired.push(u.id);
    if (data.users.length < 200) break;
  }
  for (const id of expired) {
    const { data: owned } = await admin.from("members").select("workspace_id").eq("user_id", id).eq("role", "owner");
    for (const m of owned ?? []) await admin.from("workspaces").delete().eq("id", m.workspace_id);
    await admin.auth.admin.deleteUser(id);
  }
  return expired.length;
}
