/**
 * The approval queue (C-5, screen 11), in plain words. Shared by the Approvals page and the server; no I/O.
 * A request comes from a rule (C-10): Live deploys, pushes to main, coding-agent tokens and apps not on the allowed
 * list wait for an Owner or Admin. Deciding records who, when and why; "allow" also records an allow-rule.
 */
import type { StatusIcon } from "@/components/ax/status-mark";
import { SCOPES } from "./mcp";
import { providerName, PROVIDERS } from "./providers";

export type ApprovalKind = "connector" | "deploy" | "token" | "push" | "budget";
export type ApprovalStatus = "waiting" | "approved" | "rejected";
/** Approve this one request, or approve it and record an allow-rule so the same request doesn't wait again. */
export type DecisionScope = "once" | "rule";

export type ApprovalInput = {
  id: string;
  kind: ApprovalKind;
  title: string;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedByName: string | null;
  reason: string | null;
  project: { id: string; name: string } | null;
  requestedByName: string | null;
  payload: Record<string, unknown>;
  /** Deploy: the project's parts that work, of all it has. */
  works?: { done: number; total: number } | null;
  /** The egress policy's allowed hosts (C-4). */
  egressHosts: string[];
};

export type ApprovalAction = { scope: DecisionScope; label: string; consequence: string };

export type ApprovalView = {
  id: string;
  kind: ApprovalKind;
  status: ApprovalStatus;
  icon: StatusIcon;
  title: string;
  /** The list row's second line: who asked, and the one fact that matters most. */
  meta: string;
  /** Above the title: what kind of request, and the rule that sent it here. */
  ruleLine: string;
  /** What approving does, in one sentence. */
  consequence: string;
  facts: { label: string; value: string }[];
  /** Where the data would go, for an app (screen 11's strip). */
  flow: { from: string; data: string; host: string; allowed: boolean } | null;
  /** The buttons, primary first. Reject is always there. */
  actions: ApprovalAction[];
  /** Decided: "Approved by Jordan · 10 Oct" and the reason, if any. */
  decided: { line: string; reason: string | null } | null;
  projectId: string | null;
};

/** Where each service's API lives, and what a project sends it (the data-flow strip). */
const HOSTS: Record<string, { host: string; data: string }> = {
  hubspot: { host: "api.hubapi.com", data: "contact details" },
  slack: { host: "slack.com", data: "messages" },
  gmail: { host: "gmail.googleapis.com", data: "email threads" },
  google_calendar: { host: "www.googleapis.com", data: "meeting details" },
  zendesk: { host: "zendesk.com", data: "ticket replies" },
  github: { host: "api.github.com", data: "code" },
};

export function serviceHost(provider: string): { host: string; data: string } {
  return HOSTS[provider] ?? { host: `api.${provider.replace(/_/g, "")}.com`, data: `data for ${providerName(provider)}` };
}

/** A host is allowed when it is on the list or under a listed domain ("googleapis.com" covers "www.googleapis.com"). */
export function hostAllowed(host: string, allowed: string[]): boolean {
  return allowed.some((a) => host === a || host.endsWith(`.${a}`));
}

const SCOPE_WORDS: Record<string, string> = {
  read_plan: "read",
  change_parts: "propose changes",
  run: "run tests",
  pull_requests: "open pull requests",
  approvals: "ask for approval",
};

/** "read and propose changes only" from a token's scopes. */
export function scopeSummary(scopes: string[]): string {
  const words = SCOPES.filter((s) => scopes.includes(s.id)).map((s) => SCOPE_WORDS[s.id]);
  if (!words.length) return "no access yet";
  const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
  return words.length < SCOPES.length ? `${list} only` : list;
}

const firstName = (name: string | null) => (name ? name.split(" ")[0] : "Someone");

const ICON: Record<ApprovalKind, StatusIcon> = { connector: "plug", deploy: "lines", token: "lock", push: "lines", budget: "dot" };

