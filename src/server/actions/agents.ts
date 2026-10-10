"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { agentGraph, type AgentOrigin, type GraphEnd } from "@/lib/agents";
import type { Json } from "@/lib/database.types";
import { GatewayRateLimited, GatewaySlow, GatewayUnavailable, runAgent, type AgentRuntime } from "@/lib/gateway";
import { MODEL_CHOICES, MODEL_LABEL, toModelChoice, type ModelChoice } from "@/lib/models";
import { MODEL_NOT_ALLOWED } from "@/lib/policies";
import { canBuild } from "@/lib/permissions";
import { allowedModels } from "../blueprint/write-plan";
import { createAdminDb, createServerDb, type AdminDb } from "../db";
import { createLyzrAgent, LYZR_MODEL, lyzrConfigured, LyzrError, updateLyzrAgent } from "../lyzr";
import { loadPolicies } from "../policy";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";

const uuid = z.string().uuid();
const BUILDERS_ONLY = "Viewers can't change or run agents. Ask an Owner, Admin or Builder.";
/** Try it calls Lyzr Studio on the prototype's account: a cap per person keeps a reviewer's loop from running it dry. */
const TRY_IT_PER_HOUR = 20;
const MESSAGE_LIMIT = 4000;

export type AgentRunView = {
  id: string;
  at: string;
  input: string;
  toolCalls: { name: string; detail: string }[];
  output: string;
  status: "passed" | "failed";
  durationMs: number | null;
  /** "sample": a scripted or build-check run (Simulated). The rest are Try it runs. */
  runtime: AgentRuntime | "sample";
  modelLabel: string | null;
  /** The Studio agent that answered, for Open in Studio. */
  studioAgentId: string | null;
  note: string | null;
};

export type AgentView = {
  id: string;
  key: string;
  itemId: string | null;
  /** The part's build status (items.status). */
  status: string;
  name: string;
  description: string;
  instructions: string;
  output: string;
  model: ModelChoice;
  temperature: number;
  maxTokens: number;
  tools: string[];
  knowledge: string[];
  framework: "lyzr" | "crewai" | "langgraph";
  origin: AgentOrigin;
  lyzrAgentId: string | null;
  syncedAt: string | null;
  handoff: string;
  sample: string;
};

export type AgentsData = {
  trigger: GraphEnd;
  delivery: GraphEnd;
  toolProviders: Record<string, string>;
  agents: AgentView[];
  runs: Record<string, AgentRunView[]>;
  /** Whether Try it runs on Lyzr Studio here (a key is set), and on which model. */
  lyzr: { configured: boolean; model: string };
  /** MCP servers the policy allows agents to use (C-3); null with governance off (any MCP server). */
  mcpServers: string[] | null;
  /** Meeting Prep's sample agents (screen 9) rather than agents derived from the plan. */
  sampleProject: boolean;
};

const AGENT_COLUMNS =
  "id, workspace_id, project_id, item_key, name, description, framework, model, instructions, tools, knowledge, temperature, max_tokens, lyzr_agent_id, studio_synced_at" as const;

type AgentRow = {
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
};

/** Scripted runs for Meeting Prep's sample agents (Simulated). */
function meetingPrepRuns(name: string, at: string): AgentRunView[] {
  const base = { status: "passed" as const, runtime: "sample" as const, modelLabel: "Claude Sonnet", studioAgentId: null, note: null };
  if (name === "Research agent") {
    return [
      {
        ...base,
        id: "sample-research-1",
        at,
        durationMs: 6200,
        input: "Renewal check-in with Dana Ortiz and Sam Lee (Acme), 14:00",
        toolCalls: [
          { name: "Gmail", detail: "search: from:dana@acme.com · 1 thread, 6 messages" },
          { name: "HubSpot", detail: "company: Acme · waiting for IT, skipped" },
        ],
        output:
          "Dana Ortiz (Head of Ops, Acme): last thread 2 Oct, asked for a usage report and flagged two slow support tickets. Sam Lee: no thread in the last 90 days. Company details not available: HubSpot isn't approved yet.",
      },
    ];
  }
  return [
    {
      ...base,
      id: "sample-brief-1",
      at,
      durationMs: 4800,
      input: "Findings from the Research agent, and agenda.pdf (2 pages)",
      toolCalls: [{ name: "PDF summariser", detail: "agenda.pdf · 2 pages → 4 lines" }],
      output:
        "Renewal check-in, 14:00 · Dana Ortiz, Sam Lee (Acme). Dana asked for a usage report on 2 Oct and raised two slow tickets. Agenda: usage, year-two pricing, open tickets. Talking points: 1. Share the usage report. 2. Give a date for both tickets. 3. Ask who signs off year two.",
    },
  ];
}

