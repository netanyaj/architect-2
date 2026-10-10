import "server-only";

import { serverEnv } from "./env";

/**
 * Lyzr Studio's agent API (docs.lyzr.ai, Agent API v3). Server-only: the key never reaches the browser.
 * - POST /v3/agents/            makes a Studio agent and returns its id
 * - PUT  /v3/agents/{id}        updates it (Save in the node drawer)
 * - POST /v3/inference/chat/    runs it on one message
 * - GET  /v3/agents/            lists the account's agents (Attach agent in the composer)
 * Callers go through the gateway's `runAgent`, which decides between these and the Simulated fallback.
 */

/** The small model Studio agents made by Architect run on (Lyzr's own Google credential, no key of ours). */
export const LYZR_MODEL = { provider: "Google", model: "gemini/gemini-3.1-flash-lite", credential: "lyzr_google", label: "Gemini 3.1 Flash Lite" } as const;

const CREATE_MS = 20_000;
const CHAT_MS = 45_000;

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

function config() {
  const cfg = serverEnv.lyzr();
  if (!cfg) throw new LyzrError("Lyzr Studio isn't set up here (no LYZR_API_KEY).");
  return cfg;
}

async function call<T>(path: string, init: { method: string; body?: unknown; timeoutMs: number }): Promise<T> {
  const { apiKey, baseUrl } = config();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
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

export function lyzrConfigured(): { perAgent: boolean; shared: boolean } {
  const cfg = serverEnv.lyzr();
  return { perAgent: Boolean(cfg), shared: Boolean(cfg?.sharedAgentId) };
}

export function sharedAgentId(): string | undefined {
  return serverEnv.lyzr()?.sharedAgentId;
}

export async function createLyzrAgent(spec: LyzrAgentSpec): Promise<string> {
  const r = await call<{ agent_id?: string }>("/v3/agents/", { method: "POST", body: body(spec), timeoutMs: CREATE_MS });
  if (!r.agent_id) throw new LyzrError("Lyzr Studio didn't return an agent id.");
  return r.agent_id;
}

export async function updateLyzrAgent(id: string, spec: LyzrAgentSpec): Promise<void> {
  await call(`/v3/agents/${encodeURIComponent(id)}`, { method: "PUT", body: body(spec), timeoutMs: CREATE_MS });
}

export type StudioAgent = { id: string; name: string; description: string };

/** The Studio account's agents, newest first as Studio returns them, up to 50. */
export async function listLyzrAgents(): Promise<StudioAgent[]> {
  const r = await call<unknown>("/v3/agents/", { method: "GET", timeoutMs: 15_000 });
  const list = Array.isArray(r) ? r : Array.isArray((r as { agents?: unknown })?.agents) ? (r as { agents: unknown[] }).agents : [];
  return list
    .map((a) => a as { _id?: unknown; id?: unknown; name?: unknown; description?: unknown })
    .filter((a) => typeof (a._id ?? a.id) === "string" && typeof a.name === "string")
    .slice(0, 50)
    .map((a) => ({ id: String(a._id ?? a.id), name: String(a.name).slice(0, 120), description: typeof a.description === "string" ? a.description.slice(0, 200) : "" }));
}

export async function chatLyzr(input: { agentId: string; userId: string; sessionId: string; message: string }): Promise<string> {
  const r = await call<{ response?: unknown }>("/v3/inference/chat/", {
    method: "POST",
    body: { user_id: input.userId, agent_id: input.agentId, session_id: input.sessionId, message: input.message },
    timeoutMs: CHAT_MS,
  });
  const text = typeof r.response === "string" ? r.response : r.response === undefined ? "" : JSON.stringify(r.response);
  if (!text.trim()) throw new LyzrError("Lyzr Studio returned an empty answer.");
  return text.trim();
}
