import "server-only";

import { agentGraph } from "@/lib/agents";
import { usesMeetingPrepSample } from "@/lib/sim/preview";
import { toModelChoice } from "@/lib/models";
import type { AdminDb } from "./db";
import { createLyzrAgent, LyzrError } from "./lyzr";
import { workspaceLyzrKey } from "./lyzr-key";
import { z } from "zod";
import { loadPolicies } from "./policy";

const uuid = z.string().uuid();

/* Agents' rows and their Lyzr Studio agents, shared by the agent actions and the simulator (server-only: these take
   the service-role client, so they must never be server actions). */

/** Parts whose agent exists for real once the build has made them work. */
const WORKS = ["built", "sample_data"];

export const AGENT_COLUMNS =
  "id, workspace_id, project_id, item_key, name, description, framework, model, instructions, tools, knowledge, temperature, max_tokens, lyzr_agent_id, studio_synced_at, studio_error, run_as" as const;

export type AgentRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  item_key: string | null;
  name: string;
  description: string | null;
  framework: string;
  model: string;
  instructions: string | null;
  tools: string[];
  knowledge: string[];
  temperature: number;
  max_tokens: number;
  lyzr_agent_id: string | null;
  studio_synced_at: string | null;
  studio_error: string | null;
  run_as: string;
};

/** The seeded Research agent in Meeting Prep: the one shared demo agent (M5.10). */
export async function isDemoAgent(admin: AdminDb, row: Pick<AgentRow, "project_id" | "name">): Promise<boolean> {
  if (row.name !== "Research agent" || !row.project_id) return false;
  const { data } = await admin.from("projects").select("name").eq("id", row.project_id).maybeSingle();
  return Boolean(data && usesMeetingPrepSample(data.name));
}

export type ItemRow = { id: string; key: string; title: string; description: string | null; proved_when: string; grp: string; status: string; provider: string | null; position: number; framework: string | null };

/**
 * The graph from a project's plan, and each agent part's settings row. The first time, a row is made with defaults:
 * the policy's default model for app agents (C-2), or the project's model with governance off; imported agents keep
 * their framework (B-6), every other agent runs on Lyzr Studio. Shared by the Agents view and the post-build sync.
 */
export async function agentRowsFor(
  admin: AdminDb,
  p: { id: string; workspace_id: string; name: string; prompt: string | null; model: string | null },
  items: ItemRow[],
  files: { name: string | null; path: string }[],
): Promise<{ spec: ReturnType<typeof agentGraph>; rows: AgentRow[] }> {
  const parts = items.map((i) => ({ key: i.key, title: i.title, description: i.description, provedWhen: i.proved_when, grp: i.grp, status: i.status, provider: i.provider, position: i.position }));
  const spec = agentGraph({ projectName: p.name, prompt: p.prompt, parts, uploads: files.map((f) => f.name ?? f.path) });
  const { data: existing } = await admin.from("agents").select(AGENT_COLUMNS).eq("project_id", p.id);
  const rows = (existing ?? []) as AgentRow[];
  const projectModel = toModelChoice(p.model);
  const policies = await loadPolicies(admin, p.workspace_id);
  const agentDefault = policies.governance ? policies.models.agentDefault : projectModel;
  const missing = spec.agents.filter((a) => !rows.some((r) => r.item_key === a.key));
  const frameworkOf = (key: string) => {
    const f = items.find((i) => i.key === key)?.framework;
    return f === "crewai" || f === "langgraph" ? f : "lyzr";
  };
  if (missing.length) {
    const { data: added } = await admin
      .from("agents")
      .insert(
        missing.map((a) => ({
          workspace_id: p.workspace_id,
          project_id: p.id,
          item_key: a.key,
          name: a.name,
          description: a.description,
          instructions: a.instructions,
          tools: a.tools,
          knowledge: a.knowledge,
          framework: frameworkOf(a.key),
          model: spec.sample ? "claude" : agentDefault,
        })),
      )
      .select(AGENT_COLUMNS);
    rows.push(...((added ?? []) as AgentRow[]));
  }
  return { spec, rows };
}