async function agentInWorkspace(admin: AdminDb, agentId: string, workspaceId: string): Promise<AgentRow | null> {
  if (!uuid.safeParse(agentId).success) return null;
  const { data } = await admin.from("agents").select(AGENT_COLUMNS).eq("id", agentId).eq("workspace_id", workspaceId).maybeSingle();
  return (data as AgentRow | null) ?? null;
}

function lyzrSpec(row: AgentRow) {
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

function runView(r: {
  id: string;
  created_at: string;
  input: Json | null;
  tool_calls: Json | null;
  output: string | null;
  status: string;
  duration_ms: number | null;
  runtime: string;
  model_label: string | null;
}): AgentRunView {
  const input = (r.input ?? {}) as { message?: string; lyzr_agent_id?: string | null; note?: string | null };
  return {
    id: r.id,
    at: r.created_at,
    input: input.message ?? "",
    toolCalls: Array.isArray(r.tool_calls) ? (r.tool_calls as AgentRunView["toolCalls"]) : [],
    output: r.output ?? "",
    status: r.status === "failed" ? "failed" : "passed",
    durationMs: r.duration_ms,
    runtime: r.runtime as AgentRuntime,
    modelLabel: r.model_label,
    studioAgentId: input.lyzr_agent_id ?? null,
    note: input.note ?? null,
  };
}

/**
 * The Agents view for a project: the graph from its plan, each agent's saved settings and its runs.
 * Read under RLS (members only). The first time, each agent part gets its settings row with defaults.
 */
export async function loadAgents(input: { projectId: string }): Promise<ActionResult<{ data: AgentsData }>> {
  if (!uuid.safeParse(input.projectId).success) return { ok: false, message: "That project isn't here." };
  const db = await createServerDb();
  const { data: p } = await db.from("projects").select("id, workspace_id, name, prompt, model, blueprints(id, version)").eq("id", input.projectId).maybeSingle();
  if (!p) return { ok: false, message: "That project isn't here." };
  const latest = [...(p.blueprints ?? [])].sort((a, b) => b.version - a.version)[0];
  const [{ data: items }, { data: files }] = await Promise.all([
    latest
      ? db.from("items").select("id, key, title, description, proved_when, grp, status, provider, position, framework").eq("blueprint_id", latest.id)
      : Promise.resolve({
          data: [] as { id: string; key: string; title: string; description: string | null; proved_when: string; grp: string; status: string; provider: string | null; position: number; framework: string | null }[],
        }),
    db.from("files").select("name, path").eq("project_id", p.id).eq("kind", "upload"),
  ]);
  const parts = (items ?? []).map((i) => ({ key: i.key, title: i.title, description: i.description, provedWhen: i.proved_when, grp: i.grp, status: i.status, provider: i.provider, position: i.position }));
  const spec = agentGraph({ projectName: p.name, prompt: p.prompt, parts, uploads: (files ?? []).map((f) => f.name ?? f.path) });

  // The person's read above proved membership; settings rows are written with the service role.
  const admin = createAdminDb();
  const { data: existing } = await admin.from("agents").select(AGENT_COLUMNS).eq("project_id", p.id);
  const rows = (existing ?? []) as AgentRow[];
  const projectModel = toModelChoice(p.model);
  // New agents start on the policy's default for app agents (C-2); with governance off, on the project's model.
  const policies = await loadPolicies(admin, p.workspace_id);
  const agentDefault = policies.governance ? policies.models.agentDefault : projectModel;
  const missing = spec.agents.filter((a) => !rows.some((r) => r.item_key === a.key));
  // Agents found in an imported repo keep their framework (B-6); every other agent runs on Lyzr Studio.
  const frameworkOf = (key: string) => {
    const f = (items ?? []).find((i) => i.key === key)?.framework;
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

  const ids = rows.map((r) => r.id);
  const itemByKey = new Map((items ?? []).map((i) => [i.key, i]));
  const [{ data: runs }, { data: proofs }] = await Promise.all([
    ids.length
      ? admin.from("agent_runs").select("id, agent_id, created_at, input, tool_calls, output, status, duration_ms, runtime, model_label").in("agent_id", ids).order("created_at", { ascending: false }).limit(200)
      : Promise.resolve({ data: [] }),
    spec.sample
      ? Promise.resolve({ data: [] })
      : db.from("proofs").select("id, item_id, attempt, result, summary, created_at").in("item_id", spec.agents.map((a) => itemByKey.get(a.key)?.id).filter(Boolean) as string[]),
  ]);

  const agents: AgentView[] = [];
  const runsByAgent: Record<string, AgentRunView[]> = {};
  for (const a of spec.agents) {
    const row = rows.find((r) => r.item_key === a.key);
    if (!row) continue;
    const item = itemByKey.get(a.key);
    agents.push({
      id: row.id,
      key: a.key,
      itemId: item?.id ?? null,
      status: item?.status ?? "agreed",
      name: row.name,
      description: row.description ?? a.description,
      instructions: row.instructions ?? a.instructions,
      output: a.output,
      model: toModelChoice(row.model),
      temperature: Number(row.temperature),
      maxTokens: Number(row.max_tokens),
      tools: row.tools,
      knowledge: row.knowledge,
      framework: (["crewai", "langgraph"].includes(row.framework) ? row.framework : "lyzr") as AgentView["framework"],
      origin: row.framework === "crewai" || row.framework === "langgraph" ? row.framework : a.origin,
      lyzrAgentId: row.lyzr_agent_id,
      syncedAt: row.studio_synced_at,
      handoff: a.handoff,
      sample: a.sample,
    });
    const tryRuns = ((runs ?? []) as (Parameters<typeof runView>[0] & { agent_id: string })[]).filter((r) => r.agent_id === row.id).map(runView);
    // Runs from the build: each check run on this part, with the agent's tools (Simulated).
    const buildRuns: AgentRunView[] = spec.sample
      ? meetingPrepRuns(a.name, new Date(Date.now() - 2 * 3600_000).toISOString())
      : (proofs ?? [])
          .filter((pr) => pr.item_id === item?.id)
          .map((pr) => ({
            id: `proof-${pr.id}`,
            at: pr.created_at,
            input: a.sample,
            toolCalls: row.tools.map((t) => ({ name: t, detail: "sample data" })),
            output: pr.summary ?? (pr.result === "pass" ? "Passed its check." : "Failed its check."),
            status: pr.result === "pass" ? ("passed" as const) : ("failed" as const),
            durationMs: null,
            runtime: "sample" as const,
            modelLabel: null,
            studioAgentId: null,
            note: pr.attempt > 0 ? `Fix ${pr.attempt} of 3` : "Check run during the build",
          }));
    runsByAgent[row.id] = [...tryRuns, ...buildRuns].sort((x, y) => y.at.localeCompare(x.at));
  }

  return {
    ok: true,
    data: {
      trigger: spec.trigger,
      delivery: spec.delivery,
      toolProviders: spec.toolProviders,
      agents,
      runs: runsByAgent,
      lyzr: { configured: lyzrConfigured().perAgent, model: LYZR_MODEL.label },
      mcpServers: policies.governance ? policies.apps.mcp.map((m) => m.name) : null,
      sampleProject: spec.sample,
    },
  };
}

const settings = z.object({
  agentId: uuid,
  model: z.enum(MODEL_CHOICES),
  temperature: z.number().min(0).max(1),
  maxTokens: z.number().int().min(100).max(4000),
  instructions: z.string().trim().min(1, "Write the agent's instructions first.").max(6000, "Instructions can be up to 6,000 characters."),
  tools: z.array(z.string().trim().min(1).max(80)).max(12),
  knowledge: z.array(z.string().trim().min(1).max(80)).max(12),
});

/**
 * Save an agent's settings (Save changes). With Lyzr Studio set up, its Studio agent is made or updated to match.
 * A Studio failure doesn't lose the save: the settings are kept and the person is told Studio wasn't updated.
 */
export async function saveAgent(input: z.input<typeof settings>): Promise<ActionResult<{ syncedAt: string | null; lyzrAgentId: string | null; warning?: string }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: BUILDERS_ONLY };
  const parsed = settings.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Those settings aren't valid." };
  const admin = createAdminDb();
  const row = await agentInWorkspace(admin, parsed.data.agentId, ctx.workspace.id);
  if (!row) return { ok: false, message: "That agent isn't in this workspace." };

  const s = parsed.data;
  // Only models the policy allows (C-2). An agent on a model that was disallowed later has to switch first.
  if (!(await allowedModels(admin, ctx.workspace.id)).includes(s.model)) {
    return { ok: false, message: s.model === toModelChoice(row.model) ? `${MODEL_NOT_ALLOWED}. Switch it to an allowed model, then save.` : `${MODEL_LABEL[s.model]} isn't allowed in this workspace. Pick another model.` };
  }
  // A new MCP tool has to be a server the policy allows (C-3).
  const policies = await loadPolicies(admin, ctx.workspace.id);
  const newMcp = s.tools.filter((t) => !row.tools.includes(t) && /^MCP\b/.test(t));
  if (policies.governance && newMcp.some((t) => !policies.apps.mcp.some((m) => `MCP: ${m.name}` === t))) {
    return { ok: false, message: "That MCP server isn't on your organisation's list. An Owner or Admin adds servers in Governance › Apps and MCP servers." };
  }
  const now = new Date().toISOString();
  const next: AgentRow = { ...row, model: s.model, temperature: s.temperature, max_tokens: s.maxTokens, instructions: s.instructions, tools: s.tools, knowledge: s.knowledge };
  const { error } = await admin
    .from("agents")
    .update({ model: s.model, temperature: s.temperature, max_tokens: s.maxTokens, instructions: s.instructions, tools: s.tools, knowledge: s.knowledge, updated_at: now })
    .eq("id", row.id);
  if (error) return { ok: false, message: "The settings couldn't be saved. Try again." };
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "agent.saved", target: row.name, details: { agent_id: row.id } });

  if (row.framework !== "lyzr" || !lyzrConfigured().perAgent) return { ok: true, syncedAt: row.studio_synced_at, lyzrAgentId: row.lyzr_agent_id };
  try {
    let lyzrAgentId = row.lyzr_agent_id;
    if (lyzrAgentId) await updateLyzrAgent(lyzrAgentId, lyzrSpec(next));
    else lyzrAgentId = await createLyzrAgent(lyzrSpec(next));
    await admin.from("agents").update({ lyzr_agent_id: lyzrAgentId, studio_synced_at: now }).eq("id", row.id);
    return { ok: true, syncedAt: now, lyzrAgentId };
  } catch (err) {
    const why = err instanceof LyzrError ? err.message : "Lyzr Studio couldn't be reached.";
    return { ok: true, syncedAt: row.studio_synced_at, lyzrAgentId: row.lyzr_agent_id, warning: `Saved here. Lyzr Studio wasn't updated: ${why}` };
  }
}

