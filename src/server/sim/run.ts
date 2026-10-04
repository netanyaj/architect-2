import "server-only";

import type { Json } from "@/lib/database.types";
import { buildTimeline, SCENARIO, type SimItem, type Variant } from "@/lib/sim/timeline";
import type { AdminDb } from "../db";

/** `?sim=` on the workspace URL: a demo variant and/or a faster pace (docs/SIMULATOR.md). */
export type SimOptions = { variant: Variant; speed: number };

export function parseSim(raw: string | null | undefined): SimOptions {
  const parts = new Set((raw ?? "").toLowerCase().split(/[,\s]+/).filter(Boolean));
  const variant: Variant = parts.has("paused") ? "paused" : parts.has("budget") ? "budget" : "default";
  return { variant, speed: parts.has("fast") ? 0.25 : 1 };
}

const EVENT_CHUNK = 500;
const ACTOR_LABEL = { architect_agent: "Architect agent", verifier: "Verifier", system: null } as const;

/**
 * Starts a queued run (SIMULATOR step 1): claims it (only one caller can), computes the whole timeline from the
 * plan's real parts, writes each part's check (dated before its code), inserts every event with its offset, and
 * records when the run ends and how it settles. Nothing long-running happens on the server.
 * Returns false if the run was already started or isn't queued.
 */
export async function startRun(admin: AdminDb, runId: string, sim: SimOptions = { variant: "default", speed: 1 }): Promise<boolean> {
  // Claimed and stamped by the database (only one caller wins); its clock is the run's clock.
  const { data: started } = await admin.rpc("begin_run", { p_run: runId, p_variant: sim.variant, p_speed: sim.speed, p_scenario: SCENARIO.id });
  if (!started) return false;
  const startedAt = new Date(started);
  const { data: run } = await admin.from("runs").select("id, project_id, blueprint_id, kind, outcome").eq("id", runId).maybeSingle();
  if (!run?.blueprint_id) return false;

  try {
    const { data: project } = await admin.from("projects").select("workspace_id, budget_credits").eq("id", run.project_id).single();
    if (!project) throw new Error("project missing");
    const [{ data: items }, { data: connections }, { data: policy }, { data: usage }] = await Promise.all([
      admin
        .from("items")
        .select("id, key, grp, title, description, proved_when, item_class, size, provider, estimate_likely, position, status, fix_attempts")
        .eq("blueprint_id", run.blueprint_id),
      admin.from("connections").select("provider").eq("workspace_id", project.workspace_id).eq("status", "connected"),
      admin.from("policies").select("config").eq("workspace_id", project.workspace_id).eq("kind", "connectors").maybeSingle(),
      admin.from("usage_ledger").select("credits").eq("project_id", run.project_id),
    ]);
    const ids = new Map((items ?? []).map((i) => [i.key, i.id]));
    const denied = ((policy?.config as { deny?: string[] } | null)?.deny ?? []).map(String);

    // A follow-up run (Raise budget and continue, Try once more) says which parts it's for.
    const focusKeys = ((run.outcome as { focus?: string[] | null } | null)?.focus ?? null) as string[] | null;
    const retry = run.kind === "fix" && Boolean(focusKeys?.length);
    const fromAttempt = retry ? Math.max(0, ...(items ?? []).filter((i) => focusKeys!.includes(i.key)).map((i) => i.fix_attempts)) : undefined;
    const t = buildTimeline({
      runId: run.id,
      items: (items ?? []) as SimItem[],
      connected: (connections ?? []).map((c) => c.provider),
      denied,
      budget: { limit: project.budget_credits === null ? null : Number(project.budget_credits), spent: (usage ?? []).reduce((s, u) => s + Number(u.credits), 0) },
      variant: sim.variant,
      speed: sim.speed,
      focus: focusKeys?.length ? { keys: focusKeys, retry, fromAttempt } : null,
    });

    const at = (ms: number) => new Date(startedAt.getTime() + ms).toISOString();
    const checks = t.events.filter((e) => e.type === "check.written" && e.item_key && ids.has(e.item_key));
    if (checks.length) {
      const { error } = await admin.from("checks").insert(
        checks.map((e) => ({ item_id: ids.get(e.item_key!)!, kind: String(e.payload.kind), description: String(e.payload.description), written_at: at(e.at_ms) })),
      );
      if (error) throw error;
    }

    const rows = t.events.map((e) => ({
      project_id: run.project_id,
      run_id: run.id,
      item_id: e.item_key ? (ids.get(e.item_key) ?? null) : null,
      type: e.type,
      actor: e.actor,
      actor_label: ACTOR_LABEL[e.actor],
      payload: { ...e.payload, at_ms: e.at_ms, ...(e.item_key ? { item_key: e.item_key } : {}) } as Json,
    }));
    for (let i = 0; i < rows.length; i += EVENT_CHUNK) {
      const { error } = await admin.from("events").insert(rows.slice(i, i + EVENT_CHUNK));
      if (error) throw error;
    }

    const failure = SCENARIO.rules.find((r) => r.id === "fix-once") as { failure?: unknown };
    const { data: endsAt, error } = await admin.rpc("set_run_timeline", {
      p_run: run.id,
      p_duration_ms: t.durationMs,
      p_outcome: { status: t.runStatus, failure: failure.failure ?? null, outcomes: t.outcomes } as unknown as Json,
    });
    if (error || !endsAt) throw error ?? new Error("run not running");
    return true;
  } catch {
    // Nothing is charged for a run that couldn't start; the person can click Build again.
    await admin.from("events").delete().eq("run_id", run.id);
    await admin.from("runs").update({ status: "failed", finished_at: new Date().toISOString() }).eq("id", run.id);
    return false;
  }
}

