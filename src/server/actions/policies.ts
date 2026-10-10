"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Json } from "@/lib/database.types";
import { egressConfig, hostProblem, REDACTIONS, type Redaction } from "@/lib/egress";
import { MODEL_CHOICES } from "@/lib/models";
import { canBuild, canManageMembers } from "@/lib/permissions";
import {
  appConfig,
  AWS_REGIONS,
  knownApps,
  LOCATION_LATER,
  LOCATIONS,
  locationLabel,
  mcpProblem,
  capProblem,
  modelConfig,
  modelPolicyProblem,
  PERMISSIONS,
  permissionConfig,
  privateModelProblem,
  type AppPolicy,
  type LocationPolicy,
  type ModelPolicy,
} from "@/lib/policies";
import { createAdminDb, type AdminDb } from "../db";
import { loadPolicies, usedApps } from "../policy";
import { getAppContext, type AppContext } from "../workspace";
import type { ActionResult } from "./members";

/* Governance › Where it runs, Models, Apps and MCP servers (C-1 to C-3). Owners and Admins change them while
   governance is on; every change is audited with what it was and what it became. Enforcement is simulated. */

type Kind = "location" | "models" | "connectors" | "egress" | "permission" | "budget";

async function guard(): Promise<{ ctx: AppContext; refused?: string }> {
  const ctx = await getAppContext();
  if (!canManageMembers(ctx.role)) return { ctx, refused: "Only Owners and Admins change the workspace's policies." };
  if (!ctx.workspace.governanceEnabled) return { ctx, refused: "Governance is off. Turn it on in Settings to set policies." };
  return { ctx };
}

async function save(admin: AdminDb, ctx: AppContext, kind: Kind, config: unknown, change: string, details: Record<string, unknown>) {
  const { data: row } = await admin.from("policies").select("id").eq("workspace_id", ctx.workspace.id).eq("kind", kind).maybeSingle();
  if (row) await admin.from("policies").update({ config: config as Json }).eq("id", row.id);
  else await admin.from("policies").insert({ workspace_id: ctx.workspace.id, kind, config: config as Json });
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "policy.changed", target: change, details: { policy: kind, ...details, simulated: true } as Json });
  revalidatePath("/governance");
  revalidatePath("/", "layout");
}

/** C-1: where Architect and the apps run. v1 offers Lyzr Cloud and a VPC in the customer's AWS account. */
export async function saveLocation(input: LocationPolicy): Promise<ActionResult> {
  const { ctx, refused } = await guard();
  if (refused) return { ok: false, message: refused };
  const option = LOCATIONS.find((l) => l.mode === input.mode);
  if (!option) return { ok: false, message: "Pick one of the places shown." };
  if (!option.available) return { ok: false, message: LOCATION_LATER };
  const region = input.mode === "customer_vpc" ? input.region : null;
  if (input.mode === "customer_vpc" && !AWS_REGIONS.some((r) => r.id === region)) return { ok: false, message: "Pick an AWS region." };
  const admin = createAdminDb();
  const before = (await loadPolicies(admin, ctx.workspace.id)).stored.location;
  const next: LocationPolicy = { mode: input.mode, region };
  await save(admin, ctx, "location", { mode: next.mode, region, label: locationLabel(next) }, `Where it runs: ${locationLabel(next)}`, { before: locationLabel(before), after: locationLabel(next) });
  return { ok: true };
}

const modelInput = z.object({
  allowed: z.array(z.enum(MODEL_CHOICES)).max(MODEL_CHOICES.length),
  architect: z.enum(MODEL_CHOICES),
  agentDefault: z.enum(MODEL_CHOICES),
  ownKeys: z.array(z.enum(MODEL_CHOICES)).max(MODEL_CHOICES.length),
});

