/**
 * The build simulator's timeline (docs/SIMULATOR.md): a pure, seeded function from the plan's real parts and the
 * scenario rules to every event of the run, each with its offset from the run's start. Computed once when the person
 * clicks Build (or Apply after a build); browsers replay it on the clock, so a reload or a second viewer sees the same
 * state. Nothing here touches the database.
 */
import scenarioJson from "../../../sim/scenarios/meeting-prep.json";

export type Scenario = typeof scenarioJson;
export const SCENARIO: Scenario = scenarioJson;

export type SimItem = {
  key: string;
  grp: "features" | "data" | "integrations" | "agents" | "quality" | string;
  title: string;
  description?: string | null;
  item_class?: string | null;
  size?: "s" | "m" | "l" | string | null;
  provider?: string | null;
  estimate_likely?: number | null;
  position: number;
  /** Parts already built (a change run) or set aside / dropped are skipped. */
  status: string;
};

export type Variant = "default" | "paused" | "budget";

export type TimelineInput = {
  runId: string;
  items: SimItem[];
  /** Providers connected in this workspace. */
  connected: string[];
  /** Providers the workspace's connector policy denies. */
  denied: string[];
  /** The project's budget and what it has spent already (null: no budget). */
  budget: { limit: number | null; spent: number };
  variant?: Variant;
  /** 1 = the scenario's pace (~90 s for the demo); ?sim=fast uses 0.25. */
  speed?: number;
  scenario?: Scenario;
};

export type SimEventType =
  | "run.started"
  | "check.written"
  | "item.building"
  | "log.line"
  | "item.built"
  | "item.failed"
  | "item.fixing"
  | "item.needs_connection"
  | "item.sample_data"
  | "item.needs_approval"
  | "item.paused"
  | "run.progress"
  | "run.paused_budget"
  | "preview.updated"
  | "run.done";

export type SimEvent = { at_ms: number; type: SimEventType; item_key?: string; actor: "architect_agent" | "verifier" | "system"; payload: Record<string, unknown> };

/** Where each part ends up when the run settles. */
export type FinalStatus = "built" | "sample_data" | "needs_connection" | "needs_approval" | "paused" | "agreed";

export type ItemOutcome = {
  key: string;
  status: FinalStatus;
  statusDetail: string | null;
  /** Credits charged for the build itself (0 if it never ran). */
  credits: number;
  /** One entry per fix attempt (each its own Usage line). */
  fixes: { attempt: number; credits: number; measured: string | null; note: string | null }[];
  /** The proof attached to a part that works: a passing check. */
  proof: { kind: string; assertions: [number, number]; screenshot: boolean } | null;
  /** Failed attempts, for the Blocked drawer (screen 6). */
  attempts: { attempt: number; measured: string | null; note: string | null; credits: number; result: "fail" | "pass" }[];
  provider?: string;
};

export type Timeline = {
  events: SimEvent[];
  outcomes: ItemOutcome[];
  durationMs: number;
  runStatus: "done" | "paused_budget" | "paused_item";
  totals: { credits: number; fixCredits: number };
};

/** FNV-1a: a stable 32-bit hash of the run id, so each run differs but replays identically. */
export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small seeded random generator in [0, 1). */
export function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIZE_MULT: Record<string, number> = { s: 0.7, m: 1, l: 1.5 };
const between = (rand: () => number, [lo, hi]: readonly number[] | number[]) => lo + rand() * (hi - lo);
const norm = (p: string | null | undefined) => (p ?? "").toLowerCase().replace(/[\s-]+/g, "_");

type Outcome = {
  kind: "pass" | "needs_connection" | "needs_approval" | "sample_data" | "fail_then_pass" | "fail";
  /** How many of the fixes after the first failed check also fail (3 = Blocked). */
  failingFixes: number;
  measured: string[];
  notes: string[];
};

/** Fixes per part before it's Blocked (BUILD-SPEC: "up to 3 attempts"). */
export const MAX_FIXES = 3;

type FixRule = { failure?: { check: string; measured: string }; fail_attempts?: number; fix_log?: { verb: string; object: string }[] };
type PausedOverride = { fail_attempts: number; measured_by_attempt: string[]; notes_by_attempt?: string[] };

