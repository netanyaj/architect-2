import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/db";
import { FakeDb } from "./fake-db";

/* Agents (screen 9): settings rows made on first open, Save syncing to Lyzr Studio, and Try it on its three
   runtimes (M5.10): the node's own agent in the workspace's own Studio (its own Lyzr key), the shared demo agent on
   the platform's key (the seeded Research agent only), and the gateway (Simulated, no workspace key). */

let db: FakeDb;
let role: Role;
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/db", () => ({ createAdminDb: () => db, createServerDb: async () => db }));
vi.mock("@/server/workspace", () => ({
  getAppContext: async () => ({ user: { id: "me" }, name: "Morgan Lee", role, workspace: { id: "ws-1", name: "Acme", governanceEnabled: true }, memberships: [] }),
}));
// Gemini through the gateway, for the Simulated path (no network).
const generateText = vi.fn<(opts: { instructions: string; prompt: string }) => Promise<{ text: string; totalUsage: { totalTokens: number } }>>(async () => ({
  text: "Gemini answered.",
  totalUsage: { totalTokens: 10 },
}));
vi.mock("ai", async (orig) => ({ ...(await orig<typeof import("ai")>()), generateText: (o: { instructions: string; prompt: string }) => generateText(o) }));

type Call = { method: string; path: string; body: Record<string, unknown> | null; key: string | null };
let calls: Call[];
let studio: { createStatus: number; chatStatus: number; answer: string };
const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
  const path = new URL(url).pathname;
  const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
  calls.push({ method: init.method ?? "GET", path, body, key: (init.headers as Record<string, string>)["x-api-key"] ?? null });
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  if (path === "/v3/agents/" && init.method === "POST") return studio.createStatus === 200 ? json(200, { agent_id: "studio-new-1" }) : json(studio.createStatus, { detail: "Not allowed" });
  if (path.startsWith("/v3/agents/") && init.method === "PUT") return json(200, { message: "updated" });
  if (path === "/v3/inference/chat/") return studio.chatStatus === 200 ? json(200, { response: studio.answer, module_outputs: {} }) : json(studio.chatStatus, { detail: "Server error" });
  return json(404, {});
});

const P = "11111111-1111-4111-8111-111111111111";
const A = "22222222-2222-4222-8222-222222222222";
const agentRow = {
  id: A,
  workspace_id: "ws-1",
  project_id: P,
  item_key: "urgency",
  name: "Urgency and team label",
  description: "Labels each ticket.",
  framework: "lyzr",
  model: "gemini",
  instructions: "Label each ticket by urgency and team.",
  tools: ["Zendesk"],
  knowledge: [],
  temperature: 0.3,
  max_tokens: 800,
  lyzr_agent_id: null as string | null,
  studio_synced_at: null as string | null,
  studio_error: null as string | null,
};

async function actions() {
  return import("@/server/actions/agents");
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-google");
  vi.stubEnv("LYZR_API_KEY", "test-lyzr");
  vi.stubEnv("LYZR_AGENT_ID", "shared-agent-9");
  vi.stubGlobal("fetch", fetchMock);
  calls = [];
  studio = { createStatus: 200, chatStatus: 200, answer: "Urgent · Billing team." };
  generateText.mockClear();
  role = "builder";
  db = new FakeDb({
    projects: [{ id: P, workspace_id: "ws-1", name: "ticket-triage", prompt: "Classify Zendesk tickets", model: "gemini", blueprints: [{ id: "bp", version: 1 }] }],
    blueprints: [{ id: "bp", project_id: P, version: 1 }],
    items: [
      { id: "i1", blueprint_id: "bp", key: "new-tickets-read", title: "New tickets read", description: null, proved_when: "Reads new tickets", grp: "integrations", status: "built", provider: "zendesk", position: 1 },
      { id: "i2", blueprint_id: "bp", key: "urgency", title: "Urgency and team label", description: "Labels each ticket", proved_when: "Every ticket gets one urgency", grp: "agents", status: "built", provider: null, position: 2 },
      { id: "i3", blueprint_id: "bp", key: "draft", title: "Draft reply", description: null, proved_when: "A reply under 120 words", grp: "agents", status: "agreed", provider: null, position: 3 },
    ],
    files: [],
    agents: [],
    agent_runs: [],
    proofs: [{ id: "pr1", item_id: "i2", attempt: 0, result: "pass", summary: "3 of 3 assertions passed", created_at: "2026-10-08T10:00:00Z" }],
    audit_log: [],
    workspace_secrets: [{ workspace_id: "ws-1", name: "lyzr_api_key", last4: "-key", set_by_name: "Morgan Lee", set_at: "2026-10-12T09:00:00Z" }],
  });
  db.secrets["ws-1:lyzr_api_key"] = "ws-own-key";
});

