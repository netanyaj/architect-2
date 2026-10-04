/**
 * Replaying a run on the clock (docs/SIMULATOR.md step 2): from the run's stored events and the time now, what every
 * viewer sees: each part's state, the progress line, the activity lines, what the preview shows and any pause.
 * Pure, so a reload or a second viewer computes exactly the same thing.
 */

export type RunEvent = {
  id: number;
  type: string;
  itemKey: string | null;
  atMs: number;
  actorLabel: string | null;
  payload: Record<string, unknown>;
};

export type RunInfo = {
  id: string;
  kind: string;
  status: string;
  variant: string;
  startedAt: string | null;
  endsAt: string | null;
  events: RunEvent[];
};

export type PartState = { status: string; statusDetail: string | null };

export type ActivityLine = { id: number; atMs: number; actor: string; verb: string; object: string; itemKey: string | null };

export type BudgetPause = { used: number; budget: number; remainingItems: number; remainingEst: number };

export type LiveRun = {
  /** Part key → its state now (only parts the run has reached, plus parts waiting for budget). */
  parts: Record<string, PartState>;
  done: number;
  total: number;
  etaSeconds: number | null;
  activity: ActivityLine[];
  /** Preview paths revealed so far, oldest first. */
  revealed: string[];
  budgetPause: BudgetPause | null;
  /** The run is playing (its time isn't up). */
  playing: boolean;
  /** Every event has played, but the database hasn't settled it yet. */
  due: boolean;
  /** Milliseconds until the next event, for the timer (null when nothing's left). */
  nextInMs: number | null;
  /** Fix attempts so far, per part (for "try n of 3"). */
  fixes: Record<string, number>;
  /** Credits the run has used so far (charged to Usage when it settles). */
  spent: number;
};

/** "brief is 200 words or fewer" → "too long"; otherwise what was measured. */
export function failedBecause(reason: unknown, measured: unknown): string {
  const r = String(reason ?? "");
  if (/or fewer|under|at most|no more than/i.test(r)) return "too long";
  if (/or more|at least/i.test(r)) return "too short";
  return String(measured ?? "it didn't pass");
}

const EMPTY: LiveRun = { parts: {}, done: 0, total: 0, etaSeconds: null, activity: [], revealed: [], budgetPause: null, playing: false, due: false, nextInMs: null, fixes: {}, spent: 0 };

export function replay(run: RunInfo | null, nowMs: number): LiveRun {
  if (!run || !run.startedAt) return EMPTY;
  const start = new Date(run.startedAt).getTime();
  const elapsed = nowMs - start;
  const running = run.status === "running";
  // A settled run shows all its events; a running one only those whose time has come.
  const visible = running ? run.events.filter((e) => e.atMs <= elapsed) : run.events;
  const next = running ? run.events.find((e) => e.atMs > elapsed) : undefined;
  const endsAt = run.endsAt ? new Date(run.endsAt).getTime() : null;

  const live: LiveRun = {
    ...EMPTY,
    parts: {},
    activity: [],
    revealed: [],
    fixes: {},
    playing: running && (endsAt === null || nowMs < endsAt),
    due: running && endsAt !== null && nowMs >= endsAt,
    nextInMs: next ? Math.max(0, next.atMs - elapsed) : null,
  };
  let lastFailure = "";

  for (const e of visible) {
    const key = e.itemKey;
    const p = e.payload;
    if (typeof p.credits === "number" && ["item.built", "item.fixing", "item.needs_connection", "item.sample_data"].includes(e.type)) live.spent += p.credits;
    switch (e.type) {
      case "run.started":
        live.total = Number(p.total_items ?? 0);
        break;
      case "item.building":
        if (key) live.parts[key] = { status: "building", statusDetail: "Building now" };
        break;
      case "item.failed":
        lastFailure = failedBecause(p.reason, p.measured);
        if (key) live.parts[key] = { status: "failed", statusDetail: `A check failed (${lastFailure}). Fixing it, try ${Math.min(3, (live.fixes[key] ?? 0) + 1)} of 3.` };
        break;
      case "item.fixing":
        if (key) {
          const n = Number(p.attempt ?? 1);
          live.fixes[key] = n;
          live.parts[key] = { status: "failed", statusDetail: n > 3 ? "Trying once more" : `A check failed (${lastFailure || "too long"}). Fixing it, try ${n} of 3.` };
        }
        break;
      case "item.built":
        if (key) live.parts[key] = { status: "built", statusDetail: null };
        break;
      case "item.sample_data":
        if (key) live.parts[key] = { status: "sample_data", statusDetail: "using sample data" };
        break;
      case "item.needs_connection":
        if (key) live.parts[key] = { status: "needs_connection", statusDetail: "using sample data until connected" };
        break;
      case "item.needs_approval":
        if (key) live.parts[key] = { status: "needs_approval", statusDetail: "IT admin reviews" };
        break;
      case "item.paused":
        if (key) live.parts[key] = { status: "paused", statusDetail: "Stopped after 3 fixes to protect your credits" };
        break;
      case "run.progress":
        live.done = Number(p.done ?? live.done);
        live.total = Number(p.total ?? live.total);
        live.etaSeconds = p.eta_s === undefined ? null : Number(p.eta_s);
        break;
      case "run.paused_budget":
        live.budgetPause = { used: Number(p.used ?? 0), budget: Number(p.budget ?? 0), remainingItems: Number(p.remaining_items ?? 0), remainingEst: Number(p.remaining_est ?? 0) };
        break;
      case "preview.updated":
        if (typeof p.path === "string" && !live.revealed.includes(p.path)) live.revealed.push(p.path);
        break;
      case "log.line":
        live.activity.push({ id: e.id, atMs: e.atMs, actor: e.actorLabel ?? "Architect agent", verb: String(p.verb ?? ""), object: String(p.object ?? ""), itemKey: key });
        break;
    }
  }
  if (!live.playing) live.etaSeconds = null;
  return live;
}

/** Parts with the run's live state laid over what the database says. */
export function withLive<T extends { key: string; status: string; statusDetail: string | null }>(items: T[], live: LiveRun, running: boolean): T[] {
  if (!running) return items;
  return items.map((i) => (live.parts[i.key] ? { ...i, ...live.parts[i.key] } : i));
}

/** "about 6 min" / "less than a minute". */
export function etaWords(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds < 60) return "less than a minute";
  return `about ${Math.round(seconds / 60)} min`;
}
