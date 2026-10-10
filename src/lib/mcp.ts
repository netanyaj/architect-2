/**
 * Bring your own coding agent (F4, B-7). The MCP tools Architect would expose to a coding agent (Claude Code,
 * Cursor) with a project token, the scopes a token can have, the one rule that never bends (a coding agent can't
 * mark a part Works; only the checker can), and the scripted session ?sim=byoagent plays. Shared; no I/O.
 */

export type Scope = "read_plan" | "change_parts" | "run" | "pull_requests" | "approvals";

export const SCOPES: { id: Scope; label: string; tools: string[] }[] = [
  { id: "read_plan", label: "Read the plan and the test version", tools: ["get_blueprint", "get_preview_url"] },
  { id: "change_parts", label: "Change parts (each change waits for its check)", tools: ["update_item"] },
  { id: "run", label: "Run code and tests in the sandbox", tools: ["run_in_sandbox", "run_tests"] },
  { id: "pull_requests", label: "Open pull requests", tools: ["open_pr"] },
  { id: "approvals", label: "Ask for approval", tools: ["request_approval"] },
];
export const DEFAULT_SCOPES: Scope[] = ["read_plan", "change_parts", "run"];

export type McpTool = { name: string; scope: Scope; does: string; input: string; output: string; policy: string };

/** The MCP tool spec (B-7), shown on /docs/mcp. */
export const MCP_TOOLS: McpTool[] = [
  {
    name: "get_blueprint",
    scope: "read_plan",
    does: "Reads the project's current plan: every part, its check, its status and its cost.",
    input: "{ version?: number }",
    output: "{ version, parts: [{ key, title, provedWhen, status, estimate }], questions, defaults }",
    policy: "Read-only. Never includes keys and passwords.",
  },
  {
    name: "update_item",
    scope: "change_parts",
    does: "Changes a part's code or instructions on the agent's branch.",
    input: "{ key: string, change: { instructions?: string, files?: [{ path, patch }] } }",
    output: "{ key, status: \"waiting_for_check\" }",
    policy: "Can't set a part's status. A file change names the part it belongs to (the key) and runs that part's check again, the same as an edit a person saves in Developer view; only the checker can mark it Works. On a project from a repo it goes on the pull request. A change that weakens a check is refused (A-3).",
  },
  {
    name: "run_in_sandbox",
    scope: "run",
    does: "Runs a command in the project's sandbox, on the agent's branch.",
    input: "{ command: string, timeoutSeconds?: number }",
    output: "{ exitCode, stdout, stderr, durationMs }",
    policy: "No network beyond the workspace's allowed hosts. Keys come from the test version only; calls with a key on Live follow the external-calls rule.",
  },
  {
    name: "run_tests",
    scope: "run",
    does: "Runs a part's tests in the sandbox and reports the result.",
    input: "{ key?: string }",
    output: "{ passed, failed, results: [{ name, ok, message? }] }",
    policy: "A passing run is information, not proof: the checker re-runs the part's locked check before it can work.",
  },
  {
    name: "open_pr",
    scope: "pull_requests",
    does: "Opens a pull request from the agent's branch into main, listing the parts it changes and their tests.",
    input: "{ title: string, parts: string[] }",
    output: "{ number, url, branch }",
    policy: "Nothing goes to main directly. Merging is a person's click; under governance a push to main needs approval.",
  },
  {
    name: "request_approval",
    scope: "approvals",
    does: "Asks an Owner or Admin for something a rule holds: an app, a Live deploy, a push to main, a key for Live, or calls to a service with a key on Live.",
    input: "{ kind: \"connector\" | \"deploy\" | \"push\" | \"secret\" | \"external_call\", reason: string }",
    output: "{ approvalId, status: \"waiting\" }",
    policy: "Lands in Approvals with the agent named as the requester. The agent can't approve its own request.",
  },
  {
    name: "get_preview_url",
    scope: "read_plan",
    does: "Gets the link to the test version, to check a change in a browser.",
    input: "{}",
    output: "{ url, sampleData: boolean }",
    policy: "The test version only; never the team version or Live.",
  },
];

/** Statuses only the checker sets. */
const CHECKER_ONLY = new Set(["built", "works", "sample_data"]);

export type AgentChange = { status?: string; instructions?: string; files?: { path: string }[] };

/**
 * update_item for a coding agent: any change sends the part back to wait for its check; asking to mark it Works
 * (or any status) is refused. Only the checker moves a part to Works.
 */
export function codingAgentUpdate(change: AgentChange): { ok: true; status: "waiting_for_check" } | { ok: false; reason: string } {
  if (change.status !== undefined) {
    return {
      ok: false,
      reason: CHECKER_ONLY.has(change.status) ? "Only the checker can mark a part Works. It re-runs the part's check after this change." : "A coding agent can't set a part's status.",
    };
  }
  return { ok: true, status: "waiting_for_check" };
}

export type SessionStep = { atMs: number; who: "agent" | "checker"; text: string; kind: "info" | "ok" | "fail" };
/** A coding agent can't deploy on its own: the same rule as Architect's agent (B-7, C-10). */
export const DEPLOY_REFUSAL = "a Live deploy needs an Owner or Admin's approval; use request_approval";

