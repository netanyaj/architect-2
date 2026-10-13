"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CONVERT_CREDITS, type AgentOrigin, type GraphEnd } from "@/lib/agents";
import { parseSchedule, SCHEDULE_DAYS, storeSchedule, TIME_RE, padTime, validTimeZone, type Schedule } from "@/lib/schedule";
import { startOfDayUtc } from "@/lib/plan-limit";
import type { Json } from "@/lib/database.types";
import { GatewayRateLimited, GatewaySlow, GatewayUnavailable, runAgent, type AgentRuntime } from "@/lib/gateway";
import { MODEL_CHOICES, MODEL_LABEL, toModelChoice, type ModelChoice } from "@/lib/models";
import { MODEL_NOT_ALLOWED } from "@/lib/policies";
import { canBuild } from "@/lib/permissions";
import { allowedModels } from "../blueprint/write-plan";
import { createAdminDb, createServerDb } from "../db";
import { createLyzrAgent, demoLyzr, LYZR_MODEL, LyzrError, updateLyzrAgent } from "../lyzr";
import { lyzrKeyStatus, workspaceLyzrKey } from "../lyzr-key";
import { agentInWorkspace, agentRowsFor, isDemoAgent, lyzrSpec, makeInStudio, partWorks, type AgentRow, type ItemRow } from "../agents-core";
import { RECHECK_MS } from "../code-edits";
import { budgetRefusal } from "../policy";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";
import { mcpToolLabel } from "@/lib/mcp-connections";

const uuid = z.string().uuid();
const BUILDERS_ONLY = "Viewers can't change or run agents. Ask an Owner, Admin or Builder.";
/** A cap per person on Try it, so one loop can't run a workspace's Studio (or the gateway) dry. */
const TRY_IT_PER_HOUR = 20;
/** The shared demo agent runs on the platform's Lyzr account (M5.10): 10 runs per person per day. */
const DEMO_RUNS_PER_DAY = 10;
const DEMO_READ_ONLY = "The demo agent is shared and read-only: you can try it, not change it. Connect your own Lyzr key to build agents of your own.";
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
  /** An agent found in an imported repo keeps the framework it was written in (B-6); null otherwise. */
  importedFrom: "crewai" | "langgraph" | null;
  /** How an imported agent runs (M5.5): natively in its framework, converted to a Studio agent, or as a tool. */
  runAs: "native" | "studio" | "tool";
  lyzrAgentId: string | null;
  syncedAt: string | null;
  /** Why its Studio agent couldn't be made last time ("Not in Studio yet · Retry"). */
  studioError: string | null;
  /** The seeded Research agent (M5.10): the shared, read-only demo agent on the platform's Lyzr account. */
  demo: boolean;
  handoff: string;
  sample: string;
};