/** No workspace key: nothing goes to any Lyzr account. */
function noWorkspaceKey() {
  delete db.secrets["ws-1:lyzr_api_key"];
  db.tables.workspace_secrets = [];
}

describe("loadAgents", () => {
  it("makes a settings row per agent part the first time, with instructions from the part, and lists build check runs", async () => {
    const { loadAgents } = await actions();
    const r = await loadAgents({ projectId: P });
    if (!r.ok) throw new Error(r.message);
    expect(db.tables.agents.map((a) => [a.item_key, a.framework, a.model])).toEqual([
      ["urgency", "lyzr", "gemini"],
      ["draft", "lyzr", "gemini"],
    ]);
    expect(db.tables.agents[0].instructions).toContain("Your answer must pass this check: every ticket gets one urgency.");
    expect(r.data.trigger.title).toBe("Zendesk");
    expect(r.data.lyzr).toMatchObject({ connected: true, last4: "-key", demoReady: true });
    expect(r.data.agents.every((a) => !a.demo)).toBe(true);
    const first = r.data.agents[0];
    expect(r.data.runs[first.id]).toEqual([expect.objectContaining({ runtime: "sample", status: "passed", output: "3 of 3 assertions passed", note: "Check run during the build" })]);
    // Opening it again doesn't make more rows.
    await loadAgents({ projectId: P });
    expect(db.tables.agents).toHaveLength(2);
  });

  it("refuses a project the person can't read", async () => {
    const { loadAgents } = await actions();
    expect(await loadAgents({ projectId: "33333333-3333-4333-8333-333333333333" })).toEqual({ ok: false, message: "That project isn't here." });
  });
});

