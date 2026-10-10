/**
 * The organisation's policies (C-1 where it runs, C-2 models, C-3 apps and MCP servers), in plain words. Stored as
 * `policies` rows (config jsonb); this module reads them with safe defaults and says what each one means. Policies
 * apply only while governance is on (PRD 8.4). Shared by client and server; no I/O.
 */
import { MODEL_CHOICES, MODEL_LABEL, type ModelChoice } from "./models";
import { PROVIDERS, providerName } from "./providers";

/* ------------------------------------------------------------------ C-1 Where it runs */

export type LocationMode = "lyzr_cloud" | "customer_vpc" | "dedicated_region" | "on_prem";

export const LOCATIONS: { mode: LocationMode; label: string; detail: string; available: boolean }[] = [
  { mode: "lyzr_cloud", label: "Lyzr Cloud", detail: "Lyzr runs everything for you. The quickest start.", available: true },
  { mode: "customer_vpc", label: "Your AWS account (VPC)", detail: "Everything runs in a VPC in your AWS account. Lyzr only signs people in, bills and ships updates.", available: true },
  { mode: "dedicated_region", label: "Dedicated region", detail: "A single-tenant Lyzr region in the country you choose.", available: false },
  { mode: "on_prem", label: "On-prem or air-gapped", detail: "Everything runs in your own data centre, with no way out to the internet.", available: false },
];

/** Not in v1 (PRD section 14): shown so admins can see what's coming, with the reason they can't pick it. */
export const LOCATION_LATER = "Not in this version: dedicated regions, Azure, GCP and on-prem or air-gapped follow after the design-partner beta.";

export const AWS_REGIONS: { id: string; label: string }[] = [
  { id: "us-east-1", label: "US East (N. Virginia)" },
  { id: "eu-west-1", label: "Europe (Ireland)" },
  { id: "eu-central-1", label: "Europe (Frankfurt)" },
  { id: "ap-south-1", label: "Asia Pacific (Mumbai)" },
];

export type LocationPolicy = { mode: LocationMode; region: string | null };

export function locationOf(config: unknown): LocationPolicy {
  const c = (config ?? {}) as { mode?: string; region?: string };
  const mode = LOCATIONS.some((l) => l.mode === c.mode) ? (c.mode as LocationMode) : "lyzr_cloud";
  const region = mode === "customer_vpc" ? (AWS_REGIONS.some((r) => r.id === c.region) ? c.region! : "us-east-1") : null;
  return { mode, region };
}

/** "Lyzr Cloud", "Your AWS VPC · eu-west-1". */
export function locationLabel(p: LocationPolicy): string {
  if (p.mode === "customer_vpc") return `Your AWS VPC · ${p.region}`;
  return LOCATIONS.find((l) => l.mode === p.mode)!.label;
}

export type Zone = { name: string; owner: "lyzr" | "yours" | "outside"; components: string[] };

/**
 * Where each component runs for a location (C-1's diagram): the Architect agent, its model, sandboxes, app agents'
 * models, data and deployed apps. A commercial model API always sits outside; a private model sits with the rest.
 */