export type AgentsData = {
  /** What the plan implies starts the app; the view shows `schedule` in its place when there is one. */
  trigger: GraphEnd;
  /**
   * When the app runs on the clock (round 7, Simulated): saved on the first agent, the one the trigger starts, or read
   * from the plan's schedule part. Null: it starts on its trigger.
   */
  schedule: Schedule | null;
  /** The agent whose settings hold the schedule (the first one). */
  scheduleAgentId: string | null;
  delivery: GraphEnd;
  toolProviders: Record<string, string>;
  agents: AgentView[];
  runs: Record<string, AgentRunView[]>;
  /**
   * Lyzr Studio here (M5.10): whether the workspace has connected its own key (and its last 4 characters), whether
   * the shared demo agent can run, and the model Studio agents run on.
   */
  lyzr: { connected: boolean; last4: string | null; demoReady: boolean; model: string };
  /** MCP servers connected in Connections (M6), with the tools their last test found. Agents pick from these. */
  mcpServers: { name: string; tools: string[] }[];
  /** Meeting Prep's sample agents (screen 9) rather than agents derived from the plan. */
  sampleProject: boolean;
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

/** MCP servers connected in Connections (M6), with the tools their last test found. */
async function connectedMcp(admin: ReturnType<typeof createAdminDb>, workspaceId: string): Promise<{ name: string; tools: string[] }[]> {
  const { data } = await admin.from("connections").select("name, tools").eq("workspace_id", workspaceId).eq("kind", "mcp").eq("status", "connected");
  return (data ?? []).map((c) => ({ name: c.name ?? "MCP server", tools: ((c.tools ?? []) as { name: string }[]).map((t) => t.name) }));
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
      : Promise.resolve({ data: [] as ItemRow[] }),
    db.from("files").select("name, path").eq("project_id", p.id).eq("kind", "upload"),
  ]);
  // The person's read above proved membership; settings rows are written with the service role.
  const admin = createAdminDb();
  const { spec, rows } = await agentRowsFor(admin, p, items ?? [], files ?? []);

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
      importedFrom: (() => {
        const f = (items ?? []).find((i) => i.key === a.key)?.framework;
        return f === "crewai" || f === "langgraph" ? f : null;
      })(),
      runAs: row.run_as === "studio" || row.run_as === "tool" ? row.run_as : "native",
      lyzrAgentId: row.lyzr_agent_id,
      syncedAt: row.studio_synced_at,
      studioError: row.studio_error,
      demo: spec.sample && a.origin === "studio",
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

  // The schedule lives on the first agent (the one the trigger starts); never set, it's what the plan says.
  const first = agents[0];
  const stored = parseSchedule(rows.find((r) => r.id === first?.id)?.schedule);
  return {
    ok: true,
    data: {
      trigger: spec.trigger,
      schedule: stored === "off" ? null : (stored ?? spec.schedule),
      scheduleAgentId: first?.id ?? null,
      delivery: spec.delivery,
      toolProviders: spec.toolProviders,
      agents,
      runs: runsByAgent,
      lyzr: await (async () => {
        const key = await lyzrKeyStatus(admin, p.workspace_id);
        return { connected: key.connected, last4: key.connected ? key.last4 : null, demoReady: Boolean(demoLyzr()), model: LYZR_MODEL.label };
      })(),
      mcpServers: await connectedMcp(admin, p.workspace_id),
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
  framework: z.enum(["lyzr", "crewai", "langgraph"]).optional(),
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
  if (await isDemoAgent(admin, row)) return { ok: false, message: DEMO_READ_ONLY };

  const s = parsed.data;
  // Only models the policy allows (C-2). An agent on a model that was disallowed later has to switch first.
  if (!(await allowedModels(admin, ctx.workspace.id)).includes(s.model)) {
    return { ok: false, message: s.model === toModelChoice(row.model) ? `${MODEL_NOT_ALLOWED}. Switch it to an allowed model, then save.` : `${MODEL_LABEL[s.model]} isn't allowed in this workspace. Pick another model.` };
  }
  // A new MCP tool has to be a server connected in Connections (M6), which only takes servers the policy allows (C-3).
  const newMcp = s.tools.filter((t) => !row.tools.includes(t) && /^MCP\b/.test(t));
  const connected = (await connectedMcp(admin, ctx.workspace.id)).map((m) => mcpToolLabel(m.name));
  if (newMcp.some((t) => !connected.includes(t))) {
    return { ok: false, message: "That MCP server isn't connected here. Add it in Connections › MCP servers first; with governance on, it has to be on your organisation's list." };
  }
  const now = new Date().toISOString();
  const framework = s.framework ?? (row.framework as "lyzr" | "crewai" | "langgraph");
  const next: AgentRow = { ...row, model: s.model, temperature: s.temperature, max_tokens: s.maxTokens, instructions: s.instructions, tools: s.tools, knowledge: s.knowledge, framework };
  const { error } = await admin
    .from("agents")
    .update({ model: s.model, temperature: s.temperature, max_tokens: s.maxTokens, instructions: s.instructions, tools: s.tools, knowledge: s.knowledge, framework, updated_at: now })
    .eq("id", row.id);
  if (error) return { ok: false, message: "The settings couldn't be saved. Try again." };
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "agent.saved", target: row.name, details: { agent_id: row.id } });

  // Saved edits sync to the workspace's own Studio (M5.10): an agent already there is updated; one whose part works
  // but isn't in Studio yet is made now. Without the workspace's key, nothing leaves Architect.
  if (framework !== "lyzr") return { ok: true, syncedAt: row.studio_synced_at, lyzrAgentId: row.lyzr_agent_id };
  const apiKey = await workspaceLyzrKey(admin, ctx.workspace.id);
  if (!apiKey) return { ok: true, syncedAt: row.studio_synced_at, lyzrAgentId: row.lyzr_agent_id };
  if (!row.lyzr_agent_id && !(await partWorks(admin, row))) return { ok: true, syncedAt: null, lyzrAgentId: null };
  try {
    let lyzrAgentId = row.lyzr_agent_id;
    if (lyzrAgentId) await updateLyzrAgent(apiKey, lyzrAgentId, lyzrSpec(next));
    else lyzrAgentId = await createLyzrAgent(apiKey, lyzrSpec(next));
    await admin.from("agents").update({ lyzr_agent_id: lyzrAgentId, studio_synced_at: now, studio_error: null }).eq("id", row.id);
    return { ok: true, syncedAt: now, lyzrAgentId };
  } catch (err) {
    const why = err instanceof LyzrError ? err.message : "Lyzr Studio couldn't be reached.";
    if (!row.lyzr_agent_id) await admin.from("agents").update({ studio_error: why }).eq("id", row.id);
    return { ok: true, syncedAt: row.studio_synced_at, lyzrAgentId: row.lyzr_agent_id, warning: `Saved here. Lyzr Studio wasn't updated: ${why}` };
  }
}

