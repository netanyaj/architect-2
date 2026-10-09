import "server-only";

import type { Role } from "@/lib/db";
import type { Deployment, LaunchSettings } from "@/lib/launch";
import type { PullRequestView } from "@/lib/pull-requests";
import type { RunEvent, RunInfo } from "@/lib/sim/replay";
import { modelAvailability } from "@/lib/gateway";
import { MODEL_LABEL, toModelChoice, type ModelChoice, type ModelOption } from "@/lib/models";
import { detectTools, projectIcon, summarizeProject, type ProjectInput } from "@/lib/project-status";
import { allowedModels } from "./blueprint/write-plan";
import { createAdminDb, createServerDb } from "./db";
import { loadPullRequests } from "./pull-requests";
import { catchUpRuns, dbNow } from "./sim/run";
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
  /** "default" (Next.js + Python with the Lyzr SDK) or the stack kept from an imported repo (B-8). */
  stack: string;
  /** The GitHub repo a project was imported from. */
  repo: string | null;
  /** A repo project's pull requests, newest first (Simulated, B-4). Empty for other projects. */
  pullRequests: PullRequestView[];
  /** The workspace's governance setting: on, a Builder's push to main or Go live asks an Owner or Admin. */
  governance: boolean;
  /** The Data tab (screen 13): which versions exist, how the app's users sign in, and the domain they're at. */
  data: { envs: { staging: boolean; production: boolean }; signIn: "google" | "email" | "sso"; domain: string };
  /** Hand-off (F8): who may hand the project over, to whom, and any offer or new ownership to show. */
  handoff: Handoff;
  /** Coding agent tokens (F4): active ones let ?sim=byoagent play. */
  tokens: { active: number; waiting: number };
  ownerName: string;
  updatedAt: string;
  budgetCredits: number | null;
  /** The latest version of the plan (what the workspace shows), or null before the first plan. */
  plan: PlanDetails | null;
  items: WorkspaceItem[];
  versions: PlanVersion[];
  runStatus: string | null;
  /** The latest run with its events, replayed on the clock in the browser (SIMULATOR step 2). */
  run: RunInfo | null;
  /** Credits this project has spent (Usage). */
  spent: { total: number; build: number; fix: number };
  /** The database's time when the page was read: the clock runs replay against. */
  serverNow: string;
  /** Services this workspace has connected, and those its policy denies. */
  connected: string[];
  denied: string[];
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
  /** Launch (screen 4): loaded only on the Launch page. */
  launch: LaunchData | null;
};

export type Handoff = {
  canTransfer: boolean;
  /** Members it can go to (not Viewers, not its owner). Invited ones accept with their invite link. */
  candidates: { id: string; name: string; role: Role; invited: boolean }[];
  /** An open offer for this project. */
  outgoing: { id: string; toName: string; invited: boolean; createdAt: string; fromMe: boolean } | null;
  /** An open offer to the person looking. */
  offer: { id: string; fromName: string; note: string | null } | null;
  /** The person looking just became the owner and hasn't dismissed the banner. */
  received: { id: string; fromName: string; note: string | null } | null;
};

export type LaunchData = {
  /** The workspace's governance setting: off is the fast path (Test → Go live). */
  governance: boolean;
  settings: LaunchSettings;
  /** The view-only test link's token, when it's shared. */
  testShareToken: string | null;
  /** The domain of the person's email, for "Signed-in people at your domain". */
  domain: string;
  /** What each plan version changed, for the go-back confirmation. */
  versionNotes: Record<number, string>;
  deployments: Deployment[];
  envLive: { staging: boolean; production: boolean };
  liveRequested: boolean;
  testsPassed: number;
};

