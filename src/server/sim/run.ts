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
  const startedAt = new Date();
  const { data: run } = await admin
    .from("runs")
    .update({ status: "running", started_at: startedAt.toISOString(), variant: sim.variant, speed: sim.speed, scenario: SCENARIO.id })
    .eq("id", runId)
    .eq("status", "queued")
    .select("id, project_id, blueprint_id, kind")
    .maybeSingle();
  if (!run?.blueprint_id) return false;

  try {
    const { data: project } = await admin.from("projects").select("workspace_id, budget_credits").eq("id", run.project_id).single();
    if (!project) throw new Error("project missing");
    const [{ data: items }, { data: connections }, { data: policy }, { data: usage }] = await Promise.all([
      admin
        .from("items")
        .select("id, key, grp, title, description, proved_when, item_class, size, provider, estimate_likely, position, status")
        .eq("blueprint_id", run.blueprint_id),
      admin.from("connections").select("provider").eq("workspace_id", project.workspace_id).eq("status", "connected"),
      admin.from("policies").select("config").eq("workspace_id", project.workspace_id).eq("kind", "connectors").maybeSingle(),
      admin.from("usage_ledger").select("credits").eq("project_id", run.project_id),
    ]);
    const ids = new Map((items ?? []).map((i) => [i.key, i.id]));
    const denied = ((policy?.config as { deny?: string[] } | null)?.deny ?? []).map(String);

    const t = buildTimeline({
      runId: run.id,
      items: (items ?? []) as SimItem[],
      connected: (connections ?? []).map((c) => c.provider),
      denied,
      budget: { limit: project.budget_credits === null ? null : Number(project.budget_credits), spent: (usage ?? []).reduce((s, u) => s + Number(u.credits), 0) },
      variant: sim.variant,
      speed: sim.speed,
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
    const { error } = await admin
      .from("runs")
      .update({ ends_at: at(t.durationMs), outcome: { status: t.runStatus, failure: failure.failure ?? null, outcomes: t.outcomes } as unknown as Json })
      .eq("id", run.id);
    if (error) throw error;
    return true;
  } catch {
    // Nothing is charged for a run that couldn't start; the person can click Build again.
    await admin.from("events").delete().eq("run_id", run.id);
    await admin.from("runs").update({ status: "failed", finished_at: new Date().toISOString() }).eq("id", run.id);
    return false;
  }
}

/** Settles a run whose timeline is over (idempotent: the database function does it once, in one transaction). */
export async function settleRun(admin: AdminDb, runId: string): Promise<string | null> {
  const { data, error } = await admin.rpc("settle_run", { p_run: runId });
  return error ? null : data;
}

/**
 * On page load: start any run left queued (e.g. Build clicked before M3), and settle any run whose time is up,
 * so a project nobody watched still ends in the right state.
 */
export async function catchUpRuns(admin: AdminDb, projectId: string): Promise<void> {
  const { data: runs } = await admin.from("runs").select("id, status, ends_at").eq("project_id", projectId).in("status", ["queued", "running"]);
  for (const r of runs ?? []) {
    if (r.status === "queued") await startRun(admin, r.id);
    else if (r.ends_at && new Date(r.ends_at).getTime() <= Date.now()) await settleRun(admin, r.id);
  }
}
