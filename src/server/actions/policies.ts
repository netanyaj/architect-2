"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Json } from "@/lib/database.types";
import { egressConfig, hostProblem, REDACTIONS, type Redaction } from "@/lib/egress";
import { MODEL_CHOICES } from "@/lib/models";
import { canManageMembers } from "@/lib/permissions";
import {
  appConfig,
  AWS_REGIONS,
  knownApps,
  LOCATION_LATER,
  LOCATIONS,
  locationLabel,
  mcpProblem,
  modelConfig,
  modelPolicyProblem,
  privateModelProblem,
  type AppPolicy,
  type LocationPolicy,
  type ModelPolicy,
} from "@/lib/policies";
import { createAdminDb, type AdminDb } from "../db";
import { loadPolicies } from "../policy";
import { getAppContext, type AppContext } from "../workspace";
import type { ActionResult } from "./members";

/* Governance › Where it runs, Models, Apps and MCP servers (C-1 to C-3). Owners and Admins change them while
   governance is on; every change is audited with what it was and what it became. Enforcement is simulated. */

type Kind = "location" | "models" | "connectors" | "egress";

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

async function usedApps(admin: AdminDb, workspaceId: string): Promise<string[]> {
  const { data } = await admin.from("items").select("provider, projects!inner(workspace_id)").eq("projects.workspace_id", workspaceId).not("provider", "is", null);
  return (data ?? []).map((i) => i.provider as string);
}

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