describe("tryAgent", () => {
  beforeEach(() => {
    db.tables.agents.push({ ...agentRow });
  });

  it("first run: makes the node's own Studio agent, runs it, saves the run and the agent id; the next run reuses it", async () => {
    const { tryAgent } = await actions();
    const r = await tryAgent({ agentId: A, message: "Ticket: the export failed again." });
    if (!r.ok) throw new Error(r.message);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /v3/agents/", "POST /v3/inference/chat/"]);
    // The workspace's own key, never the platform's.
    expect(calls.every((c) => c.key === "ws-own-key")).toBe(true);
    expect(calls[0].body).toMatchObject({ name: "Urgency and team label · Architect", agent_role: "Urgency and team label", agent_instructions: "Label each ticket by urgency and team.", temperature: 0.3, model: "gemini/gemini-3.1-flash-lite" });
    expect(calls[1].body).toMatchObject({ agent_id: "studio-new-1", message: "Ticket: the export failed again.", user_id: "architect-ws-1" });
    expect(r.run).toMatchObject({ runtime: "lyzr_agent", output: "Urgent · Billing team.", status: "passed", studioAgentId: "studio-new-1" });
    expect(db.tables.agents[0]).toMatchObject({ lyzr_agent_id: "studio-new-1" });
    expect(db.tables.agent_runs[0]).toMatchObject({ agent_id: A, runtime: "lyzr_agent", credits: 0, status: "passed", created_by: "me", model_label: "Gemini 3.1 Flash Lite" });

    calls = [];
    const again = await tryAgent({ agentId: A, message: "Another ticket" });
    expect(again.ok).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /v3/inference/chat/"]);
  });

  it("if the workspace's Studio won't make the agent, the run fails and says so: no other account's agent answers", async () => {
    studio.createStatus = 403;
    const { tryAgent } = await actions();
    const r = await tryAgent({ agentId: A, message: "Ticket: refund please" });
    expect(r).toEqual({ ok: false, message: expect.stringMatching(/^Lyzr Studio didn't answer\. Lyzr Studio said 403/) });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /v3/agents/"]);
    expect(calls.some((c) => c.key === "test-lyzr" || c.body?.agent_id === "shared-agent-9")).toBe(false);
    expect(db.tables.agents[0].lyzr_agent_id).toBeNull();
  });

  it("without the workspace's Lyzr key, Gemini answers and the run is Simulated; no Lyzr account is called, not even the platform's", async () => {
    noWorkspaceKey();
    const { tryAgent } = await actions();
    const r = await tryAgent({ agentId: A, message: "Ticket" });
    if (!r.ok) throw new Error(r.message);
    expect(calls).toEqual([]);
    expect(r.run).toMatchObject({ runtime: "gateway", output: "Gemini answered.", studioAgentId: null });
    expect(generateText.mock.calls[0][0].instructions).toContain("Label each ticket by urgency and team.");
  });

  it("imported CrewAI agents are Simulated even with a Lyzr key", async () => {
    db.tables.agents[0].framework = "crewai";
    const { tryAgent } = await actions();
    const r = await tryAgent({ agentId: A, message: "Ticket" });
    expect(r.ok && r.run.runtime).toBe("gateway");
    expect(calls).toEqual([]);
  });

  it("a Studio failure while answering is shown and saved as a failed run, never swapped for Gemini", async () => {
    studio.chatStatus = 500;
    const { tryAgent } = await actions();
    const r = await tryAgent({ agentId: A, message: "Ticket" });
    expect(r).toEqual({ ok: false, message: expect.stringMatching(/^Lyzr Studio didn't answer\. Lyzr Studio said 500/) });
    expect(generateText).not.toHaveBeenCalled();
    expect(db.tables.agent_runs.at(-1)).toMatchObject({ status: "failed", runtime: "lyzr_agent" });
  });

  it("refuses Viewers, empty and over-long messages, other workspaces' agents, and more than 20 runs an hour", async () => {
    const { tryAgent } = await actions();
    role = "viewer";
    expect(await tryAgent({ agentId: A, message: "hi" })).toMatchObject({ ok: false, message: expect.stringMatching(/^Viewers can't/) });
    role = "builder";
    expect(await tryAgent({ agentId: A, message: "   " })).toEqual({ ok: false, message: "Write a message for the agent first." });
    expect(await tryAgent({ agentId: A, message: "x".repeat(4001) })).toMatchObject({ ok: false });
    db.tables.agents[0].workspace_id = "ws-2";
    expect(await tryAgent({ agentId: A, message: "hi" })).toEqual({ ok: false, message: "That agent isn't in this workspace." });
    db.tables.agents[0].workspace_id = "ws-1";
    const now = Date.now();
    for (let i = 0; i < 20; i++) db.tables.agent_runs.push({ id: `r${i}`, agent_id: A, created_by: "me", created_at: new Date(now - i * 60_000).toISOString() });
    expect(await tryAgent({ agentId: A, message: "hi" })).toEqual({ ok: false, message: "You've tried agents 20 times in the last hour. Try again later." });
    expect(calls).toEqual([]);
  });
});

describe("saveAgent", () => {
  const settings = { agentId: A, model: "claude" as const, temperature: 0.5, maxTokens: 600, instructions: "Label by urgency. Escalate VIPs.", tools: ["Zendesk", "Web search"], knowledge: [] };
  beforeEach(() => {
    db.tables.agents.push({ ...agentRow });
  });

  it("saves the settings and makes the Studio agent to match; the next save updates it", async () => {
    const { saveAgent } = await actions();
    const r = await saveAgent(settings);
    expect(r).toMatchObject({ ok: true, lyzrAgentId: "studio-new-1" });
    expect(db.tables.agents[0]).toMatchObject({ model: "claude", temperature: 0.5, max_tokens: 600, instructions: "Label by urgency. Escalate VIPs.", tools: ["Zendesk", "Web search"], lyzr_agent_id: "studio-new-1" });
    expect(calls[0].body).toMatchObject({ agent_instructions: "Label by urgency. Escalate VIPs.", temperature: 0.5, additional_model_params: { max_tokens: 600 } });
    expect(db.tables.audit_log[0]).toMatchObject({ action: "agent.saved", target: "Urgency and team label" });

    calls = [];
    await saveAgent({ ...settings, temperature: 0.2 });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["PUT /v3/agents/studio-new-1"]);
  });

  it("a Studio failure keeps the save and says Studio wasn't updated", async () => {
    studio.createStatus = 500;
    const { saveAgent } = await actions();
    const r = await saveAgent(settings);
    expect(r).toMatchObject({ ok: true, lyzrAgentId: null, warning: expect.stringMatching(/^Saved here\. Lyzr Studio wasn't updated: Lyzr Studio said 500/) });
    expect(db.tables.agents[0].instructions).toBe("Label by urgency. Escalate VIPs.");
  });

  it("an agent whose part isn't built yet is saved here only: it's made in Studio when its part works", async () => {
    db.tables.agents[0].item_key = "draft";
    const { saveAgent } = await actions();
    expect(await saveAgent(settings)).toEqual({ ok: true, syncedAt: null, lyzrAgentId: null });
    expect(calls).toEqual([]);
  });

  it("without the workspace's Lyzr key it saves here only", async () => {
    noWorkspaceKey();
    const { saveAgent } = await actions();
    expect(await saveAgent(settings)).toEqual({ ok: true, syncedAt: null, lyzrAgentId: null });
    expect(calls).toEqual([]);
  });

  it("refuses Viewers and invalid settings", async () => {
    const { saveAgent } = await actions();
    expect(await saveAgent({ ...settings, instructions: " " })).toEqual({ ok: false, message: "Write the agent's instructions first." });
    expect(await saveAgent({ ...settings, temperature: 2 })).toMatchObject({ ok: false });
    role = "viewer";
    expect(await saveAgent(settings)).toMatchObject({ ok: false, message: expect.stringMatching(/^Viewers can't/) });
    expect(db.tables.agents[0].instructions).toBe(agentRow.instructions);
  });
});

describe("the shared demo agent (M5.10)", () => {
  const R = "44444444-4444-4444-8444-444444444444";
  beforeEach(() => {
    db.tables.projects.push({ id: "mp", workspace_id: "ws-1", name: "Meeting Prep", prompt: "Brief me before meetings", model: "gemini", blueprints: [] });
    db.tables.agents.push({ ...agentRow, id: R, project_id: "mp", item_key: "research", name: "Research agent" });
  });

  it("runs on the platform's shared agent, with its role in the message, even without a workspace key", async () => {
    noWorkspaceKey();
    const { tryAgent } = await actions();
    const r = await tryAgent({ agentId: R, message: "Dana Ortiz, Acme" });
    if (!r.ok) throw new Error(r.message);
    expect(r.run).toMatchObject({ runtime: "lyzr_shared", studioAgentId: "shared-agent-9" });
    expect(calls.map((c) => `${c.method} ${c.path} ${c.key}`)).toEqual(["POST /v3/inference/chat/ test-lyzr"]);
    expect(String(calls[0].body?.message)).toMatch(/^Your role: Research agent\./);
  });

  it("is read-only: no saves, no Studio agent of its own", async () => {
    const { saveAgent, retryStudio } = await actions();
    const r = await saveAgent({ agentId: R, model: "gemini", temperature: 0.3, maxTokens: 800, instructions: "x", tools: [], knowledge: [] });
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/^The demo agent is shared and read-only/) });
    expect(await retryStudio({ agentId: R })).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });

  it("is capped at 10 runs per person per day", async () => {
    const today = new Date().toISOString();
    for (let i = 0; i < 10; i++) db.tables.agent_runs.push({ id: `d${i}`, agent_id: R, created_by: "me", created_at: today });
    const { tryAgent } = await actions();
    expect(await tryAgent({ agentId: R, message: "hi" })).toMatchObject({ ok: false, message: expect.stringMatching(/^You've run the demo agent 10 times today/) });
    expect(calls).toEqual([]);
  });
});

describe("Not in Studio yet · Retry, and agents made when their part works (M5.10)", () => {
  beforeEach(() => {
    db.tables.agents.push({ ...agentRow, studio_error: "Lyzr Studio said 500" });
  });

  it("Retry makes the agent in the workspace's own Studio and clears the error", async () => {
    const { retryStudio } = await actions();
    expect(await retryStudio({ agentId: A })).toMatchObject({ ok: true, lyzrAgentId: "studio-new-1" });
    expect(db.tables.agents[0]).toMatchObject({ lyzr_agent_id: "studio-new-1", studio_error: null });
    expect(calls.map((c) => c.key)).toEqual(["ws-own-key"]);
  });

  it("Retry asks for the key without one, and waits for the build when the part isn't built", async () => {
    const { retryStudio } = await actions();
    noWorkspaceKey();
    expect(await retryStudio({ agentId: A })).toEqual({ ok: false, message: "Connect your Lyzr key first, in Connections › Lyzr Studio." });
    db.secrets["ws-1:lyzr_api_key"] = "ws-own-key";
    db.tables.agents[0].item_key = "draft";
    expect(await retryStudio({ agentId: A })).toEqual({ ok: false, message: "It's made in Lyzr Studio when its part is built." });
    expect(calls).toEqual([]);
  });

  it("after a build, each agent whose part works is made in Studio; a failure is kept for Retry, the part still works", async () => {
    db.tables.agents[0].studio_error = null;
    const { syncBuiltAgents } = await import("@/server/agents-core");
    expect(await syncBuiltAgents(db as never, P)).toBe(1);
    // Only the built part ("urgency"); "draft" isn't built yet.
    expect(db.tables.agents.find((a) => a.item_key === "urgency")).toMatchObject({ lyzr_agent_id: "studio-new-1" });
    expect(db.tables.agents.find((a) => a.item_key === "draft")?.lyzr_agent_id ?? null).toBeNull();

    studio.createStatus = 500;
    db.tables.agents.find((a) => a.item_key === "urgency")!.lyzr_agent_id = null;
    expect(await syncBuiltAgents(db as never, P)).toBe(0);
    expect(db.tables.agents.find((a) => a.item_key === "urgency")!.studio_error).toMatch(/Lyzr Studio said 500/);
    expect(db.tables.items.find((i) => i.key === "urgency")!.status).toBe("built");
  });
});

/* When it runs (round 7, Simulated): a schedule on the app's first agent, saved on its own. */
describe("saveSchedule", () => {
  beforeEach(() => {
    db.tables.agents.push({ ...agentRow });
  });

  it("saves a schedule on the first agent, audits it, and the agents view reads it back", async () => {
    const { saveSchedule, loadAgents } = await actions();
    const r = await saveSchedule({ agentId: A, schedule: { days: "weekdays", time: "8:00", tz: "Europe/London" } });
    expect(r).toEqual({ ok: true, schedule: { days: "weekdays", time: "08:00", tz: "Europe/London" } });
    expect(JSON.parse(db.tables.agents[0].schedule as string)).toEqual({ days: "weekdays", time: "08:00", tz: "Europe/London" });
    expect(db.tables.audit_log[0]).toMatchObject({ action: "agent.schedule_changed", target: "Urgency and team label" });
    const loaded = await loadAgents({ projectId: P });
    if (!loaded.ok) throw new Error(loaded.message);
    expect(loaded.data.schedule).toEqual({ days: "weekdays", time: "08:00", tz: "Europe/London" });
    expect(loaded.data.scheduleAgentId).toBe(A);
    // The plan's own trigger is kept, for "start on its trigger".
    expect(loaded.data.trigger.title).toBe("Zendesk");
  });

  it("null switches the schedule off: it starts on its trigger again", async () => {
    const { saveSchedule, loadAgents } = await actions();
    await saveSchedule({ agentId: A, schedule: { days: "daily", time: "09:00", tz: "" } });
    expect(await saveSchedule({ agentId: A, schedule: null })).toEqual({ ok: true, schedule: null });
    const loaded = await loadAgents({ projectId: P });
    if (!loaded.ok) throw new Error(loaded.message);
    expect(loaded.data.schedule).toBeNull();
  });

  it("refuses a time or time zone that doesn't exist, and viewers", async () => {
    const { saveSchedule } = await actions();
    expect(await saveSchedule({ agentId: A, schedule: { days: "daily", time: "25:00", tz: "" } })).toEqual({ ok: false, message: "Pick a time, for example 8:00." });
    expect(await saveSchedule({ agentId: A, schedule: { days: "daily", time: "09:00", tz: "Mars/Olympus" } })).toEqual({ ok: false, message: "Pick a time zone from the list." });
    role = "viewer";
    expect(await saveSchedule({ agentId: A, schedule: null })).toMatchObject({ ok: false });
    expect(db.tables.agents[0].schedule).toBeUndefined();
  });
});