/**
 * The permission rules (C-10) for coding agents. An agent is never an Owner or Admin, so each action a rule covers is
 * a request through request_approval, never something it does itself, whether or not the rule is on for people.
 */
export const AGENT_RULES: { rule: "deploy" | "push" | "secrets" | "external"; tried: string; refusal: string }[] = [
  { rule: "deploy", tried: "tried to deploy to Live", refusal: DEPLOY_REFUSAL },
  { rule: "push", tried: "tried to merge its branch into main", refusal: "a push to main needs an Owner or Admin's approval; use request_approval" },
  { rule: "secrets", tried: "tried to set a key for Live", refusal: "a key for Live needs an Owner or Admin's approval, and the value is never stored; use request_approval" },
  { rule: "external", tried: "tried to call an outside service with a key on Live", refusal: "calls with a key on Live need an Owner or Admin's OK; use request_approval" },
];

/** The refusal a coding agent gets for an action a permission rule covers. */
export function agentRefusal(rule: (typeof AGENT_RULES)[number]["rule"]): string {
  return AGENT_RULES.find((r) => r.rule === rule)!.refusal;
}

export type AgentSession = { partKey: string; partTitle: string; agent: string; steps: SessionStep[]; waitFromMs: number; worksAtMs: number; endMs: number };

/** The part a session works on: Brief writer if the plan has it, else an agent part that works, else any part that works. */
export function sessionPart<T extends { key: string; title: string; grp: string; status: string }>(parts: T[]): T | null {
  const works = parts.filter((p) => p.status === "built" || p.status === "sample_data");
  return works.find((p) => /^brief writer/i.test(p.title)) ?? works.find((p) => p.grp === "agents") ?? works[0] ?? null;
}

/**
 * ?sim=byoagent: a short scripted session by a coding agent over MCP. It reads the plan, updates a part, tries to
 * mark it Works (refused by codingAgentUpdate), runs the tests, tries each action a permission rule covers (deploy to
 * Live, merge into main, set a Live key, call a service with a key on Live: all refused, as for Architect's own agent:
 * B-7, C-10), and the part waits until the checker passes it.
 */
export function agentSession(input: { part: { key: string; title: string }; partCount: number; version: number; owner: string; repo: boolean }): AgentSession {
  const agent = `Claude Code (${input.owner})`;
  const t = input.part.title;
  const update = codingAgentUpdate({ instructions: "…", files: [{ path: `agents/${input.part.key}.py` }] });
  const mark = codingAgentUpdate({ status: "built" });
  const steps: SessionStep[] = [
    { atMs: 0, who: "agent", kind: "info", text: `read the plan (v${input.version}, ${input.partCount} parts)` },
    { atMs: 1500, who: "agent", kind: "info", text: `updated ‘${t}’` },
    { atMs: 1600, who: "checker", kind: "info", text: update.ok ? `‘${t}’ changed, so it waits for its check` : "" },
    { atMs: 3000, who: "agent", kind: "fail", text: `tried to mark ‘${t}’ Works · refused: ${mark.ok ? "" : mark.reason}` },
    { atMs: 4500, who: "agent", kind: "info", text: `ran the tests for ‘${t}’ in the sandbox · 3 of 3 passed (not proof)` },
    // Every permission rule applies to the agent (C-10): each attempt is refused and points at request_approval.
    ...AGENT_RULES.filter((r) => input.repo || r.rule !== "push").map((r, i) => ({ atMs: 5200 + i * 150, who: "agent" as const, kind: "fail" as const, text: `${r.tried} · refused: ${r.refusal}` })),
    { atMs: 6000, who: "checker", kind: "info", text: `re-running the locked check for ‘${t}’` },
    { atMs: 9000, who: "checker", kind: "ok", text: `Passed 3 of 3 · ‘${t}’ works` },
  ];
  if (input.repo) steps.push({ atMs: 9800, who: "agent", kind: "info", text: `opened a pull request for ‘${t}’` });
  return { partKey: input.part.key, partTitle: t, agent, steps, waitFromMs: 1600, worksAtMs: 9000, endMs: steps[steps.length - 1].atMs };
}

/** The activity line for a step, as Activity shows it ("Coding agent: Claude Code (Sam) · via MCP · updated ‘Brief writer’"). */
export function sessionLine(session: AgentSession, step: SessionStep): string {
  return step.who === "agent" ? `Coding agent: ${session.agent} · via MCP · ${step.text}` : `Checker · ${step.text}`;
}

/** The token a coding agent would use: shown once; only its hash is stored. */
export const TOKEN_PREFIX = "ax_pt_";

/** The audit action for an agent step of the scripted session (they show under "Coding agent" in the audit log). */
export function sessionAuditAction(step: SessionStep): string {
  if (step.kind === "fail") return "coding_agent.refused";
  if (step.text.startsWith("read the plan")) return "coding_agent.read_plan";
  if (step.text.startsWith("updated")) return "coding_agent.changed_part";
  if (step.text.startsWith("ran the tests")) return "coding_agent.ran_tests";
  if (step.text.startsWith("opened a pull request")) return "coding_agent.opened_pr";
  return "coding_agent.acted";
}
