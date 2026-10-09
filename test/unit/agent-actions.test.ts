import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/db";
import { FakeDb } from "./fake-db";

/* Agents (screen 9): settings rows made on first open, Save syncing to Lyzr Studio, and Try it on its three
   runtimes: the node's own Studio agent, the shared Studio agent, and the gateway (Simulated, no Lyzr key). */

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
  });
});

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
    expect(r.data.lyzr.configured).toBe(true);
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
    expect(calls[0].key).toBe("test-lyzr");
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

  it("if Studio won't make an agent, the shared Studio agent answers with the node's role and instructions, and says so", async () => {
    studio.createStatus = 403;
    const { tryAgent } = await actions();
    const r = await tryAgent({ agentId: A, message: "Ticket: refund please" });
    if (!r.ok) throw new Error(r.message);
    expect(r.run).toMatchObject({ runtime: "lyzr_shared", studioAgentId: "shared-agent-9" });
    expect(r.run.note).toMatch(/Lyzr Studio said 403/);
    const chat = calls.find((c) => c.path === "/v3/inference/chat/")!;
    expect(chat.body?.agent_id).toBe("shared-agent-9");
    expect(String(chat.body?.message)).toMatch(/^Your role: Urgency and team label\. Labels each ticket\.\nYour task: Label each ticket by urgency and team\.\nOutput format: .+\n\nMessage: Ticket: refund please$/);
    expect(db.tables.agents[0].lyzr_agent_id).toBeNull();
  });

  it("without a Lyzr key, Gemini answers through the gateway and the run is Simulated; Studio is never called", async () => {
    vi.stubEnv("LYZR_API_KEY", "");
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

  it("without a Lyzr key it saves here only", async () => {
    vi.stubEnv("LYZR_API_KEY", "");
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
