import "server-only";

import type { Role } from "@/lib/db";
import { modelAvailability } from "@/lib/gateway";
import { MODEL_LABEL, toModelChoice, type ModelChoice, type ModelOption } from "@/lib/models";
import { detectTools, projectIcon, summarizeProject, type ProjectInput } from "@/lib/project-status";
import { allowedModels } from "./blueprint/write-plan";
import { createAdminDb, createServerDb } from "./db";
import { catchUpRuns } from "./sim/run";
import type { AppContext } from "./workspace";

export type WorkspaceItem = {
  id: string;
  key: string;
  title: string;
  description: string | null;
  provedWhen: string;
  sourceQuote: string | null;
  grp: string;
  status: string;
  statusDetail: string | null;
  dropReason: string | null;
  /** Likely credits (kept as a number for the older summaries). */
  estimate: number | null;
  range: { low: number; high: number } | null;
  driver: string | null;
  provider: string | null;
  position: number;
  edited: boolean;
};

export type PlanQuestion = {
  id: string;
  text: string;
  affects: string[];
  options: { label: string; value: string }[];
  recommended: string;
  answer: string | null;
  blocking: boolean;
  /** What the recommended answer does to what was asked for (the model's label; the server set blocking from it). */
  defaultEffect: "keep" | "reduce" | "remove" | "none";
};

export type PlanDefault = { id: string; label: string; value: string; alternatives: string[] };

export type PlanDetails = {
  id: string;
  version: number;
  status: "draft" | "agreed" | "superseded";
  generation: "writing" | "ready" | "failed";
  errorKind: "rate_limited" | "slow" | "invalid" | "unavailable" | null;
  name: string | null;
  summary: string | null;
  prompt: string;
  totals: { low: number | null; likely: number | null; high: number | null; minutes: number | null };
  model: ModelChoice;
  modelLabel: string;
  simulatedModel: boolean;
  notInThisVersion: { title: string; reason: string }[];
  questions: PlanQuestion[];
  defaults: PlanDefault[];
  agreedAt: string | null;
  basedOn: number | null;
};

export type ChatMessage = { id: string; role: "user" | "architect" | "system"; mode: "build" | "plan"; content: string; createdAt: string };

export type ChangeCardData = {
  id: string;
  messageId: string | null;
  status: "proposed" | "applied" | "discarded";
  reply: string | null;
  credits: number;
  minutes: number;
  add: { key: string; title: string }[];
  change: { key: string; title: string; fields: string[]; kind: "modify" | "weaken" }[];
  remove: { key: string; title: string; reason: string }[];
  /** Parts this change removes or weakens: each needs Keep / Defer / Drop before Apply (A-3). */
  conflicts: { key: string; title: string; kind: "remove" | "weaken"; reason: string; before?: string; after?: string }[];
  versionCreated: number | null;
  baseVersion: number | null;
};

export type PlanVersion = { id: string; version: number; status: string; generation: string; createdAt: string; totalLikely: number | null };

export type ProjectWorkspace = {
  id: string;
  name: string;
  icon: ReturnType<typeof projectIcon>;
  status: ProjectInput["status"];
  prompt: string | null;
  ownerName: string;
  updatedAt: string;
  budgetCredits: number | null;
  /** The latest version of the plan (what the workspace shows), or null before the first plan. */
  plan: PlanDetails | null;
  items: WorkspaceItem[];
  versions: PlanVersion[];
  runStatus: string | null;
  tools: string[];
  summary: ReturnType<typeof summarizeProject>;
  /** The person's role in the project's workspace. */
  role: Role;
  /** Set when the project lives in another workspace the person belongs to (they need to switch first). */
  otherWorkspace: { id: string; label: string } | null;
  creditsLeft: number;
  model: ModelChoice;
  /** The models this workspace allows, and whether each is real here (BL-3). */
  models: ModelOption[];
  messages: ChatMessage[];
  changes: ChangeCardData[];
  uploads: { id: string; name: string; mime: string | null; size: number | null; read: boolean }[];
};

/** The models a person may pick in this workspace: allowed by policy, marked simulated when there's no key. */
export async function modelOptionsFor(workspaceId: string): Promise<ModelOption[]> {
  const allowed = await allowedModels(createAdminDb(), workspaceId);
  return modelAvailability().filter((m) => allowed.includes(m.choice));
}