export function placement(loc: LocationPolicy, models: ModelPolicy): { zones: Zone[]; notes: string[] } {
  const modelName = (m: ModelChoice) => (m === "private" && models.private ? models.private.name : MODEL_LABEL[m]);
  const architect = `Architect's model: ${modelName(models.architect)}`;
  const agents = `App agents' models: ${modelName(models.agentDefault)}`;
  const inside = ["Architect agent", "Sandboxes (code and checks run here)", "Your data", "Deployed apps (Test, Team, Live)"];
  const privateModels = [models.architect === "private" ? architect : null, models.agentDefault === "private" ? agents : null].filter(Boolean) as string[];
  const outsideModels = [models.architect !== "private" ? architect : null, models.agentDefault !== "private" ? agents : null].filter(Boolean) as string[];
  const notes: string[] = [];
  const zones: Zone[] = [];
  if (loc.mode === "lyzr_cloud") {
    zones.push({ name: "Lyzr Cloud · AWS us-east-1", owner: "lyzr", components: [...inside, ...privateModels] });
  } else if (loc.mode === "customer_vpc") {
    zones.push({ name: `Your AWS account · VPC in ${loc.region}`, owner: "yours", components: [...inside, ...privateModels] });
    zones.push({ name: "Lyzr control plane", owner: "lyzr", components: ["Sign-in, billing and updates. No project data."] });
    if (outsideModels.length) notes.push("A commercial model runs outside your VPC; requests leave through the egress proxy. To keep everything inside, register your private model and make it Architect's model.");
  } else if (loc.mode === "dedicated_region") {
    zones.push({ name: "Lyzr dedicated region (single tenant)", owner: "lyzr", components: [...inside, ...privateModels] });
  } else {
    zones.push({ name: "Your data centre (air-gapped)", owner: "yours", components: [...inside, ...privateModels] });
    if (outsideModels.length) notes.push("Air-gapped means no commercial model can be reached: only your private model can run.");
  }
  if (outsideModels.length) zones.push({ name: "Model providers' APIs", owner: "outside", components: outsideModels });
  return { zones, notes };
}

/* ------------------------------------------------------------------ C-2 Models */

export type PrivateModel = { name: string; url: string; kind: "own" | "open_source" };

export type ModelPolicy = {
  allowed: ModelChoice[];
  /** The model the Architect agent writes plans with, and new projects start on. */
  architect: ModelChoice;
  /** The model new app agents start on. */
  agentDefault: ModelChoice;
  /** The organisation's own trained model, or an open-source model it hosts, at a private endpoint. */
  private: PrivateModel | null;
  /** Commercial models billed to the organisation's own key (bring your own key). The key itself is never stored here. */
  ownKeys: ModelChoice[];
};

const COMMERCIAL: ModelChoice[] = ["gemini", "claude", "gpt", "openrouter"];

export function modelPolicyOf(config: unknown): ModelPolicy {
  const c = (config ?? {}) as { allowed?: unknown; architect?: unknown; agent_default?: unknown; private?: unknown; own_keys?: unknown };
  const pm = c.private as Partial<PrivateModel> | null | undefined;
  const priv: PrivateModel | null = pm && typeof pm.name === "string" && typeof pm.url === "string" ? { name: pm.name, url: pm.url, kind: pm.kind === "own" ? "own" : "open_source" } : null;
  const valid = (v: unknown): v is ModelChoice => typeof v === "string" && (MODEL_CHOICES as readonly string[]).includes(v) && (v !== "private" || priv !== null);
  const allowedRaw = Array.isArray(c.allowed) ? c.allowed.filter(valid) : [];
  const allowed = allowedRaw.length ? [...new Set(allowedRaw)] : COMMERCIAL;
  const pick = (v: unknown) => (valid(v) && allowed.includes(v) ? v : allowed.includes("gemini") ? "gemini" : allowed[0]);
  return {
    allowed,
    architect: pick(c.architect),
    agentDefault: pick(c.agent_default),
    private: priv,
    ownKeys: Array.isArray(c.own_keys) ? c.own_keys.filter((m): m is ModelChoice => valid(m) && m !== "private") : [],
  };
}

/** The config to store for a model policy (snake_case, as the seed wrote it). */
export function modelConfig(p: ModelPolicy) {
  return { allowed: p.allowed, architect: p.architect, agent_default: p.agentDefault, private: p.private, own_keys: p.ownKeys };
}

/** With governance off nothing is restricted: every model but an unregistered private one. */
export const OPEN_MODELS: ModelPolicy = { allowed: COMMERCIAL, architect: "gemini", agentDefault: "gemini", private: null, ownKeys: [] };

/** Why a model policy can't be saved, or null. */
export function modelPolicyProblem(p: ModelPolicy): string | null {
  if (!p.allowed.length) return "Allow at least one model, or nobody can write a plan.";
  if (p.allowed.includes("private") && !p.private) return "Register your private model before allowing it.";
  if (!p.allowed.includes(p.architect)) return "Architect's model has to be one of the allowed models.";
  if (!p.allowed.includes(p.agentDefault)) return "The default for app agents has to be one of the allowed models.";
  return null;
}

