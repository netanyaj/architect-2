import "server-only";
import { after } from "next/server";

import type { Json } from "@/lib/database.types";
import { buildTimeline, SCENARIO, type SimItem, type Variant } from "@/lib/sim/timeline";
import { syncBuiltAgents } from "../agents-core";
import type { AdminDb } from "../db";
import { blockedServices, budgetRefusal } from "../policy";
import { openPullRequest } from "../pull-requests";

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
    const [{ data: items }, { data: connections }, { data: usage }] = await Promise.all([
      admin
        .from("items")
        .select("id, key, grp, title, description, proved_when, item_class, size, provider, estimate_likely, position, status, fix_attempts")
        .eq("blueprint_id", run.blueprint_id),
      admin.from("connections").select("provider").eq("workspace_id", project.workspace_id).eq("status", "connected").neq("kind", "mcp"),
      admin.from("usage_ledger").select("credits").eq("project_id", run.project_id),
    ]);
    const ids = new Map((items ?? []).map((i) => [i.key, i.id]));
    // Apps the policy doesn't allow for this project go to an admin (C-3); none with governance off.
    const denied = await blockedServices(admin, project.workspace_id, run.project_id, (items ?? []).map((i) => i.provider));

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
    // A project from a repo gets this session's branch and pull request (Simulated); nothing goes to main directly.
    await openPullRequest(admin, run.id);
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
  if (error) return null;
  // Agent parts that now work are made in the workspace's own Lyzr Studio (M5.10), after the response is sent.
  try {
    after(async () => {
      const { data: run } = await admin.from("runs").select("project_id").eq("id", runId).maybeSingle();
      if (run) await syncBuiltAgents(admin, run.project_id);
    });
  } catch {
    // Outside a request (scripts, tests): nothing to sync into.
  }
  return data;
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
  // Fixes and continuing are paid: stopped at the organisation's cap (C-7).
  const { data: proj } = await admin.from("projects").select("workspace_id").eq("id", input.projectId).maybeSingle();
  const stopped = proj ? await budgetRefusal(admin, proj.workspace_id) : undefined;
  if (stopped) return { ok: false, message: stopped };
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

/* A Blocked part while the rest of the build plays (A-9). Its Blocked state lives in the running run's outcome
   until the run settles, so the person's choice amends that outcome (settling then writes it) and adds events, so
   every viewer's replay shows the change at once. */

type OutcomeRow = import("@/lib/sim/timeline").ItemOutcome;
type RunOutcome = { status: string; failure?: unknown; outcomes: OutcomeRow[]; focus?: unknown };

export type BlockedInRun = { runId: string; projectId: string; startedAt: string; endsAt: string; outcome: RunOutcome; part: OutcomeRow; elapsedMs: number };

/** The running run in which this part is Blocked, once its "blocked" moment has played; null otherwise. */
export async function blockedInRun(admin: AdminDb, projectId: string, key: string): Promise<BlockedInRun | null> {
  const { data: run } = await admin.from("runs").select("id, started_at, ends_at, outcome").eq("project_id", projectId).eq("status", "running").maybeSingle();
  if (!run?.started_at || !run.ends_at || !run.outcome) return null;
  const outcome = run.outcome as unknown as RunOutcome;
  const part = outcome.outcomes?.find((o) => o.key === key);
  if (!part || part.status !== "paused") return null;
  const elapsedMs = Date.parse(await dbNow(admin)) - Date.parse(run.started_at);
  const { data: events } = await admin.from("events").select("type, payload").eq("run_id", run.id).eq("type", "item.paused");
  const at = (events ?? []).map((e) => e.payload as { item_key?: string; at_ms?: number }).find((p) => p.item_key === key)?.at_ms;
  if (at === undefined || at > elapsedMs) return null;
  return { runId: run.id, projectId, startedAt: run.started_at, endsAt: run.ends_at, outcome, part, elapsedMs };
}

/**
 * Replaces the part's outcome in the running run, adds events at "now" (plus each event's own delay), and moves the
 * run's end if the new events run past it. Only while the run is still running.
 */
export async function amendRun(
  admin: AdminDb,
  b: BlockedInRun,
  part: OutcomeRow,
  events: { type: string; delayMs?: number; actor: "architect_agent" | "verifier" | "system" | "user"; payload: Record<string, unknown> }[],
  itemId: string,
): Promise<boolean> {
  const outcomes = b.outcome.outcomes.map((o) => (o.key === part.key ? part : o));
  const status = b.outcome.status === "paused_item" && !outcomes.some((o) => o.status === "paused") ? "done" : b.outcome.status;
  const last = Math.max(b.elapsedMs, ...events.map((e) => b.elapsedMs + (e.delayMs ?? 0)));
  const endsAt = new Date(Math.max(Date.parse(b.endsAt), Date.parse(b.startedAt) + last + 300)).toISOString();
  const { data: updated } = await admin
    .from("runs")
    .update({ outcome: { ...b.outcome, status, outcomes } as unknown as Json, ends_at: endsAt })
    .eq("id", b.runId)
    .eq("status", "running")
    .select("id");
  if (!updated?.length) return false;
  if (events.length) {
    await admin.from("events").insert(
      events.map((e) => ({
        project_id: b.projectId,
        run_id: b.runId,
        item_id: itemId,
        type: e.type,
        actor: e.actor,
        actor_label: e.actor === "architect_agent" ? "Architect agent" : e.actor === "verifier" ? "Verifier" : null,
        payload: { ...e.payload, item_key: part.key, at_ms: b.elapsedMs + (e.delayMs ?? 0) } as Json,
      })),
    );
  }
  return true;
}
