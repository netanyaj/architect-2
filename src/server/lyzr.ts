import "server-only";

import { serverEnv } from "./env";

/**
 * Lyzr Studio's agent API (docs.lyzr.ai, Agent API v3). Server-only: keys never reach the browser.
 * - POST /v3/agents/            makes a Studio agent and returns its id
 * - PUT  /v3/agents/{id}        updates it (Save in the agent panel)
 * - POST /v3/inference/chat/    runs it on one message
 * - GET  /v3/agents/            lists the account's agents (Attach Studio agent)
 *
 * Whose account (M5.10): every user action uses the workspace's own Lyzr key (Connections › Lyzr Studio), so an
 * agent lives in that workspace's own Studio and nobody sees another account's agents. The platform's
 * LYZR_API_KEY runs one thing only: the shared, read-only demo agent (LYZR_AGENT_ID), capped per person.
 */

/** The small model Studio agents made by Architect run on (Lyzr's own Google credential, no key of ours). */
export const LYZR_MODEL = { provider: "Google", model: "gemini/gemini-3.1-flash-lite", credential: "lyzr_google", label: "Gemini 3.1 Flash Lite" } as const;

const CREATE_MS = 20_000;
const CHAT_MS = 45_000;

function baseUrl(): string {
  return serverEnv.lyzr()?.baseUrl ?? process.env.LYZR_BASE_URL ?? "https://agent-prod.studio.lyzr.ai";
}

export class LyzrError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "LyzrError";
  }
}

export type LyzrAgentSpec = {
  name: string;
  description: string;
  role: string;
  instructions: string;
  /** What the agent hands over, in plain words; Studio's "expected output". */
  output: string;
  temperature: number;
  maxTokens: number;
};

async function call<T>(apiKey: string, path: string, init: { method: string; body?: unknown; timeoutMs: number }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method: init.method,
      headers: { "x-api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs),
      cache: "no-store",
    });
  } catch (err) {
    const slow = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new LyzrError(slow ? `Lyzr Studio didn't answer within ${Math.round(init.timeoutMs / 1000)} s.` : "Lyzr Studio couldn't be reached.");
  }
  if (!res.ok) {
    // Studio's error bodies are short ("API key missing", validation details); never echo the request.
    const detail = await res.text().catch(() => "");
    throw new LyzrError(`Lyzr Studio said ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`, res.status);
  }
  return (await res.json()) as T;
}

function body(spec: LyzrAgentSpec) {
  return {
    name: spec.name.slice(0, 120),
    description: spec.description.slice(0, 500),
    agent_role: spec.role.slice(0, 500),
    agent_goal: spec.description.slice(0, 500),
    agent_instructions: spec.instructions.slice(0, 6000),
    agent_output: spec.output.slice(0, 500),
    provider_id: LYZR_MODEL.provider,
    model: LYZR_MODEL.model,
    llm_credential_id: LYZR_MODEL.credential,
    temperature: spec.temperature,
    top_p: 0.9,
    additional_model_params: { max_tokens: spec.maxTokens },
    features: [],
    tools: [],
    store_messages: true,
    response_format: { type: "text" },
  };
}

/** The platform's account: only for the shared demo agent (both LYZR_API_KEY and LYZR_AGENT_ID set). */
export function demoLyzr(): { apiKey: string; agentId: string } | null {
  const cfg = serverEnv.lyzr();
  return cfg?.sharedAgentId ? { apiKey: cfg.apiKey, agentId: cfg.sharedAgentId } : null;
}

export async function createLyzrAgent(apiKey: string, spec: LyzrAgentSpec): Promise<string> {
  const r = await call<{ agent_id?: string }>(apiKey, "/v3/agents/", { method: "POST", body: body(spec), timeoutMs: CREATE_MS });
  if (!r.agent_id) throw new LyzrError("Lyzr Studio didn't return an agent id.");
  return r.agent_id;
}

export async function updateLyzrAgent(apiKey: string, id: string, spec: LyzrAgentSpec): Promise<void> {
  await call(apiKey, `/v3/agents/${encodeURIComponent(id)}`, { method: "PUT", body: body(spec), timeoutMs: CREATE_MS });
}

export type StudioAgent = { id: string; name: string; description: string };

/** The Studio account's agents, newest first as Studio returns them, up to 50. */
export async function listLyzrAgents(apiKey: string): Promise<StudioAgent[]> {
  const r = await call<unknown>(apiKey, "/v3/agents/", { method: "GET", timeoutMs: 15_000 });
  const list = Array.isArray(r) ? r : Array.isArray((r as { agents?: unknown })?.agents) ? (r as { agents: unknown[] }).agents : [];
  return list
    .map((a) => a as { _id?: unknown; id?: unknown; name?: unknown; description?: unknown })
    .filter((a) => typeof (a._id ?? a.id) === "string" && typeof a.name === "string")
    .slice(0, 50)
    .map((a) => ({ id: String(a._id ?? a.id), name: String(a.name).slice(0, 120), description: typeof a.description === "string" ? a.description.slice(0, 200) : "" }));
}

export async function chatLyzr(apiKey: string, input: { agentId: string; userId: string; sessionId: string; message: string }): Promise<string> {
  const r = await call<{ response?: unknown }>(apiKey, "/v3/inference/chat/", {
    method: "POST",
    body: { user_id: input.userId, agent_id: input.agentId, session_id: input.sessionId, message: input.message },
    timeoutMs: CHAT_MS,
  });
  const text = typeof r.response === "string" ? r.response : r.response === undefined ? "" : JSON.stringify(r.response);
  if (!text.trim()) throw new LyzrError("Lyzr Studio returned an empty answer.");
  return text.trim();
}
