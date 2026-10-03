// Checks the live Supabase project as a signed-out browser would (anon key): RLS hides every row,
// and the seed/create/reset functions can't be called from the API. Prints no keys.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const tables = ["workspaces", "members", "projects", "blueprints", "items", "questions", "defaults", "checks", "proofs",
  "runs", "events", "usage_ledger", "messages", "change_proposals", "files", "connections", "environments",
  "deployments", "agents", "agent_runs", "repo_imports", "policies", "approvals", "audit_log", "support_tickets"];
let ok = true;
for (const t of tables) {
  const a = await anon.from(t).select("*", { count: "exact", head: true });
  const s = await service.from(t).select("*", { count: "exact", head: true });
  const pass = !s.error && (a.error || a.count === 0);
  ok &&= pass;
  console.log(`${pass ? "ok  " : "FAIL"} ${t.padEnd(17)} rows=${s.count ?? s.error?.message}  anon sees=${a.error ? "denied" : a.count}`);
}
for (const [fn, args] of [
  ["seed_demo_workspace", { p_workspace: crypto.randomUUID(), p_owner: crypto.randomUUID() }],
  ["create_demo_workspace", { p_user: crypto.randomUUID(), p_email: "x@example.com", p_name: "x" }],
  ["reset_demo_workspace", { p_workspace: crypto.randomUUID(), p_owner: crypto.randomUUID() }],
]) {
  const { error } = await anon.rpc(fn, args);
  const pass = Boolean(error) && /permission denied|not find|42501/i.test(`${error.message} ${error.code}`);
  ok &&= pass;
  console.log(`${pass ? "ok  " : "FAIL"} anon can't call ${fn}: ${error ? error.code + " " + error.message : "CALL SUCCEEDED"}`);
}
console.log(ok ? "\nAll checks passed." : "\nSome checks failed.");
process.exit(ok ? 0 : 1);