/** The agent rows for a project, read and made with the service role (after a build settles). */
export async function ensureAgentRows(admin: AdminDb, p: { id: string; workspace_id: string; name: string; prompt: string | null; model: string | null }): Promise<AgentRow[]> {
  const { data: bp } = await admin.from("blueprints").select("id").eq("project_id", p.id).order("version", { ascending: false }).limit(1).maybeSingle();
  const [{ data: items }, { data: files }] = await Promise.all([
    bp ? admin.from("items").select("id, key, title, description, proved_when, grp, status, provider, position, framework").eq("blueprint_id", bp.id) : Promise.resolve({ data: [] as ItemRow[] }),
    admin.from("files").select("name, path").eq("project_id", p.id).eq("kind", "upload"),
  ]);
  return (await agentRowsFor(admin, p, items ?? [], files ?? [])).rows;
}

export async function agentInWorkspace(admin: AdminDb, agentId: string, workspaceId: string): Promise<AgentRow | null> {
  if (!uuid.safeParse(agentId).success) return null;
  const { data } = await admin.from("agents").select(AGENT_COLUMNS).eq("id", agentId).eq("workspace_id", workspaceId).maybeSingle();
  return (data as AgentRow | null) ?? null;
}

export function lyzrSpec(row: AgentRow) {
  return {
    name: `${row.name} · Architect`,
    description: row.description ?? row.name,
    role: row.name,
    instructions: row.instructions ?? row.name,
    output: "Plain text, as the instructions say.",
    temperature: Number(row.temperature),
    maxTokens: Number(row.max_tokens),
  };
}

/** Whether the agent's part works (built, or working on sample data): only then is it made in Studio. */
export async function partWorks(admin: AdminDb, row: Pick<AgentRow, "project_id" | "item_key">): Promise<boolean> {
  if (!row.project_id || !row.item_key) return false;
  const { data: bp } = await admin.from("blueprints").select("id").eq("project_id", row.project_id).order("version", { ascending: false }).limit(1).maybeSingle();
  if (!bp) return false;
  const { data: item } = await admin.from("items").select("status").eq("blueprint_id", bp.id).eq("key", row.item_key).maybeSingle();
  return Boolean(item && WORKS.includes(item.status));
}

/** Makes one agent in the workspace's own Studio, recording why when it can't. Returns its Studio id, or null. */
export async function makeInStudio(admin: AdminDb, apiKey: string, row: AgentRow): Promise<{ id: string } | { error: string }> {
  try {
    const id = await createLyzrAgent(apiKey, lyzrSpec(row));
    await admin.from("agents").update({ lyzr_agent_id: id, studio_synced_at: new Date().toISOString(), studio_error: null }).eq("id", row.id);
    return { id };
  } catch (err) {
    const error = err instanceof LyzrError ? err.message : "Lyzr Studio couldn't be reached.";
    await admin.from("agents").update({ studio_error: error }).eq("id", row.id);
    return { error };
  }
}

/**
 * After a build settles (M5.10): every Lyzr agent whose part now works is made in the workspace's own Studio, if the
 * workspace has connected its key. A failure leaves the part working; the agent shows "Not in Studio yet · Retry".
 * Agents get their settings rows first, the same way the Agents view makes them.
 */
export async function syncBuiltAgents(admin: AdminDb, projectId: string): Promise<number> {
  const { data: p } = await admin.from("projects").select("id, workspace_id, name, prompt, model").eq("id", projectId).maybeSingle();
  if (!p) return 0;
  const apiKey = await workspaceLyzrKey(admin, p.workspace_id);
  if (!apiKey) return 0;
  const rows = await ensureAgentRows(admin, p);
  let made = 0;
  for (const row of rows) {
    if (row.lyzr_agent_id || row.framework !== "lyzr" || row.studio_error) continue;
    if (await isDemoAgent(admin, row)) continue;
    if (!(await partWorks(admin, row))) continue;
    if ("id" in (await makeInStudio(admin, apiKey, row))) made++;
  }
  return made;
}