/** Which scenario rule a part matches (approval before connection: a denied service can't be connected yet). */
export function outcomeFor(item: SimItem, ctx: { lastAgentKey: string | null; connected: Set<string>; denied: Set<string>; variant: Variant; scenario: Scenario }): Outcome {
  const provider = norm(item.provider);
  const text = `${item.title} ${item.description ?? ""}`.toLowerCase();

  const plain = { failingFixes: 0, measured: [], notes: [] };
  if (provider && ctx.denied.has(provider)) return { kind: "needs_approval", ...plain };
  if (item.grp === "integrations" && provider && !ctx.connected.has(provider)) return { kind: "needs_connection", ...plain };
  const sample = ctx.scenario.rules.find((r) => r.id === "sample-data") as unknown as { match: { keywords: string[] } };
  if (item.grp === "data" && sample.match.keywords.some((k) => text.includes(k))) return { kind: "sample_data", ...plain };
  if (item.grp === "agents" && item.key === ctx.lastAgentKey) {
    if (ctx.variant === "paused") {
      const o = (ctx.scenario.variants.paused.override as Record<string, PausedOverride>)["fix-once"];
      return { kind: "fail", failingFixes: o.fail_attempts, measured: o.measured_by_attempt, notes: o.notes_by_attempt ?? [] };
    }
    return { kind: "fail_then_pass", ...plain };
  }
  return { kind: "pass", ...plain };
}

/** The check written for a part before its code (by group, from the scenario). */
function checkFor(item: SimItem, scenario: Scenario) {
  const byGroup = scenario.checks_by_group as Record<string, { kind: string; assertions: number; screenshot: boolean }>;
  return byGroup[item.grp] ?? { kind: "rubric", assertions: 2, screenshot: false };
}

/**
 * Builds the run's whole timeline. Parts run in the scenario's group order (data → integrations → agents → features
 * → quality), then by their position. Before each part: its check is written (checks before code, A-7). Before each
 * part's spend: the budget is checked (BL-14); a run that would pass it pauses, keeping what's finished.
 */