async function loadLaunch(
  db: Awaited<ReturnType<typeof createServerDb>>,
  projectId: string,
  workspaceId: string,
  names: Map<string, string>,
  extra: { governance: boolean; settings: LaunchSettings; testShareToken: string | null; domain: string },
): Promise<LaunchData> {
  const [{ data: deps }, { data: envs }, { data: approvals }, { data: proofs }, { data: changes }] = await Promise.all([
    db.from("deployments").select("id, environment, blueprint_version, status, created_at, created_by, checks").eq("project_id", projectId).order("created_at", { ascending: false }),
    db.from("environments").select("name, status").eq("project_id", projectId),
    db.from("approvals").select("id").eq("workspace_id", workspaceId).eq("project_id", projectId).eq("kind", "deploy").eq("status", "waiting"),
    db.from("proofs").select("assertions_passed, items!inner(project_id)").eq("items.project_id", projectId).eq("result", "pass"),
    db.from("change_proposals").select("version_created, diff").eq("project_id", projectId).eq("status", "applied"),
  ]);
  const versionNotes: Record<number, string> = {};
  for (const c of changes ?? []) {
    if (!c.version_created) continue;
    const d = (c.diff ?? {}) as { add?: { title: string }[]; change?: { key: string; title?: string }[]; remove?: { key: string }[] };
    versionNotes[c.version_created] = [
      ...(d.add ?? []).map((a) => `added ${a.title}`),
      ...(d.change ?? []).map((x) => `changed ${x.title ?? x.key.replace(/-/g, " ")}`),
      ...(d.remove ?? []).map((r) => `removed ${r.key.replace(/-/g, " ")}`),
    ].join(", ");
  }
  const env = (n: string) => (envs ?? []).some((e) => e.name === n && e.status === "live");
  return {
    ...extra,
    versionNotes,
    deployments: (deps ?? [])
      .filter((d) => d.environment === "staging" || d.environment === "production")
      .map((d) => ({
        id: d.id,
        environment: d.environment as Deployment["environment"],
        version: d.blueprint_version,
        status: d.status,
        createdAt: d.created_at,
        by: d.created_by ? (names.get(d.created_by) ?? "someone") : null,
        failure: d.status === "failed" ? ((d.checks as { failure?: Deployment["failure"] } | null)?.failure ?? null) : null,
      })),
    envLive: { staging: env("staging"), production: env("production") },
    liveRequested: (approvals ?? []).length > 0,
    testsPassed: (proofs ?? []).reduce((s, p) => s + Number(p.assertions_passed ?? 0), 0),
  };
}

/** The models a person may pick in this workspace: allowed by policy, marked simulated when there's no key. */
export async function modelOptionsFor(workspaceId: string): Promise<ModelOption[]> {
  const allowed = await allowedModels(createAdminDb(), workspaceId);
  return modelAvailability().filter((m) => allowed.includes(m.choice));
}