/** C-2: allowed models, Architect's model, the default for app agents, and which providers bill the org's own key. */
export async function saveModelPolicy(raw: z.input<typeof modelInput>): Promise<ActionResult> {
  const { ctx, refused } = await guard();
  if (refused) return { ok: false, message: refused };
  const parsed = modelInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Pick from the models shown." };
  const admin = createAdminDb();
  const before = (await loadPolicies(admin, ctx.workspace.id)).stored.models;
  const next: ModelPolicy = { ...parsed.data, allowed: [...new Set(parsed.data.allowed)], ownKeys: [...new Set(parsed.data.ownKeys)].filter((m) => m !== "private"), private: before.private };
  const problem = modelPolicyProblem(next);
  if (problem) return { ok: false, message: problem };
  await save(admin, ctx, "models", modelConfig(next), "Models", {
    before: { allowed: before.allowed, architect: before.architect, agent_default: before.agentDefault, own_keys: before.ownKeys },
    after: { allowed: next.allowed, architect: next.architect, agent_default: next.agentDefault, own_keys: next.ownKeys },
  });
  return { ok: true };
}

/** C-2: register the organisation's own or self-hosted model at a private endpoint. It's allowed once registered. */
export async function registerPrivateModel(input: { name: string; url: string; kind: "own" | "open_source" }): Promise<ActionResult> {
  const { ctx, refused } = await guard();
  if (refused) return { ok: false, message: refused };
  const problem = privateModelProblem(input);
  if (problem) return { ok: false, message: problem };
  const admin = createAdminDb();
  const before = (await loadPolicies(admin, ctx.workspace.id)).stored.models;
  const pm = { name: input.name.trim(), url: input.url.trim(), kind: input.kind === "own" ? ("own" as const) : ("open_source" as const) };
  const next: ModelPolicy = { ...before, private: pm, allowed: [...new Set([...before.allowed, "private" as const])] };
  await save(admin, ctx, "models", modelConfig(next), `Private model registered: ${pm.name}`, { endpoint: pm.url, kind: pm.kind });
  return { ok: true };
}

/** Remove the private model. Refused while it's Architect's model or the agents' default: pick another first. */
export async function removePrivateModel(): Promise<ActionResult> {
  const { ctx, refused } = await guard();
  if (refused) return { ok: false, message: refused };
  const admin = createAdminDb();
  const before = (await loadPolicies(admin, ctx.workspace.id)).stored.models;
  if (!before.private) return { ok: true };
  if (before.architect === "private" || before.agentDefault === "private") {
    return { ok: false, message: "It's Architect's model or the default for app agents. Pick another model for those first, and save." };
  }
  const next: ModelPolicy = { ...before, private: null, allowed: before.allowed.filter((m) => m !== "private") };
  await save(admin, ctx, "models", modelConfig(next), `Private model removed: ${before.private.name}`, {});
  return { ok: true };
}

const appInput = z.object({
  allow: z.array(z.string().min(1).max(60)).max(60),
  whoCanConnect: z.enum(["builders", "admins"]),
  scopes: z.record(z.string(), z.enum(["read", "read_write"])),
});

/** C-3: which apps any project may use, what each may do, and who connects them. */
export async function saveAppPolicy(raw: z.input<typeof appInput>): Promise<ActionResult> {
  const { ctx, refused } = await guard();
  if (refused) return { ok: false, message: refused };
  const parsed = appInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Those app settings aren't valid." };
  const admin = createAdminDb();
  const known = knownApps(await usedApps(admin, ctx.workspace.id));
  if (parsed.data.allow.some((a) => !known.includes(a))) return { ok: false, message: "Pick from the apps shown." };
  const before = (await loadPolicies(admin, ctx.workspace.id)).stored.apps;
  const next: AppPolicy = { ...before, allow: [...new Set(parsed.data.allow)], whoCanConnect: parsed.data.whoCanConnect, scopes: Object.fromEntries(Object.entries(parsed.data.scopes).filter(([k]) => parsed.data.allow.includes(k))) };
  await save(admin, ctx, "connectors", appConfig(next, known), "Apps", {
    before: { allow: before.allow, who_can_connect: before.whoCanConnect, scopes: before.scopes },
    after: { allow: next.allow, who_can_connect: next.whoCanConnect, scopes: next.scopes },
  });
  return { ok: true };
}

