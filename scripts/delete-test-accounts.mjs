// Deletes leftover test accounts and every workspace they own (projects and the rest cascade).
// Matches e2e-*@example.com accounts older than a day, plus any emails passed with --also=a@b.c,d@e.f.
// Dry run by default: prints what it would delete. Add --yes to delete.
//   node --env-file=.env.local scripts/delete-test-accounts.mjs --also=test@abc.com
//   node --env-file=.env.local scripts/delete-test-accounts.mjs --also=test@abc.com --yes
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const yes = process.argv.includes("--yes");
const also = new Set((process.argv.find((a) => a.startsWith("--also="))?.slice(7) ?? "").split(",").filter(Boolean));
const dayAgo = Date.now() - 24 * 3600_000;

const users = [];
for (let page = 1; ; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  users.push(...data.users);
  if (data.users.length < 200) break;
}
const stale = users.filter((u) => (/^e2e-.*@example\.com$/.test(u.email ?? "") && new Date(u.created_at).getTime() < dayAgo) || also.has(u.email ?? ""));
console.log(`${users.length} accounts; ${stale.length} to delete${yes ? "" : " (dry run: add --yes to delete)"}:`);
for (const u of stale) {
  const { data: owned } = await db.from("members").select("workspace_id, workspaces(name)").eq("user_id", u.id).eq("role", "owner");
  console.log(`  ${u.email} · ${(owned ?? []).map((o) => o.workspaces?.name).join(" + ") || "no workspaces"}`);
  if (!yes) continue;
  for (const o of owned ?? []) await db.from("workspaces").delete().eq("id", o.workspace_id);
  const { error } = await db.auth.admin.deleteUser(u.id);
  console.log(error ? `    failed: ${error.message}` : "    deleted");
}
