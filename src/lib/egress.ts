/**
 * Data egress (C-4): where a project's data would go once it runs, and whether the organisation allows it. A path is
 * the project → what it sends → a destination: an app's API host, or the host of the model its agents use. App hosts
 * must be on the egress policy's allowed hosts; models must be allowed by the model policy (C-2). A path that breaks a
 * rule blocks the deploy, and the data-flow view highlights it with the rule. Shared by client and server; no I/O.
 */
import { hostAllowed, serviceHost } from "./approvals";
import { MODEL_LABEL, type ModelChoice } from "./models";
import type { ModelPolicy } from "./policies";
import { providerName } from "./providers";

export type Redaction = "email" | "phone" | "card" | "name";

export const REDACTIONS: { id: Redaction; label: string }[] = [
  { id: "email", label: "Email addresses" },
  { id: "phone", label: "Phone numbers" },
  { id: "card", label: "Payment card numbers" },
  { id: "name", label: "People's names" },
];

/** `restricted` is false when the workspace has no egress policy at all: then nothing is held back. */
export type EgressPolicy = { hosts: string[]; redact: Redaction[]; restricted?: boolean };

export function egressOf(config: unknown): EgressPolicy {
  const c = (config ?? {}) as { hosts?: unknown; redact?: unknown };
  const hosts = Array.isArray(c.hosts) ? [...new Set(c.hosts.filter((h): h is string => typeof h === "string").map((h) => h.trim().toLowerCase()))] : [];
  const redact = Array.isArray(c.redact) ? c.redact.filter((r): r is Redaction => REDACTIONS.some((x) => x.id === r)) : ["email", "phone", "card"];
  return { hosts, redact: [...new Set(redact)] as Redaction[], restricted: Array.isArray(c.hosts) };
}

export function egressConfig(p: EgressPolicy) {
  return { mode: "allow_list", hosts: p.hosts, redact: p.redact };
}

/** "api.hubapi.com" or "hubapi.com": a bare host name, no scheme, path or port. */
export function hostProblem(host: string, existing: string[]): string | null {
  const h = host.trim().toLowerCase();
  if (!/^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h)) return "Type a host name like api.hubapi.com, without https:// or a path.";
  if (existing.includes(h)) return `${h} is already on the list.`;
  if (existing.length >= 50) return "Up to 50 hosts.";
  return null;
}

const MODEL_HOST: Record<Exclude<ModelChoice, "private">, string> = {
  gemini: "generativelanguage.googleapis.com",
  claude: "api.anthropic.com",
  gpt: "api.openai.com",
  openrouter: "openrouter.ai",
};

export function modelHost(m: ModelChoice, models: ModelPolicy): string {
  if (m === "private") {
    try {
      return models.private ? new URL(models.private.url).host : "your private endpoint";
    } catch {
      return "your private endpoint";
    }
  }
  return MODEL_HOST[m];
}

export const RULE_HOSTS = "Data may only go to hosts on your allowed list (Data and egress)";
export const RULE_MODELS = "Data may only go to models your organisation allows (Models)";

export type FlowPath = {
  id: string;
  kind: "app" | "model";
  /** The app or model it goes to, in plain words. */
  to: string;
  host: string;
  /** What it sends. */
  data: string;
  /** The parts (or agents) that send it. */
  from: string[];
  allowed: boolean;
  /** The rule it breaks, when it isn't allowed. */
  rule: string | null;
  /** Personal data taken out before it leaves (models only). */
  redacted: string[];
};

/**
 * The paths of one project. Parts set aside or dropped send nothing. Agent parts send their prompts to the model their
 * agents use (`agentModels`, else the default). A private model's endpoint is the organisation's own, so it's allowed.
 */
export function dataFlow(input: {
  parts: { title: string; status: string; grp: string; provider: string | null }[];
  agentModels: { name: string; model: ModelChoice }[];
  egress: EgressPolicy;
  models: ModelPolicy;
}): FlowPath[] {
  const active = input.parts.filter((p) => p.status !== "deferred" && p.status !== "dropped");
  const paths: FlowPath[] = [];
  const apps = new Map<string, string[]>();
  for (const p of active.filter((p) => p.provider)) apps.set(p.provider!, [...(apps.get(p.provider!) ?? []), p.title]);
  for (const [provider, from] of apps) {
    const { host, data } = serviceHost(provider);
    const allowed = input.egress.restricted === false || hostAllowed(host, input.egress.hosts);
    paths.push({ id: `app-${provider}`, kind: "app", to: providerName(provider), host, data, from, allowed, rule: allowed ? null : RULE_HOSTS, redacted: [] });
  }
  const byModel = new Map<ModelChoice, string[]>();
  for (const a of input.agentModels) byModel.set(a.model, [...(byModel.get(a.model) ?? []), a.name]);
  const redacted = REDACTIONS.filter((r) => input.egress.redact.includes(r.id)).map((r) => r.label.toLowerCase());
  for (const [m, from] of byModel) {
    const allowed = input.models.allowed.includes(m);
    const name = m === "private" && input.models.private ? input.models.private.name : MODEL_LABEL[m];
    paths.push({ id: `model-${m}`, kind: "model", to: name, host: modelHost(m, input.models), data: "agent prompts and the data they read", from, allowed, rule: allowed ? null : RULE_MODELS, redacted });
  }
  return paths;
}

/** The checklist line for a blocked path (Launch): what would leave, where to, and the rule. */
export function blockedLine(p: FlowPath): { title: string; detail: string } {
  return {
    title: p.kind === "app" ? `${cap(p.data)} would go to ${p.host}, which isn't allowed` : `Agent prompts would go to ${p.to}, which isn't allowed`,
    detail: `From ${p.from.join(", ")}. ${p.rule}.`,
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Re-checks app paths against a draft host list (the Governance page previews unsaved changes). */
export function egressOfDraft(hosts: string[]) {
  return (p: FlowPath): FlowPath => {
    if (p.kind !== "app") return p;
    const allowed = hostAllowed(p.host, hosts);
    return { ...p, allowed, rule: allowed ? null : RULE_HOSTS };
  };
}
