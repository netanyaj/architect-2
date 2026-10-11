"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Json } from "@/lib/database.types";
import { mcpAllowed } from "@/lib/mcp-connections";
import { canBuild, canManageMembers } from "@/lib/permissions";
import { connectRefusal } from "@/lib/policies";
import { createAdminDb, type AdminDb } from "../db";
import { parseAuthHeader, testMcpServer, urlProblem } from "../mcp-client";
import { loadPolicies } from "../policy";
import { getAppContext, type AppContext } from "../workspace";
import type { ActionResult } from "./members";

/*
 * MCP servers in Connections (M6, PRD BL-9). Adding one stores its name, URL and optional auth header (Vault); "Test
 * connection" is a real MCP initialize + tools/list (src/server/mcp-client.ts). At most 10 tests per person an hour,
 * and every test is in the audit log. With governance on, only servers on the allowed list can be added; with it
 * off, Builders and up add any server.
 */

const TESTS_PER_HOUR = 10;
const addInput = z.object({ name: z.string().trim().min(1, "Give the server a name.").max(60, "Keep the name under 60 characters."), url: z.string().trim().max(500), authHeader: z.string().max(4000).optional() });

export type McpCheck = { ok: boolean; tools: string[]; error: string | null; checkedAt: string };

async function testsLastHour(admin: AdminDb, ctx: AppContext): Promise<number> {
  const { count } = await admin
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ctx.workspace.id)
    .eq("action", "mcp.tested")
    .eq("details->>user_id", ctx.user.id)
    .gte("created_at", new Date(Date.now() - 3600_000).toISOString());
  return count ?? 0;
}

/** Runs the test, saves what it found, and audits it. */
async function runTest(admin: AdminDb, ctx: AppContext, row: { id: string; name: string | null; url: string | null }): Promise<McpCheck> {
  const { data: secret } = await admin.rpc("connection_secret", { p_connection: row.id });
  const result = await testMcpServer(row.url ?? "", secret ?? null);
  const checkedAt = new Date().toISOString();
  await admin
    .from("connections")
    .update(
      result.ok
        ? { status: "connected", tools: result.tools as unknown as Json, checked_at: checkedAt, check_error: null }
        : { status: "missing", checked_at: checkedAt, check_error: result.error },
    )
    .eq("id", row.id);
  await admin.from("audit_log").insert({
    workspace_id: ctx.workspace.id,
    actor: ctx.name,
    action: "mcp.tested",
    target: row.name ?? row.url ?? "MCP server",
    details: { user_id: ctx.user.id, url: row.url, ok: result.ok, tools: result.ok ? result.tools.length : 0, error: result.ok ? null : result.error } as Json,
  });
  return { ok: result.ok, tools: result.ok ? result.tools.map((t) => t.name) : [], error: result.ok ? null : result.error, checkedAt };
}

/** Add an MCP server: checks the URL and the rules, stores it (header in Vault), then tests it once. */
export async function addMcpServer(raw: z.input<typeof addInput>): Promise<ActionResult<{ connectionId: string; check: McpCheck | null }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't add MCP servers. Ask an Owner, Admin or Builder." };
  const parsed = addInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "That server isn't valid." };
  const { name, url } = parsed.data;
  const problem = urlProblem(url);
  if (problem) return { ok: false, message: problem };
  if (parsed.data.authHeader?.trim() && !parseAuthHeader(parsed.data.authHeader)) return { ok: false, message: "Write the header as Name: value, like Authorization: Bearer …" };
  const admin = createAdminDb();
  const policies = await loadPolicies(admin, ctx.workspace.id);
  const refusal = connectRefusal(policies.apps, policies.governance, canManageMembers(ctx.role));
  if (refusal) return { ok: false, message: refusal };
  if (policies.governance && !mcpAllowed(url, policies.apps.mcp)) {
    return { ok: false, message: "That server isn't on your organisation's list. An Owner or Admin adds it in Governance › Apps and MCP servers first." };
  }
  const { data: row, error } = await admin
    .from("connections")
    .insert({ workspace_id: ctx.workspace.id, provider: "mcp", kind: "mcp", status: "missing", name, url, set_by_name: ctx.name, set_at: new Date().toISOString() })
    .select("id, name, url")
    .single();
  if (error || !row) return { ok: false, message: error?.message.includes("connections_mcp_url") ? "That server is already in Connections." : "The server couldn't be added. Try again." };
  if (parsed.data.authHeader?.trim()) {
    const { error: vaultError } = await admin.rpc("set_connection_secret", { p_connection: row.id, p_value: parsed.data.authHeader.trim() });
    if (vaultError) {
      await admin.from("connections").delete().eq("id", row.id);
      return { ok: false, message: "The auth header couldn't be stored safely. Nothing was saved. Try again." };
    }
  }
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "mcp.added", target: name, details: { url, auth_header: Boolean(parsed.data.authHeader?.trim()) } as Json });
  const check = (await testsLastHour(admin, ctx)) < TESTS_PER_HOUR ? await runTest(admin, ctx, row) : null;
  revalidatePath("/connections");
  return { ok: true, connectionId: row.id, check };
}

/** Test connection: a real initialize + tools/list. 10 per person an hour; audited. */
export async function testMcpConnection(input: { connectionId: string }): Promise<ActionResult<{ check: McpCheck }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't test MCP servers." };
  if (!z.string().uuid().safeParse(input.connectionId).success) return { ok: false, message: "That server isn't in this workspace." };
  const admin = createAdminDb();
  const { data: row } = await admin.from("connections").select("id, name, url").eq("id", input.connectionId).eq("workspace_id", ctx.workspace.id).eq("kind", "mcp").maybeSingle();
  if (!row) return { ok: false, message: "That server isn't in this workspace." };
  if ((await testsLastHour(admin, ctx)) >= TESTS_PER_HOUR) return { ok: false, message: `Up to ${TESTS_PER_HOUR} connection tests an hour. Try again later.` };
  const check = await runTest(admin, ctx, row);
  revalidatePath("/connections");
  return { ok: true, check };
}

/** Remove an MCP server: its auth header goes with it; agents that listed it keep the name until edited. */
export async function removeMcpServer(input: { connectionId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't remove MCP servers." };
  if (!z.string().uuid().safeParse(input.connectionId).success) return { ok: false, message: "That server isn't in this workspace." };
  const admin = createAdminDb();
  const { data: row } = await admin.from("connections").delete().eq("id", input.connectionId).eq("workspace_id", ctx.workspace.id).eq("kind", "mcp").select("name, url").maybeSingle();
  if (!row) return { ok: false, message: "That server isn't in this workspace." };
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "mcp.removed", target: row.name ?? row.url ?? "MCP server", details: { url: row.url } as Json });
  revalidatePath("/connections");
  return { ok: true };
}