export function buildTimeline(input: TimelineInput): Timeline {
  const scenario = input.scenario ?? SCENARIO;
  const variant = input.variant ?? "default";
  const speed = input.speed ?? 1;
  const rand = seeded(hash(input.runId));
  const timing = scenario.timing;
  const groupFactor = timing.size_factor as Record<string, number>;
  const order = scenario.order as string[];

  const todo = input.items
    .filter((i) => !["built", "deferred", "dropped", "sample_data"].includes(i.status))
    .sort((a, b) => order.indexOf(a.grp) - order.indexOf(b.grp) || a.position - b.position);
  const agents = todo.filter((i) => i.grp === "agents");
  const lastAgentKey = agents.length ? agents[agents.length - 1].key : null;
  const ctx = { lastAgentKey, connected: new Set(input.connected.map(norm)), denied: new Set(input.denied.map(norm)), variant, scenario };

  const fixRule = scenario.rules.find((r) => r.id === "fix-once") as FixRule;
  let spent = input.budget.spent;
  const events: SimEvent[] = [];
  const outcomes: ItemOutcome[] = [];
  let t = 0;
  const step = (ms: number) => (t += Math.round(ms * speed));
  const at = () => t;
  const total = todo.length;
  const totalEstimate = todo.reduce((s, i) => s + Number(i.estimate_likely ?? 0), 0);
  // ?sim=budget: real plans cost 20–80 credits, so a fixed budget wouldn't trip. Set it to ~60% of this build,
  // rounded to 5, so the pause always lands part-way with finished parts kept (screen 7).
  const limit = variant === "budget" ? spent + Math.max(5, Math.round((totalEstimate * scenario.variants.budget.budget_share) / 5) * 5) : input.budget.limit;
  const revealed = new Set<string>();
  let done = 0;
  let runStatus: Timeline["runStatus"] = "done";
  let fixCredits = 0;

  events.push({ at_ms: 0, type: "run.started", actor: "system", payload: { total_items: total, est_minutes: Math.max(1, Math.round((totalEstimate / 12) * 45 / 60)) } });
  step(600);

  for (const [index, item] of todo.entries()) {
    const outcome = outcomeFor(item, ctx);
    const estimate = Number(item.estimate_likely ?? 8);
    const credits = Math.max(1, Math.round(estimate * between(rand, scenario.cost.actual_factor)));

    // Budget: check spend plus this part before it runs (DATA-MODEL rule 7).
    if (limit !== null && outcome.kind !== "needs_approval" && spent + credits > limit) {
      const remaining = todo.slice(index);
      events.push({
        at_ms: at(),
        type: "run.paused_budget",
        actor: "system",
        payload: { used: Math.round(spent), budget: limit, remaining_items: remaining.length, remaining_est: Math.round(remaining.reduce((s, i) => s + Number(i.estimate_likely ?? 0), 0)) },
      });
      for (const r of remaining) outcomes.push({ key: r.key, status: "agreed", statusDetail: null, credits: 0, fixes: [], proof: null, attempts: [] });
      runStatus = "paused_budget";
      break;
    }

    const check = checkFor(item, scenario);
    events.push({ at_ms: at(), type: "check.written", item_key: item.key, actor: "verifier", payload: { item_key: item.key, kind: check.kind, description: `Done when ${item.title.toLowerCase()} passes its check` } });
    step(timing.check_written_ms);
    events.push({ at_ms: at(), type: "item.building", item_key: item.key, actor: "architect_agent", payload: { item_key: item.key } });
    events.push({ at_ms: at(), type: "log.line", item_key: item.key, actor: "architect_agent", payload: { verb: "Building", object: item.title } });
    const duration = timing.base_ms * (groupFactor[item.grp] ?? 1) * (SIZE_MULT[item.size ?? "m"] ?? 1) * (1 + (rand() * 2 - 1) * timing.jitter);
    step(duration);

    const base: ItemOutcome = { key: item.key, status: "built", statusDetail: null, credits, fixes: [], proof: null, attempts: [] };
    const passProof = { kind: check.kind, assertions: [check.assertions, check.assertions] as [number, number], screenshot: check.screenshot };

    if (outcome.kind === "needs_approval") {
      events.push({ at_ms: at(), type: "log.line", item_key: item.key, actor: "architect_agent", payload: { verb: "Waiting", object: `approval for ${item.provider}` } });
      events.push({ at_ms: at(), type: "item.needs_approval", item_key: item.key, actor: "system", payload: { item_key: item.key, provider: item.provider } });
      outcomes.push({ ...base, status: "needs_approval", statusDetail: "IT admin reviews", credits: 0, provider: item.provider ?? undefined });
    } else if (outcome.kind === "needs_connection") {
      // Built against sample data; it works for real once the account is connected (BL-9, A-8).
      spent += credits;
      events.push({ at_ms: at(), type: "log.line", item_key: item.key, actor: "architect_agent", payload: { verb: "Waiting", object: `${item.provider} connection` } });
      events.push({ at_ms: at(), type: "item.needs_connection", item_key: item.key, actor: "system", payload: { item_key: item.key, provider: item.provider } });
      outcomes.push({ ...base, status: "needs_connection", statusDetail: "using sample data until connected", proof: passProof, provider: item.provider ?? undefined });
    } else if (outcome.kind === "sample_data") {
      spent += credits;
      events.push({ at_ms: at(), type: "item.sample_data", item_key: item.key, actor: "system", payload: { item_key: item.key, reason: "No real data source connected yet" } });
      outcomes.push({ ...base, status: "sample_data", statusDetail: "using sample data", proof: passProof });
      done++;
    } else if (outcome.kind === "fail_then_pass" || outcome.kind === "fail") {
      // The build's check fails, then up to 3 fixes run, each its own Usage line (A-9). Normally fix 1 passes;
      // ?sim=paused makes all 3 fail and the part is Blocked (screen 6).
      spent += credits;
      const checkText = fixRule.failure?.check ?? "the part's check";
      const attempts: ItemOutcome["attempts"] = [];
      const fixes: ItemOutcome["fixes"] = [];
      events.push({ at_ms: at(), type: "item.failed", item_key: item.key, actor: "verifier", payload: { item_key: item.key, attempt: 0, reason: checkText, measured: fixRule.failure?.measured ?? null } });
      let passed = false;
      let budgetStop = false;
      for (let attempt = 1; attempt <= MAX_FIXES; attempt++) {
        const fixCost = Math.round(between(rand, scenario.cost.fix_credits));
        // A fix that would pass the budget doesn't run.
        if (limit !== null && spent + fixCost > limit) {
          budgetStop = true;
          break;
        }
        spent += fixCost;
        fixCredits += fixCost;
        events.push({ at_ms: at(), type: "item.fixing", item_key: item.key, actor: "architect_agent", payload: { item_key: item.key, attempt, credits: fixCost } });
        for (const line of fixRule.fix_log ?? []) {
          events.push({ at_ms: at(), type: "log.line", item_key: item.key, actor: "architect_agent", payload: { verb: line.verb, object: line.object.replace("{key}", item.key) } });
        }
        step(duration * 0.6);
        const fails = attempt <= outcome.failingFixes;
        const measured = fails ? (outcome.measured[attempt - 1] ?? null) : null;
        const note = outcome.notes[attempt - 1] ?? null;
        fixes.push({ attempt, credits: fixCost, measured, note });
        attempts.push({ attempt, measured, note, credits: fixCost, result: fails ? "fail" : "pass" });
        if (!fails) {
          passed = true;
          break;
        }
        events.push({ at_ms: at(), type: "item.failed", item_key: item.key, actor: "verifier", payload: { item_key: item.key, attempt, reason: checkText, measured } });
      }
      if (passed) {
        events.push({ at_ms: at(), type: "item.built", item_key: item.key, actor: "verifier", payload: { item_key: item.key, assertions: passProof.assertions, screenshot: passProof.screenshot, credits } });
        outcomes.push({ ...base, fixes, attempts, proof: passProof });
        done++;
      } else {
        const last = attempts.at(-1)?.measured ?? fixRule.failure?.measured ?? "failed";
        events.push({ at_ms: at(), type: "item.paused", item_key: item.key, actor: "system", payload: { item_key: item.key, attempts } });
        outcomes.push({
          ...base,
          status: "paused",
          statusDetail: budgetStop ? `${checkText}: ${last} · the next fix would pass the budget` : `Stopped after ${MAX_FIXES} fixes to protect your credits`,
          fixes,
          attempts,
          proof: null,
        });
        runStatus = "paused_item";
      }
    } else {
      spent += credits;
      events.push({ at_ms: at(), type: "item.built", item_key: item.key, actor: "verifier", payload: { item_key: item.key, assertions: passProof.assertions, screenshot: passProof.screenshot, credits } });
      outcomes.push({ ...base, proof: passProof });
      done++;
    }

    const reveal = (scenario.preview.reveal as Record<string, string>)[item.grp];
    if (reveal && !revealed.has(reveal) && outcomes.at(-1)!.status !== "needs_approval") {
      revealed.add(reveal);
      events.push({ at_ms: at(), type: "preview.updated", actor: "system", payload: { path: reveal } });
    }
    const left = todo.slice(index + 1).reduce((s, i) => s + timing.base_ms * (groupFactor[i.grp] ?? 1), 0) * speed;
    events.push({ at_ms: at(), type: "run.progress", actor: "system", payload: { done, total, eta_s: Math.round(left / 1000) } });
  }

  if (runStatus === "done" && outcomes.some((o) => o.status === "paused")) runStatus = "paused_item";
  if (runStatus !== "paused_budget") {
    step(300);
    events.push({ at_ms: at(), type: "run.done", actor: "system", payload: { proven: outcomes.filter((o) => o.status === "built" || o.status === "sample_data").length, total } });
  }
  return {
    events,
    outcomes,
    durationMs: t,
    runStatus,
    totals: { credits: outcomes.reduce((s, o) => s + (o.status === "agreed" || o.status === "needs_approval" ? 0 : o.credits), 0), fixCredits },
  };
}