/** Not in Studio yet · Retry (M5.10): makes the agent in the workspace's own Studio now. */
export async function retryStudio(input: { agentId: string }): Promise<ActionResult<{ lyzrAgentId: string; syncedAt: string }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: BUILDERS_ONLY };
  const admin = createAdminDb();
  const row = await agentInWorkspace(admin, input.agentId, ctx.workspace.id);
  if (!row) return { ok: false, message: "That agent isn't in this workspace." };
  if (await isDemoAgent(admin, row)) return { ok: false, message: DEMO_READ_ONLY };
  if (row.lyzr_agent_id) return { ok: true, lyzrAgentId: row.lyzr_agent_id, syncedAt: row.studio_synced_at ?? new Date().toISOString() };
  const apiKey = await workspaceLyzrKey(admin, ctx.workspace.id);
  if (!apiKey) return { ok: false, message: "Connect your Lyzr key first, in Connections › Lyzr Studio." };
  if (!(await partWorks(admin, row))) return { ok: false, message: "It's made in Lyzr Studio when its part is built." };
  const r = await makeInStudio(admin, apiKey, row);
  if ("error" in r) return { ok: false, message: `Still not in Studio: ${r.error}` };
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "agent.studio_created", target: row.name, details: { agent_id: row.id, lyzr_agent_id: r.id } });
  if (row.project_id) revalidatePath(`/p/${row.project_id}`);
  return { ok: true, lyzrAgentId: r.id, syncedAt: new Date().toISOString() };
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
  const demo = await isDemoAgent(admin, row);
  if (demo) {
    // The demo agent runs on the platform's Lyzr account: a daily cap per person.
    const { count } = await admin.from("agent_runs").select("id", { count: "exact", head: true }).eq("agent_id", row.id).eq("created_by", ctx.user.id).gte("created_at", startOfDayUtc(new Date()).toISOString());
    if ((count ?? 0) >= DEMO_RUNS_PER_DAY) return { ok: false, message: `You've run the demo agent ${DEMO_RUNS_PER_DAY} times today, the most for one person. Try again after midnight UTC, or connect your own Lyzr key.` };
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
      apiKey: demo ? null : await workspaceLyzrKey(admin, ctx.workspace.id),
      demo,
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
  if (result.createdAgentId) await admin.from("agents").update({ lyzr_agent_id: result.createdAgentId, studio_synced_at: now, studio_error: null }).eq("id", row.id);

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

const runInput = z.object({ agentId: z.string().uuid(), runAs: z.enum(["native", "studio", "tool"]) });

/**
 * "How should this agent run?" for an agent imported in CrewAI or LangGraph (M5.5). Keep it in its framework
 * (natively, behind the agent interface: Simulated), convert it to a Lyzr Studio agent (real: a Studio agent made
 * from its role and instructions, as Try it does; the part's check then runs again, ~3 credits, shown before the
 * click), or wrap it as a tool other agents call (Simulated). Every choice is audited.
 */
export async function setAgentRun(raw: z.input<typeof runInput>): Promise<ActionResult<{ lyzrAgentId: string | null; warning?: string }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: BUILDERS_ONLY };
  const parsed = runInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Pick one of the three choices." };
  const admin = createAdminDb();
  const row = await agentInWorkspace(admin, parsed.data.agentId, ctx.workspace.id);
  if (!row || !row.project_id || !row.item_key) return { ok: false, message: "That agent isn't in this workspace." };
  const { data: bp } = await admin.from("blueprints").select("id").eq("project_id", row.project_id).order("version", { ascending: false }).limit(1).maybeSingle();
  const { data: item } = bp ? await admin.from("items").select("id, title, status, framework").eq("blueprint_id", bp.id).eq("key", row.item_key).maybeSingle() : { data: null };
  const imported = item?.framework === "crewai" || item?.framework === "langgraph" ? item.framework : null;
  if (!imported) return { ok: false, message: "Only an agent imported from CrewAI or LangGraph has this choice." };
  const runAs = parsed.data.runAs;
  if (runAs === row.run_as) return { ok: true, lyzrAgentId: row.lyzr_agent_id };
  const now = new Date();
  const label = imported === "crewai" ? "CrewAI" : "LangGraph";

  let lyzrAgentId = row.lyzr_agent_id;
  let warning: string | undefined;
  if (runAs === "studio") {
    const stopped = await budgetRefusal(admin, ctx.workspace.id);
    if (stopped) return { ok: false, message: stopped };
    const apiKey = await workspaceLyzrKey(admin, ctx.workspace.id);
    if (apiKey) {
      try {
        lyzrAgentId = lyzrAgentId ?? (await createLyzrAgent(apiKey, lyzrSpec(row)));
      } catch (err) {
        return { ok: false, message: `Lyzr Studio didn't make the agent: ${err instanceof LyzrError ? err.message : "it didn't answer"}. Nothing changed; try again.` };
      }
    } else warning = "Simulated · connect your Lyzr key to make this real. The Studio agent is made when you do.";
    await admin.from("agents").update({ run_as: "studio", framework: "lyzr", lyzr_agent_id: lyzrAgentId, studio_synced_at: lyzrAgentId ? now.toISOString() : null, updated_at: now.toISOString() }).eq("id", row.id);
    await admin.from("usage_ledger").insert({ workspace_id: ctx.workspace.id, project_id: row.project_id, item_id: item!.id, kind: "change", credits: CONVERT_CREDITS, note: `Converted to Lyzr Studio · ${item!.title}` });
    // The part's check runs again on the Studio agent (simulated), as after a code edit.
    if (["built", "sample_data", "needs_connection"].includes(item!.status)) {
      await admin.from("items").update({ status: "building", status_detail: `Re-running its check · now a Lyzr Studio agent` }).eq("id", item!.id);
      await admin.from("events").insert({
        project_id: row.project_id,
        item_id: item!.id,
        type: "check.edited",
        actor: "user",
        actor_label: ctx.name,
        payload: { part_key: row.item_key, part_title: item!.title, prior_status: item!.status, settle_at: new Date(now.getTime() + RECHECK_MS).toISOString(), settled: false, converted: true } as unknown as Json,
      });
    }
  } else {
    // Back to its framework, or wrapped as a tool: the code stays as it was imported.
    await admin.from("agents").update({ run_as: runAs, framework: imported, updated_at: now.toISOString() }).eq("id", row.id);
  }
  await admin.from("audit_log").insert({
    workspace_id: ctx.workspace.id,
    actor: ctx.name,
    action: "agent.run_changed",
    target: row.name,
    details: { from: row.run_as, to: runAs, framework: label, lyzr_agent_id: runAs === "studio" ? lyzrAgentId : null, credits: runAs === "studio" ? CONVERT_CREDITS : 0, simulated: runAs !== "studio" || !lyzrAgentId } as Json,
  });
  revalidatePath(`/p/${row.project_id}`);
  return { ok: true, lyzrAgentId, warning };
}