/** One project for its workspace screen, read under RLS (so only members see it). Null when it doesn't exist. */
export async function getProjectWorkspace(id: string, ctx: AppContext, creditsLeft: number, opts: { catchUp?: boolean; launch?: boolean } = {}): Promise<ProjectWorkspace | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = await createServerDb();
  const { data: p } = await db
    .from("projects")
    .select(
      "id, workspace_id, name, icon, status, prompt, model, stack, repo_full_name, owner_id, owner_display_name, updated_at, budget_credits, launch_settings, test_share_token, blueprints(id, version, status, generation, created_at, total_likely), runs(id, kind, status, variant, started_at, ends_at)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!p) return null;
  // A run left queued, or one whose time is up, is started or settled now (SIMULATOR step 3), then read again.
  if (opts.catchUp && (p.runs ?? []).some((r) => r.status === "queued" || (r.status === "running" && r.ends_at && new Date(r.ends_at).getTime() <= Date.now()))) {
    await catchUpRuns(createAdminDb(), p.id);
    return getProjectWorkspace(id, ctx, creditsLeft, { launch: opts.launch });
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

  const latestRun = [...(p.runs ?? [])].filter((r) => r.started_at).sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""))[0];
  const [{ data: events }, { data: usage }, { data: conns }, { data: connectorPolicy }] = await Promise.all([
    latestRun
      ? db.from("events").select("id, type, payload, actor_label").eq("run_id", latestRun.id).order("id").limit(2000)
      : Promise.resolve({ data: [] as { id: number; type: string; payload: unknown; actor_label: string | null }[] }),
    db.from("usage_ledger").select("kind, credits").eq("project_id", p.id),
    db.from("connections").select("provider, status").eq("workspace_id", p.workspace_id),
    db.from("policies").select("config").eq("workspace_id", p.workspace_id).eq("kind", "connectors").maybeSingle(),
  ]);
  const runEvents: RunEvent[] = (events ?? []).map((e) => {
    const payload = (e.payload ?? {}) as Record<string, unknown>;
    return { id: Number(e.id), type: e.type, itemKey: (payload.item_key as string) ?? null, atMs: Number(payload.at_ms ?? 0), actorLabel: e.actor_label, payload };
  });
  const credits = (kinds: string[]) => (usage ?? []).filter((u) => kinds.includes(u.kind)).reduce((s, u) => s + Number(u.credits), 0);

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
  let launch: LaunchData | null = null;
  const peopleNames = async () => {
    const { data: people } = await db.from("members").select("user_id, display_name").eq("workspace_id", p.workspace_id);
    return new Map((people ?? []).filter((m) => m.user_id).map((m) => [m.user_id!, m.user_id === ctx.user.id ? "you" : (m.display_name?.split(" ")[0] ?? "someone")]));
  };
  // The read above, under the person's own access, proved they can see this project.
  const pullRequests = p.repo_full_name ? await loadPullRequests(createAdminDb(), p.id, await peopleNames()) : [];
  const { data: tokenRows } = await db.from("project_tokens").select("status").eq("project_id", p.id).neq("status", "revoked");
  const [{ data: memberRows }, { data: transfers }] = await Promise.all([
    db.from("members").select("id, user_id, role, status, display_name, email, invited_email").eq("workspace_id", p.workspace_id),
    db.from("ownership_transfers").select("id, from_user, from_name, to_member, to_user, to_name, note, status, seen_at, accepted_at, created_at").eq("project_id", p.id).in("status", ["pending", "accepted"]).order("created_at", { ascending: false }),
  ]);
  const myMember = (memberRows ?? []).find((m) => m.user_id === ctx.user.id);
  const { data: envRows } = await db.from("environments").select("name, status").eq("project_id", p.id);
  const envLive = (n: string) => (envRows ?? []).some((e) => e.name === n && e.status === "live");
  const pending = (transfers ?? []).find((t) => t.status === "pending");
  const received = (transfers ?? []).find((t) => t.status === "accepted" && t.to_user === ctx.user.id && !t.seen_at && p.owner_id === ctx.user.id);
  const pendingTo = pending ? (memberRows ?? []).find((m) => m.id === pending.to_member) : undefined;
  const handoff: Handoff = {
    canTransfer: (p.owner_id === ctx.user.id || membership?.role === "owner" || membership?.role === "admin") && (membership?.role ?? "viewer") !== "viewer",
    candidates: (memberRows ?? [])
      .filter((m) => m.role !== "viewer" && !(m.user_id && m.user_id === p.owner_id && !p.owner_display_name))
      .map((m) => ({ id: m.id, name: m.display_name ?? m.email ?? m.invited_email ?? "Someone", role: m.role as Role, invited: m.status === "invited" })),
    outgoing: pending ? { id: pending.id, toName: pending.to_name, invited: pendingTo?.status === "invited", createdAt: pending.created_at, fromMe: pending.from_user === ctx.user.id } : null,
    offer: pending && myMember && pending.to_member === myMember.id ? { id: pending.id, fromName: pending.from_name, note: pending.note } : null,
    received: received ? { id: received.id, fromName: received.from_name, note: received.note } : null,
  };
  if (opts.launch) {
    const names = await peopleNames();
    launch = await loadLaunch(db, p.id, p.workspace_id, names, {
      governance: p.workspace_id === ctx.workspace.id ? ctx.workspace.governanceEnabled : true,
      settings: (p.launch_settings ?? {}) as LaunchSettings,
      testShareToken: p.test_share_token,
      domain: ctx.user.email?.split("@")[1] ?? "your company",
    });
  }

  return {
    id: p.id,
    name: p.name,
    icon: projectIcon(p.icon),
    status: p.status as ProjectInput["status"],
    prompt: p.prompt,
    stack: p.stack,
    repo: p.repo_full_name,
    pullRequests,
    data: {
      envs: { staging: envLive("staging"), production: envLive("production") || p.status === "live" },
      signIn: ((p.launch_settings ?? {}) as LaunchSettings).signIn ?? "google",
      domain: ctx.user.email?.split("@")[1] ?? "acme.com",
    },
    handoff,
    tokens: { active: (tokenRows ?? []).filter((t) => t.status === "active").length, waiting: (tokenRows ?? []).filter((t) => t.status === "waiting").length },
    governance: p.workspace_id === ctx.workspace.id ? ctx.workspace.governanceEnabled : true,
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
    run: latestRun
      ? { id: latestRun.id, kind: latestRun.kind, status: latestRun.status, variant: latestRun.variant, startedAt: latestRun.started_at, endsAt: latestRun.ends_at, events: runEvents }
      : null,
    spent: { total: credits(["build", "fix", "change", "blueprint", "running"]), build: credits(["build", "change"]), fix: credits(["fix"]) },
    serverNow: await dbNow(createAdminDb()),
    connected: (conns ?? []).filter((c) => c.status === "connected").map((c) => c.provider),
    denied: ((connectorPolicy?.config as { deny?: string[] } | null)?.deny ?? []).map(String),
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
    launch,
    uploads: (files ?? []).map((f) => ({
      id: f.id,
      name: f.name ?? f.path,
      mime: f.mime,
      size: f.size_bytes,
      read: Boolean(f.extracted_text) || Boolean(f.mime?.startsWith("image/")),
    })),
  };
}