/** The database's time now: the clock runs are replayed against. */
export async function dbNow(admin: AdminDb): Promise<string> {
  const { data } = await admin.rpc("db_now");
  return data ?? new Date().toISOString();
}

/** Settles a run whose timeline is over (idempotent: the database function does it once, in one transaction). */
export async function settleRun(admin: AdminDb, runId: string): Promise<string | null> {
  const { data, error } = await admin.rpc("settle_run", { p_run: runId });
  return error ? null : data;
}

const FOLLOWUP_REFUSALS: Record<string, string> = {
  cannot_build: "Viewers can't build. Ask an Owner, Admin or Builder.",
  run_in_progress: "A build is already running on this project. Wait for it to finish.",
  over_budget: "That would go past the project's budget. Raise the budget first.",
  plan_not_agreed: "Build the plan first.",
};

/**
 * Starts a follow-up run on the agreed plan through the database's gate (role, one run at a time, budget), then
 * plays it. `focus` names the parts (null: every part still waiting).
 */
export async function startFollowupRun(
  admin: AdminDb,
  input: { projectId: string; userId: string; kind: "build" | "fix"; focus: string[] | null; estimate: number },
): Promise<{ ok: true; runId: string } | { ok: false; message: string }> {
  const { data: runId, error } = await admin.rpc("start_followup_run", {
    p_project: input.projectId,
    p_user: input.userId,
    p_kind: input.kind,
    p_focus: input.focus as unknown as Json,
    p_estimate: input.estimate,
  });
  if (error || !runId) {
    const code = Object.keys(FOLLOWUP_REFUSALS).find((k) => error?.message.includes(k));
    return { ok: false, message: code ? FOLLOWUP_REFUSALS[code] : "That couldn't start. Nothing was charged. Try again." };
  }
  await startRun(admin, runId);
  return { ok: true, runId };
}

/**
 * On page load: start any run left queued (e.g. one queued before the simulator existed), and settle any run whose time is up,
 * so a project nobody watched still ends in the right state.
 */
export async function catchUpRuns(admin: AdminDb, projectId: string): Promise<void> {
  const { data: runs } = await admin.from("runs").select("id, status, ends_at").eq("project_id", projectId).in("status", ["queued", "running"]);
  for (const r of runs ?? []) {
    if (r.status === "queued") await startRun(admin, r.id);
    else if (r.ends_at && new Date(r.ends_at).getTime() <= Date.now()) await settleRun(admin, r.id);
  }
}