const scheduleInput = z.object({
  agentId: uuid,
  schedule: z
    .object({
      days: z.enum(SCHEDULE_DAYS),
      time: z.string().regex(TIME_RE, "Pick a time, for example 8:00."),
      tz: z.string().max(64).refine(validTimeZone, "Pick a time zone from the list."),
    })
    .nullable(),
});

/**
 * When the app runs (round 7, Simulated): a schedule on its first agent, or null to start on its trigger. Saved on
 * its own, so it works on the shared demo agent too: it's this project's, and nothing goes to Lyzr Studio. Nothing
 * runs on the clock in this prototype; real schedules would run in the cell's orchestrator.
 */
export async function saveSchedule(input: z.input<typeof scheduleInput>): Promise<ActionResult<{ schedule: Schedule | null }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: BUILDERS_ONLY };
  const parsed = scheduleInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "That schedule isn't valid." };
  const admin = createAdminDb();
  const row = await agentInWorkspace(admin, parsed.data.agentId, ctx.workspace.id);
  if (!row) return { ok: false, message: "That agent isn't in this workspace." };
  const schedule = parsed.data.schedule ? { ...parsed.data.schedule, time: padTime(parsed.data.schedule.time) } : null;
  const { error } = await admin.from("agents").update({ schedule: storeSchedule(schedule), updated_at: new Date().toISOString() }).eq("id", row.id);
  if (error) return { ok: false, message: "The schedule couldn't be saved. Try again." };
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "agent.schedule_changed", target: row.name, details: { agent_id: row.id, schedule } as Json });
  // The Agents view holds its own copy (loadAgents), so nothing else on the page needs to refresh.
  return { ok: true, schedule };
}
