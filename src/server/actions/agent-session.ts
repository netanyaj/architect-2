"use server";

import type { Json } from "@/lib/database.types";
import { agentSession, sessionAuditAction, sessionPart } from "@/lib/mcp";
import { createAdminDb } from "../db";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";

/* ?sim=byoagent (F4): the scripted coding-agent session writes its steps to the audit log, as the MCP server would,
   so the audit log's "Coding agent" filter has rows. Each row is marked simulated. Once per session: a second call
   within two minutes for the same project writes nothing. */

const ONCE_MS = 2 * 60_000;

export async function recordAgentSession(input: { projectId: string }): Promise<ActionResult<{ written: number }>> {
  const ctx = await getAppContext();
  const admin = createAdminDb();
  const { data: project } = await admin.from("projects").select("id, name, workspace_id, owner_display_name, owner_id, repo_full_name, current_version").eq("id", input.projectId).maybeSingle();
  if (!project || project.workspace_id !== ctx.workspace.id) return { ok: false, message: "That project isn't in this workspace." };
  const { data: tokens } = await admin.from("project_tokens").select("status").eq("project_id", project.id).eq("status", "active");
  if (!tokens?.length) return { ok: false, message: "No coding agent is connected: make a project token first." };

  const since = new Date(Date.now() - ONCE_MS).toISOString();
  const { data: recent } = await admin.from("audit_log").select("id, target").eq("workspace_id", ctx.workspace.id).like("action", "coding_agent.%").gte("created_at", since);
  if ((recent ?? []).some((r) => (r.target ?? "").startsWith(`${project.name}:`))) return { ok: true, written: 0 };

  const { data: bp } = await admin.from("blueprints").select("id, version").eq("project_id", project.id).order("version", { ascending: false }).limit(1).maybeSingle();
  const { data: items } = bp ? await admin.from("items").select("key, title, grp, status").eq("blueprint_id", bp.id) : { data: [] };
  const part = sessionPart(items ?? []);
  if (!part) return { ok: false, message: "Nothing works yet for a coding agent to change." };
  // Named as the session on the page names it: "Claude Code (you)", or the owner's first name.
  const { data: member } = project.owner_id && project.owner_id !== ctx.user.id ? await admin.from("members").select("display_name").eq("workspace_id", ctx.workspace.id).eq("user_id", project.owner_id).maybeSingle() : { data: null };
  const owner = project.owner_id === ctx.user.id ? "you" : (project.owner_display_name ?? member?.display_name?.split(" ")[0] ?? "a teammate");
  const session = agentSession({ part, partCount: (items ?? []).filter((i) => i.status !== "dropped").length, version: bp?.version ?? 1, owner, repo: Boolean(project.repo_full_name) });
  const rows = session.steps
    .filter((s) => s.who === "agent")
    .map((s) => ({
      workspace_id: ctx.workspace.id,
      actor: `Coding agent: ${session.agent}`,
      action: sessionAuditAction(s),
      target: `${project.name}: ${s.text}`,
      details: { via: "mcp", part: session.partTitle, simulated: true } as Json,
    }));
  await admin.from("audit_log").insert(rows);
  return { ok: true, written: rows.length };
}