/** Why a private endpoint can't be registered, or null. */
export function privateModelProblem(m: { name: string; url: string }): string | null {
  if (!m.name.trim() || m.name.trim().length > 60) return "Give the model a name of up to 60 characters.";
  let u: URL;
  try {
    u = new URL(m.url.trim());
  } catch {
    return "The endpoint has to be a full URL, like https://llm.acme.internal/v1.";
  }
  if (u.protocol !== "https:") return "The endpoint has to use https.";
  return null;
}

/** The inline line where a model is picked: the project or agent is on a model the policy no longer allows. */
export const MODEL_NOT_ALLOWED = "This model is no longer allowed";

/* ------------------------------------------------------------------ C-3 Apps and MCP servers */

export type Scope = "read" | "read_write";
export type McpServer = { name: string; url: string };
export type AppPolicy = {
  /** Apps any project may use. Anything else needs an Owner or Admin to approve it, per project or everywhere. */
  allow: string[];
  /** Who may connect an allowed app to the workspace. */
  whoCanConnect: "builders" | "admins";
  /** What each allowed app may do. */
  scopes: Record<string, Scope>;
  /** MCP servers app agents may use as tools. */
  mcp: McpServer[];
};

export function appPolicyOf(config: unknown): AppPolicy {
  const c = (config ?? {}) as { allow?: unknown; who_can_connect?: unknown; scopes?: unknown; mcp?: unknown };
  const allow = Array.isArray(c.allow) ? [...new Set(c.allow.filter((v): v is string => typeof v === "string"))] : [];
  const scopes: Record<string, Scope> = {};
  for (const [k, v] of Object.entries((c.scopes ?? {}) as Record<string, unknown>)) if (v === "read" || v === "read_write") scopes[k] = v;
  const mcp = Array.isArray(c.mcp) ? c.mcp.filter((m): m is McpServer => typeof m?.name === "string" && typeof m?.url === "string") : [];
  return { allow, whoCanConnect: c.who_can_connect === "admins" ? "admins" : "builders", scopes, mcp };
}

/** The stored config. `deny` lists the known apps that aren't allowed, for older readers and the Connections page. */
export function appConfig(p: AppPolicy, known: string[]) {
  return { allow: p.allow, deny: known.filter((k) => !p.allow.includes(k)), who_can_connect: p.whoCanConnect, scopes: p.scopes, mcp: p.mcp };
}

/** Apps the policy page lists: the ones Architect knows, plus any a plan in this workspace uses. */
export function knownApps(used: string[]): string[] {
  return [...new Set([...Object.keys(PROVIDERS), ...used.filter(Boolean)])];
}

export const SCOPE_LABEL: Record<Scope, string> = { read: "Read only", read_write: "Read and write" };

export function scopeOf(p: AppPolicy, provider: string): Scope {
  return p.scopes[provider] ?? "read_write";
}

/** Why this person can't connect apps here, or undefined. */
export function connectRefusal(p: AppPolicy, governance: boolean, isAdmin: boolean): string | undefined {
  return governance && p.whoCanConnect === "admins" && !isAdmin ? "Your admin's rule: only Owners and Admins connect apps in this workspace." : undefined;
}

/** Why an MCP server can't be added, or null. */
export function mcpProblem(m: McpServer, existing: McpServer[]): string | null {
  if (!m.name.trim() || m.name.trim().length > 60) return "Give the server a name of up to 60 characters.";
  try {
    if (new URL(m.url.trim()).protocol !== "https:") return "The server's URL has to use https.";
  } catch {
    return "The server needs a full URL, like https://mcp.acme.internal.";
  }
  if (existing.some((e) => e.name.toLowerCase() === m.name.trim().toLowerCase())) return "There's already a server with that name.";
  if (existing.length >= 20) return "Up to 20 MCP servers.";
  return null;
}