/** One project for its workspace screen, read under RLS (so only members see it). Null when it doesn't exist. */
export async function getProjectWorkspace(id: string, ctx: AppContext, creditsLeft: number, opts: { catchUp?: boolean } = {}): Promise<ProjectWorkspace | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = await createServerDb();
  const { data: p } = await db
    .from("projects")
    .select(
      "id, workspace_id, name, icon, status, prompt, model, owner_id, owner_display_name, updated_at, budget_credits, blueprints(id, version, status, generation, created_at, total_likely), runs(status, started_at, ends_at)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!p) return null;
  // A run left queued, or one whose time is up, is started or settled now (SIMULATOR step 3), then read again.
  if (opts.catchUp && (p.runs ?? []).some((r) => r.status === "queued" || (r.status === "running" && r.ends_at && new Date(r.ends_at).getTime() <= Date.now()))) {
    await catchUpRuns(createAdminDb(), p.id);
    return getProjectWorkspace(id, ctx, creditsLeft);
  }

  const versions: PlanVersion[] = [...(p.blueprints ?? [])]
    .sort((a, b) => b.version - a.version)
    .map((b) => ({ id: b.id, version: b.version, status: b.status, generation: b.generation, createdAt: b.created_at, totalLikely: b.total_likely === null ? null : Number(b.total_likely) }));
  const latestId = versions[0]?.id;

  const [{ data: bp }, { data: items }, { data: questions }, { data: defaults }] = latestId
    ? await Promise.all([
        db
          .from("blueprints")
          .select("id, version, status, generation, error_kind, name, summary, prompt, total_low, total_likely, total_high, est_minutes, model, simulated_model, not_in_this_version, agreed_at, based_on")
          .eq("id", latestId)
          .single(),
        db
          .from("items")
          .select("id, key, title, description, proved_when, source_quote, grp, status, status_detail, drop_reason, estimate_low, estimate_likely, estimate_high, cost_driver, provider, position, edited_at")
          .eq("blueprint_id", latestId)
          .order("position"),
        db.from("questions").select("id, text, affects, options, recommended, answer, blocking, default_effect, position").eq("blueprint_id", latestId).order("position"),
        db.from("defaults").select("id, label, value, alternatives, position").eq("blueprint_id", latestId).order("position"),
      ])
    : [{ data: null }, { data: [] }, { data: [] }, { data: [] }];

  const [{ data: msgs }, { data: props }, { data: files }] = await Promise.all([
    db.from("messages").select("id, role, mode, content, created_at").eq("project_id", p.id).order("created_at").limit(200),
    db.from("change_proposals").select("id, message_id, diff, reply, estimate_likely, est_minutes, conflict, status, version_created").eq("project_id", p.id).order("created_at"),
    db.from("files").select("id, name, path, mime, size_bytes, extracted_text").eq("project_id", p.id).eq("kind", "upload").order("created_at"),
  ]);
  const titleOf = (key: string) => (items ?? []).find((i) => i.key === key)?.title ?? key.replace(/-/g, " ");
  const changes: ChangeCardData[] = (props ?? []).map((c) => {
    const d = (c.diff ?? {}) as {
      add?: { key: string; title: string }[];
      change?: { key: string; kind?: "modify" | "weaken"; title?: string; description?: string; proved_when?: string }[];
      remove?: { key: string; reason: string }[];
      base_version?: number;
    };
    const conflict = (c.conflict ?? null) as { items?: ChangeCardData["conflicts"] } | null;
    return {
      id: c.id,
      messageId: c.message_id,
      status: c.status as ChangeCardData["status"],
      reply: c.reply,
      credits: Math.round(Number(c.estimate_likely ?? 0)),
      minutes: c.est_minutes ?? 0,
      add: (d.add ?? []).map((a) => ({ key: a.key, title: a.title })),
      change: (d.change ?? []).map((x) => ({
        key: x.key,
        title: x.title ?? titleOf(x.key),
        fields: [x.title && "name", x.description && "what it does", x.proved_when && "its check"].filter(Boolean) as string[],
        kind: x.kind ?? "modify",
      })),
      remove: (d.remove ?? []).map((r) => ({ key: r.key, title: titleOf(r.key), reason: r.reason })),
      // Older cards stored removals only (no kind); treat them as removals.
      conflicts: (conflict?.items ?? []).map((i) => ({ ...i, kind: i.kind ?? "remove" })),
      versionCreated: c.version_created,
      baseVersion: d.base_version ?? null,
    };
  });

  let ownerName = p.owner_display_name;
  if (!ownerName) {
    if (p.owner_id === ctx.user.id) ownerName = "you";
    else {
      const { data: owner } = await db.from("members").select("display_name").eq("workspace_id", p.workspace_id).eq("user_id", p.owner_id ?? "").maybeSingle();
      ownerName = owner?.display_name?.split(" ")[0] ?? "someone";
    }
  }

  const membership = ctx.memberships.find((m) => m.workspaceId === p.workspace_id);
  const run = [...(p.runs ?? [])].sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""))[0];
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const list: WorkspaceItem[] = (items ?? []).map((i) => ({
    id: i.id,
    key: i.key,
    title: i.title,
    description: i.description,
    provedWhen: i.proved_when,
    sourceQuote: i.source_quote,
    grp: i.grp,
    status: i.status,
    statusDetail: i.status_detail,
    dropReason: i.drop_reason,
    estimate: num(i.estimate_likely),
    range: i.estimate_low === null || i.estimate_high === null ? null : { low: Number(i.estimate_low), high: Number(i.estimate_high) },
    driver: i.cost_driver,
    provider: i.provider,
    position: i.position,
    edited: Boolean(i.edited_at),
  }));
  const projectModel = toModelChoice(p.model);

  return {
    id: p.id,
    name: p.name,
    icon: projectIcon(p.icon),
    status: p.status as ProjectInput["status"],
    prompt: p.prompt,
    ownerName,
    updatedAt: p.updated_at,
    budgetCredits: num(p.budget_credits),
    plan: bp
      ? {
          id: bp.id,
          version: bp.version,
          status: bp.status as PlanDetails["status"],
          generation: bp.generation as PlanDetails["generation"],
          errorKind: (bp.error_kind as PlanDetails["errorKind"]) ?? null,
          name: bp.name,
          summary: bp.summary,
          prompt: bp.prompt,
          totals: { low: num(bp.total_low), likely: num(bp.total_likely), high: num(bp.total_high), minutes: bp.est_minutes },
          model: toModelChoice(bp.model),
          modelLabel: MODEL_LABEL[toModelChoice(bp.model)],
          simulatedModel: bp.simulated_model,
          notInThisVersion: (bp.not_in_this_version as PlanDetails["notInThisVersion"]) ?? [],
          questions: (questions ?? []).map((q) => ({
            id: q.id,
            text: q.text,
            affects: q.affects,
            options: q.options as PlanQuestion["options"],
            recommended: q.recommended,
            answer: q.answer,
            blocking: q.blocking,
            defaultEffect: q.default_effect as PlanQuestion["defaultEffect"],
          })),
          defaults: (defaults ?? []).map((d) => ({ id: d.id, label: d.label, value: d.value, alternatives: (d.alternatives as string[]) ?? [] })),
          agreedAt: bp.agreed_at,
          basedOn: bp.based_on,
        }
      : null,
    items: list,
    versions,
    runStatus: run?.status ?? null,
    tools: detectTools([p.prompt, ...list.map((i) => i.title)]),
    summary: summarizeProject({
      status: p.status as ProjectInput["status"],
      budgetCredits: num(p.budget_credits),
      items: list,
      runStatus: run?.status,
    }),
    role: membership?.role ?? "viewer",
    otherWorkspace: p.workspace_id === ctx.workspace.id || !membership ? null : { id: membership.workspaceId, label: membership.label },
    creditsLeft,
    model: projectModel,
    models: await modelOptionsFor(p.workspace_id),
    messages: (msgs ?? []).map((m) => ({ id: m.id, role: m.role as ChatMessage["role"], mode: m.mode as ChatMessage["mode"], content: m.content, createdAt: m.created_at })),
    changes,
    uploads: (files ?? []).map((f) => ({
      id: f.id,
      name: f.name ?? f.path,
      mime: f.mime,
      size: f.size_bytes,
      read: Boolean(f.extracted_text) || Boolean(f.mime?.startsWith("image/")),
    })),
  };
}