/**
 * Try it: run the agent on one message, for real on Lyzr Studio (its own Studio agent, made on the first run),
 * and save the run. Without a Lyzr key, Gemini answers through the gateway and the run is marked Simulated.
 * Test runs don't use the workspace's credits.
 */
export async function tryAgent(input: { agentId: string; message: string }): Promise<ActionResult<{ run: AgentRunView; lyzrAgentId: string | null; syncedAt: string | null }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: BUILDERS_ONLY };
  const message = (input.message ?? "").trim();
  if (!message) return { ok: false, message: "Write a message for the agent first." };
  if (message.length > MESSAGE_LIMIT) return { ok: false, message: `Messages can be up to ${MESSAGE_LIMIT.toLocaleString("en-GB")} characters.` };
  const admin = createAdminDb();
  const row = await agentInWorkspace(admin, input.agentId, ctx.workspace.id);
  if (!row) return { ok: false, message: "That agent isn't in this workspace." };

  if (!(await allowedModels(admin, ctx.workspace.id)).includes(toModelChoice(row.model))) {
    return { ok: false, message: `${MODEL_NOT_ALLOWED} for this agent. Switch it in Settings and save, then try it.` };
  }
  const { data: recent } = await admin.from("agent_runs").select("created_at").eq("created_by", ctx.user.id).order("created_at", { ascending: false }).limit(TRY_IT_PER_HOUR);
  const hourAgo = Date.now() - 3600_000;
  if ((recent ?? []).filter((r) => new Date(r.created_at).getTime() > hourAgo).length >= TRY_IT_PER_HOUR) {
    return { ok: false, message: `You've tried agents ${TRY_IT_PER_HOUR} times in the last hour. Try again later.` };
  }

  const spec = lyzrSpec(row);
  const started = Date.now();
  let result: Awaited<ReturnType<typeof runAgent>>;
  try {
    result = await runAgent({
      name: row.name,
      description: spec.description,
      instructions: spec.instructions,
      output: spec.output,
      temperature: spec.temperature,
      maxTokens: spec.maxTokens,
      lyzrAgentId: row.lyzr_agent_id,
      userId: `architect-${ctx.workspace.id}`,
      sessionId: `architect-${row.id}-${randomUUID()}`,
      message,
      simulate: row.framework !== "lyzr",
    });
  } catch (err) {
    const durationMs = Date.now() - started;
    const why =
      err instanceof LyzrError
        ? `Lyzr Studio didn't answer. ${err.message}`
        : err instanceof GatewayRateLimited || err instanceof GatewaySlow || err instanceof GatewayUnavailable
          ? `${err.message} Nothing was charged.`
          : "The agent couldn't run. Try again.";
    await admin.from("agent_runs").insert({
      agent_id: row.id,
      input: { message, lyzr_agent_id: row.lyzr_agent_id },
      tool_calls: [],
      output: why,
      duration_ms: durationMs,
      credits: 0,
      status: "failed",
      runtime: err instanceof LyzrError ? "lyzr_agent" : "gateway",
      model_label: err instanceof LyzrError ? LYZR_MODEL.label : null,
      created_by: ctx.user.id,
    });
    return { ok: false, message: why };
  }
  const durationMs = Date.now() - started;
  const now = new Date().toISOString();
  if (result.createdAgentId) await admin.from("agents").update({ lyzr_agent_id: result.createdAgentId, studio_synced_at: now }).eq("id", row.id);

  const { data: saved } = await admin
    .from("agent_runs")
    .insert({
      agent_id: row.id,
      input: { message, lyzr_agent_id: result.lyzrAgentId, note: result.note },
      tool_calls: [],
      output: result.text,
      duration_ms: durationMs,
      credits: 0,
      status: "passed",
      runtime: result.runtime,
      model_label: result.modelLabel,
      created_by: ctx.user.id,
    })
    .select("id, created_at, input, tool_calls, output, status, duration_ms, runtime, model_label")
    .single();
  const run: AgentRunView = saved
    ? runView(saved)
    : { id: randomUUID(), at: now, input: message, toolCalls: [], output: result.text, status: "passed", durationMs, runtime: result.runtime, modelLabel: result.modelLabel, studioAgentId: result.lyzrAgentId, note: result.note };
  return {
    ok: true,
    run,
    lyzrAgentId: result.createdAgentId ?? row.lyzr_agent_id,
    syncedAt: result.createdAgentId ? now : row.studio_synced_at,
  };
}