export const RULE_LINE: Record<ApprovalKind, string> = {
  connector: "New tool · rule: tools not on your approved list need an admin",
  deploy: "Live deploy · rule: Live deploys need an admin",
  push: "Push to main · rule: pushes to main need an admin",
  token: "Coding agent · rule: coding-agent tokens need an admin",
  budget: "Budget · rule: going over the org budget needs an admin",
};

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function approvalView(a: ApprovalInput): ApprovalView {
  const p = a.payload;
  const by = a.requestedByName ?? (typeof p.requested_by_name === "string" ? p.requested_by_name : null);
  const project = a.project?.name ?? (typeof p.project === "string" ? p.project : null);
  const facts: ApprovalView["facts"] = [];
  const actions: ApprovalAction[] = [];
  let title = a.title;
  let meta = firstName(by);
  let consequence = "Approving records your decision.";
  let flow: ApprovalView["flow"] = null;

  if (a.kind === "connector") {
    const provider = String(p.provider ?? "");
    const name = providerName(provider);
    const part = typeof p.item_title === "string" ? p.item_title : null;
    title = a.project ? `Add ${name} to ${a.project.name}` : `Allow ${name} in the workspace`;
    meta = `${firstName(by)} · ${part ? `needed for “${part}”` : "for any project"}`;
    facts.push({ label: "Asked by", value: `${by ?? "Someone"}${part ? `, from the plan part “${part}”` : ""}` });
    if (typeof p.why === "string" && p.why.trim()) facts.push({ label: "Why", value: p.why });
    facts.push({ label: "Access", value: PROVIDERS[provider]?.what ?? `What ${name} lets the part do.` });
    const { host, data } = serviceHost(provider);
    flow = { from: project ?? "Your projects", data, host, allowed: hostAllowed(host, a.egressHosts) };
    if (a.project) {
      consequence = `Approving adds ${name} to ${a.project.name} only. ${part ? `The part “${part}” then asks to connect ${name}.` : ""}`.trim();
      actions.push({ scope: "once", label: "Approve for this project", consequence });
    } else {
      consequence = `Approving adds ${name} to your allowed apps, for every project.`;
    }
    actions.push({ scope: "rule", label: "Approve and allow everywhere", consequence: `${name} joins your allowed apps, so any project can use it without asking.` });
  } else if (a.kind === "deploy") {
    const version = typeof p.version === "number" ? p.version : null;
    title = project ? `Make ${project} live` : a.title;
    meta = `${firstName(by)} · ${a.works ? `${a.works.done} of ${a.works.total} parts work` : version ? `v${version}` : "Live deploy"}`;
    facts.push({ label: "Asked by", value: by ?? "Someone" });
    if (version) facts.push({ label: "Version", value: `v${version}` });
    if (a.works) facts.push({ label: "Parts", value: `${a.works.done} of ${a.works.total} work` });
    consequence = `Approving puts ${version ? `v${version} of ` : ""}${project ?? "the app"} live now, if its checklist is clear.`;
    actions.push({ scope: "once", label: "Approve", consequence });
    if (a.project) actions.push({ scope: "rule", label: `Approve and allow for ${a.project.name}`, consequence: `Later Live deploys of ${a.project.name} won't need an admin.` });
  } else if (a.kind === "push") {
    const n = typeof p.pr_number === "number" ? p.pr_number : Number(/#(\d+)/.exec(a.title)?.[1] ?? NaN);
    const pr = Number.isFinite(n) ? `PR #${n}` : "the pull request";
    title = project ? `Push ${pr} of ${project} to main` : a.title;
    meta = `${firstName(by)} · ${typeof p.branch === "string" ? p.branch : "into main"}`;
    facts.push({ label: "Asked by", value: by ?? "Someone" });
    if (typeof p.branch === "string") facts.push({ label: "Branch", value: `${p.branch} → main` });
    consequence = `Approving merges ${pr} into main, if its checks pass.`;
    actions.push({ scope: "once", label: "Approve", consequence });
    if (a.project) actions.push({ scope: "rule", label: `Approve and allow for ${a.project.name}`, consequence: `Later pushes to main from ${a.project.name} won't need an admin.` });
  } else if (a.kind === "token") {
    const agent = typeof p.agent === "string" ? p.agent : typeof p.token_name === "string" ? p.token_name : "A coding agent";
    const scopes = Array.isArray(p.scopes) ? (p.scopes as string[]) : [];
    const can = scopes.length ? scopeSummary(scopes) : "read and propose changes only";
    title = project ? `Let ${agent} edit ${project}` : a.title;
    meta = `${firstName(by)} · ${can}`;
    facts.push({ label: "Asked by", value: by ?? "Someone" });
    facts.push({ label: "Agent", value: `${agent}, through Architect's MCP server` });
    facts.push({ label: "Can", value: can.charAt(0).toUpperCase() + can.slice(1) });
    consequence = `Approving turns the token on. ${agent} can then ${can.replace(/ only$/, "")}, and every change still waits for its check.`;
    actions.push({ scope: "once", label: "Approve", consequence });
  } else {
    facts.push({ label: "Asked by", value: by ?? "Someone" });
    actions.push({ scope: "once", label: "Approve", consequence });
  }

  const decided =
    a.status === "waiting"
      ? null
      : {
          line: `${a.status === "approved" ? "Approved" : "Rejected"} by ${a.decidedByName ?? "an admin"}${a.decidedAt ? ` · ${formatDay(a.decidedAt)}` : ""}${p.decision_scope === "rule" ? " · allowed from now on" : ""}`,
          reason: a.reason,
        };

  return { id: a.id, kind: a.kind, status: a.status, icon: ICON[a.kind], title, meta, ruleLine: RULE_LINE[a.kind], consequence, facts, flow, actions, decided, projectId: a.project?.id ?? null };
}

/** Why a decision can't be saved, or null. A reason is required to reject, and kept short. */
export function decisionProblem(decision: "approve" | "reject", reason: string): string | null {
  const r = reason.trim();
  if (decision === "reject" && !r) return "Say why you're rejecting it. The person who asked sees your reason.";
  if (r.length > 500) return "Keep the reason under 500 characters.";
  return null;
}

/** An allow-rule in plain words, for the Rules tab. */
export type AllowRule = { id: string; action: "connector" | "production_deploy" | "push_to_main"; projectName: string | null; target: string | null; createdByName: string; createdAt: string; reason: string | null };

export function ruleTitle(r: Pick<AllowRule, "action" | "projectName" | "target">): string {
  if (r.action === "connector") return `${providerName(r.target)} allowed in ${r.projectName ?? "every project"}`;
  const where = r.projectName ?? "every project";
  return r.action === "production_deploy" ? `${where}: Live deploys don't need an admin` : `${where}: pushes to main don't need an admin`;
}

/** The rules that send requests here (Rules tab), from the workspace's policies. */
export function queueRules(policies: { kind: string; config: Record<string, unknown> }[]): { title: string; detail: string }[] {
  const list = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);
  const permission = list(policies.find((p) => p.kind === "permission")?.config.needs_approval);
  const connectors = policies.find((p) => p.kind === "connectors")?.config ?? {};
  const rules: { title: string; detail: string }[] = [];
  if (permission.includes("production_deploy")) rules.push({ title: "Live deploys need an Owner or Admin", detail: "A Builder's Go live waits here. Owners and Admins go live themselves." });
  if (permission.includes("push_to_main")) rules.push({ title: "Pushes to main need an Owner or Admin", detail: "A Builder's merge of a pull request waits here." });
  rules.push({ title: "Coding-agent tokens need an Owner or Admin", detail: "Every new project token waits here before an agent can use it." });
  const allow = list(connectors.allow).map(providerName);
  const deny = list(connectors.deny).map(providerName);
  rules.push({
    title: "Apps not on your allowed list need an Owner or Admin",
    detail: `Allowed: ${allow.length ? allow.join(", ") : "none yet"}.${deny.length ? ` Not allowed: ${deny.join(", ")}.` : ""}`,
  });
  return rules;
}