/** C-3: add or remove an MCP server app agents may use as a tool. */
export async function addMcpServer(input: { name: string; url: string }): Promise<ActionResult> {
  const { ctx, refused } = await guard();
  if (refused) return { ok: false, message: refused };
  const admin = createAdminDb();
  const before = (await loadPolicies(admin, ctx.workspace.id)).stored.apps;
  const m = { name: input.name.trim(), url: input.url.trim() };
  const problem = mcpProblem(m, before.mcp);
  if (problem) return { ok: false, message: problem };
  const known = knownApps(await usedApps(admin, ctx.workspace.id));
  await save(admin, ctx, "connectors", appConfig({ ...before, mcp: [...before.mcp, m] }, known), `MCP server allowed: ${m.name}`, { url: m.url });
  return { ok: true };
}

export async function removeMcpServer(input: { name: string }): Promise<ActionResult> {
  const { ctx, refused } = await guard();
  if (refused) return { ok: false, message: refused };
  const admin = createAdminDb();
  const before = (await loadPolicies(admin, ctx.workspace.id)).stored.apps;
  if (!before.mcp.some((m) => m.name === input.name)) return { ok: true };
  const known = knownApps(await usedApps(admin, ctx.workspace.id));
  await save(admin, ctx, "connectors", appConfig({ ...before, mcp: before.mcp.filter((m) => m.name !== input.name) }, known), `MCP server removed: ${input.name}`, {});
  return { ok: true };
}

const egressInput = z.object({
  hosts: z.array(z.string().max(253)).max(50),
  redact: z.array(z.enum(REDACTIONS.map((r) => r.id) as [Redaction, ...Redaction[]])).max(REDACTIONS.length),
});

/** C-4: the hosts data may go to, and the personal data taken out before anything goes to a model. */
export async function saveEgress(raw: z.input<typeof egressInput>): Promise<ActionResult> {
  const { ctx, refused } = await guard();
  if (refused) return { ok: false, message: refused };
  const parsed = egressInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Those settings aren't valid." };
  const hosts: string[] = [];
  for (const h of parsed.data.hosts) {
    const problem = hostProblem(h, hosts);
    if (problem) return { ok: false, message: problem };
    hosts.push(h.trim().toLowerCase());
  }
  const admin = createAdminDb();
  const before = (await loadPolicies(admin, ctx.workspace.id)).stored.egress;
  const next = { hosts, redact: [...new Set(parsed.data.redact)] };
  await save(admin, ctx, "egress", egressConfig(next), "Data and egress", { before, after: next });
  revalidatePath("/p", "layout");
  return { ok: true };
}

/** Launch's inline fix for an admin: add the one host a project's data would go to. */
export async function allowHost(input: { host: string; projectId?: string }): Promise<ActionResult> {
  const { ctx, refused } = await guard();
  if (refused) return { ok: false, message: refused };
  const admin = createAdminDb();
  const before = (await loadPolicies(admin, ctx.workspace.id)).stored.egress;
  const host = input.host.trim().toLowerCase();
  if (before.hosts.includes(host)) return { ok: true };
  const problem = hostProblem(host, before.hosts);
  if (problem) return { ok: false, message: problem };
  await save(admin, ctx, "egress", egressConfig({ ...before, hosts: [...before.hosts, host] }), `Host allowed: ${host}`, { from_project: input.projectId ?? null });
  if (input.projectId && z.string().uuid().safeParse(input.projectId).success) {
    revalidatePath(`/p/${input.projectId}/launch`);
    revalidatePath(`/p/${input.projectId}`);
  }
  return { ok: true };
}

/** C-10: which actions leaving the sandbox need an Owner or Admin when a Builder (or their coding agent) does them. */
export async function savePermissionRules(input: { deploy: boolean; push: boolean; secrets: boolean }): Promise<ActionResult> {
  const { ctx, refused } = await guard();
  if (refused) return { ok: false, message: refused };
  const next = { deploy: Boolean(input.deploy), push: Boolean(input.push), secrets: Boolean(input.secrets) };
  const admin = createAdminDb();
  const before = (await loadPolicies(admin, ctx.workspace.id)).stored.permissions;
  const words = (p: typeof next) => PERMISSIONS.filter((x) => p[x.id]).map((x) => x.label).join(", ") || "none";
  await save(admin, ctx, "permission", permissionConfig(next), `Needs approval: ${words(next)}`, { before: words(before), after: words(next) });
  revalidatePath("/p", "layout");
  return { ok: true };
}