/** One line per section for the Governance list. */
export function summaries(input: { location: LocationPolicy; models: ModelPolicy; apps: AppPolicy }) {
  const { location, models, apps } = input;
  const name = (m: ModelChoice) => (m === "private" && models.private ? models.private.name : MODEL_LABEL[m]);
  return {
    location: locationLabel(location),
    models: `${models.allowed.length} allowed · Architect: ${name(models.architect)}`,
    apps: `${apps.allow.length} app${apps.allow.length === 1 ? "" : "s"} allowed · ${apps.mcp.length} MCP server${apps.mcp.length === 1 ? "" : "s"}`,
  };
}

export { providerName };

/* ------------------------------------------------------------------ C-10 Permission rules */

/** Actions that leave the sandbox and need an Owner or Admin when a Builder (or their coding agent) does them. */
export type PermissionRules = { deploy: boolean; push: boolean; secrets: boolean; external: boolean };

export const PERMISSIONS: { id: keyof PermissionRules; key: string; label: string; effect: string }[] = [
  { id: "deploy", key: "production_deploy", label: "Live deploys", effect: "A Builder's Go live asks an Owner or Admin." },
  { id: "push", key: "push_to_main", label: "Pushes to main", effect: "A Builder's merge of a pull request asks an Owner or Admin." },
  { id: "secrets", key: "live_secrets", label: "Keys and passwords for Live", effect: "A Builder's key for Live waits for an Owner or Admin." },
  { id: "external", key: "external_calls", label: "External calls with a key", effect: "A part that calls an outside service with an API key waits for an Owner or Admin's OK before it runs on Live." },
];

/**
 * Reads the permission policy. The seed listed only push and deploy, before keys existed: until the rules are saved
 * from Governance (`rules_version` 2), a Live key needs approval too, as the brief asks. External calls with a key came
 * with `rules_version` 3 and are on the same way.
 */
export function permissionsOf(config: unknown): PermissionRules {
  const c = (config ?? {}) as { needs_approval?: unknown; rules_version?: unknown };
  const list = Array.isArray(c.needs_approval) ? (c.needs_approval as string[]) : ["production_deploy", "push_to_main"];
  // External calls (added with rules_version 3) are on until the rules are saved with them off, like Live keys before.
  const v = typeof c.rules_version === "number" ? c.rules_version : 1;
  return { deploy: list.includes("production_deploy"), push: list.includes("push_to_main"), secrets: v >= 2 ? list.includes("live_secrets") : true, external: v >= 3 ? list.includes("external_calls") : true };
}

export function permissionConfig(p: PermissionRules) {
  return { rules_version: 3, needs_approval: PERMISSIONS.filter((x) => p[x.id]).map((x) => x.key) };
}

export const NO_RULES: PermissionRules = { deploy: false, push: false, secrets: false, external: false };

/* ------------------------------------------------------------------ C-7 Budgets */

export type OrgBudget = { monthlyCap: number | null };

export function budgetOf(config: unknown): OrgBudget {
  const cap = Number((config as { monthly_cap?: unknown } | null)?.monthly_cap);
  return { monthlyCap: Number.isFinite(cap) && cap > 0 ? Math.round(cap) : null };
}

/** Where the organisation is against its monthly cap: an alert from 80%, paid actions stopped at 100%. */
export function budgetState(cap: number | null, spent: number): { level: "none" | "ok" | "alert" | "stopped"; percent: number; left: number } {
  if (!cap) return { level: "none", percent: 0, left: Infinity };
  const percent = Math.floor((spent / cap) * 100);
  return { level: spent >= cap ? "stopped" : percent >= 80 ? "alert" : "ok", percent, left: Math.max(0, Math.round(cap - spent)) };
}

export const BUDGET_STOPPED = "Your organisation has used its monthly credit cap. Paid actions are stopped until an Owner or Admin raises it.";

/** Why a cap can't be saved, or null. */
export function capProblem(cap: number | null): string | null {
  if (cap === null) return null;
  if (!Number.isInteger(cap) || cap < 10 || cap > 1_000_000) return "Set a cap between 10 and 1,000,000 credits, or none.";
  return null;
}