const budgetInput = z.object({
  monthlyCap: z.number().int().nullable(),
  projects: z.array(z.object({ id: z.string().uuid(), cap: z.number().int().min(1).max(100_000).nullable() })).max(200),
});

/** C-7: the organisation's monthly cap and each project's cap. Alerts at 80%; paid actions stop at 100%. */
export async function saveBudgets(raw: z.input<typeof budgetInput>): Promise<ActionResult> {
  const { ctx, refused } = await guard();
  if (refused) return { ok: false, message: refused };
  const parsed = budgetInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Project caps are whole numbers from 1 to 100,000 credits, or none." };
  const problem = capProblem(parsed.data.monthlyCap);
  if (problem) return { ok: false, message: problem };
  const admin = createAdminDb();
  const before = (await loadPolicies(admin, ctx.workspace.id)).stored.budget;
  const { data: projects } = await admin.from("projects").select("id, name, budget_credits").eq("workspace_id", ctx.workspace.id);
  const changed: string[] = [];
  for (const p of parsed.data.projects) {
    const row = (projects ?? []).find((x) => x.id === p.id);
    if (!row) return { ok: false, message: "That project isn't in this workspace." };
    if ((row.budget_credits === null ? null : Number(row.budget_credits)) === p.cap) continue;
    await admin.from("projects").update({ budget_credits: p.cap }).eq("id", p.id);
    changed.push(`${row.name}: ${p.cap ?? "no cap"}`);
  }
  if (before.monthlyCap !== parsed.data.monthlyCap || !changed.length) {
    await save(admin, ctx, "budget", { monthly_cap: parsed.data.monthlyCap }, `Monthly cap: ${parsed.data.monthlyCap === null ? "none" : `${parsed.data.monthlyCap} credits`}`, { before: before.monthlyCap, after: parsed.data.monthlyCap, projects: changed });
  } else {
    await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "policy.changed", target: "Project caps", details: { policy: "budget", projects: changed, simulated: true } });
    revalidatePath("/governance");
  }
  revalidatePath("/p", "layout");
  return { ok: true };
}

/** At 100% of the cap, anyone who can build asks to raise it: an approval request (C-5, C-7). */
export async function requestCapRaise(input: { cap: number; why?: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't ask for a higher cap." };
  if (!ctx.workspace.governanceEnabled) return { ok: false, message: "Governance is off, so there's no cap to raise." };
  const admin = createAdminDb();
  const { budget } = await loadPolicies(admin, ctx.workspace.id);
  const cap = Math.round(Number(input.cap));
  if (!budget.monthlyCap) return { ok: false, message: "There's no monthly cap to raise." };
  if (!Number.isFinite(cap) || cap <= budget.monthlyCap) return { ok: false, message: `Ask for more than the cap now (${budget.monthlyCap.toLocaleString("en-GB")} credits).` };
  const problem = capProblem(cap);
  if (problem) return { ok: false, message: problem };
  const { data: waiting } = await admin.from("approvals").select("id").eq("workspace_id", ctx.workspace.id).eq("kind", "budget").eq("status", "waiting").limit(1);
  if (waiting?.length) return { ok: false, message: "A request to raise the cap is already waiting for an Owner or Admin." };
  const why = (input.why ?? "").trim().slice(0, 300);
  await admin.from("approvals").insert({
    workspace_id: ctx.workspace.id,
    kind: "budget",
    status: "waiting",
    title: `Raise the monthly cap to ${cap} credits`,
    requested_by: ctx.user.id,
    payload: { cap, current: budget.monthlyCap, why, requested_by_name: ctx.name },
  });
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "budget.raise_requested", target: `${cap} credits a month`, details: { current: budget.monthlyCap, simulated: true } });
  revalidatePath("/", "layout");
  return { ok: true };
}
