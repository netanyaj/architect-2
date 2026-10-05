import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Blueprint } from "@/lib/blueprint";
import { estimate } from "@/server/estimate";
import { FakeDb } from "./fake-db";

vi.mock("server-only", () => ({}));
const { startRun, parseSim, catchUpRuns, blockedInRun, amendRun } = await import("@/server/sim/run");

const plan: Blueprint = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "blueprints", "meeting-prep.gemini.json"), "utf8"));
const PROJECT = "p-1";
const BP = "bp-1";
let db: FakeDb;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = () => db as any;

beforeEach(() => {
  db = new FakeDb({
    runs: [{ id: "run-1", project_id: PROJECT, blueprint_id: BP, kind: "build", status: "queued" }],
    projects: [{ id: PROJECT, workspace_id: "ws-1", budget_credits: null }],
    items: plan.items.map((i, position) => ({ ...i, id: `item-${i.key}`, blueprint_id: BP, position, status: "agreed", estimate_likely: estimate(i).likely })),
    connections: [
      { workspace_id: "ws-1", provider: "google_calendar", status: "connected" },
      { workspace_id: "ws-1", provider: "slack", status: "connected" },
      { workspace_id: "ws-1", provider: "gmail", status: "missing" },
    ],
    policies: [{ workspace_id: "ws-1", kind: "connectors", config: { allow: ["gmail"], deny: ["hubspot"] } }],
    usage_ledger: [],
    events: [],
    checks: [],
  });
  // The database's run clock (migration 0009), as Postgres would do it.
  const base = db.rpc;
  db.rpc = async (fn: string, args: Record<string, unknown>) => {
    const run = db.tables.runs.find((r) => r.id === args.p_run);
    if (fn === "begin_run") {
      if (!run || run.status !== "queued") return { data: null, error: null };
      Object.assign(run, { status: "running", started_at: "2026-10-06T10:00:00.000Z", variant: args.p_variant, speed: args.p_speed, scenario: args.p_scenario });
      return { data: run.started_at, error: null };
    }
    if (fn === "set_run_timeline") {
      if (!run || run.status !== "running") return { data: null, error: null };
      Object.assign(run, { ends_at: new Date(Date.parse(String(run.started_at)) + Number(args.p_duration_ms)).toISOString(), outcome: args.p_outcome });
      return { data: run.ends_at, error: null };
    }
    return base(fn, args);
  };
});

describe("parseSim", () => {
  it("reads ?sim= variants and pace, ignoring anything else", () => {
    expect(parseSim(null)).toEqual({ variant: "default", speed: 1 });
    expect(parseSim("paused")).toEqual({ variant: "paused", speed: 1 });
    expect(parseSim("budget,fast")).toEqual({ variant: "budget", speed: 0.25 });
    expect(parseSim("<script>")).toEqual({ variant: "default", speed: 1 });
  });
});

describe("startRun", () => {
  it("claims the queued run, writes every part's check and every event, and records how it ends", async () => {
    expect(await startRun(admin(), "run-1")).toBe(true);
    const run = db.tables.runs[0];
    expect(run).toMatchObject({ status: "running", variant: "default", speed: 1, scenario: "meeting-prep" });
    expect(new Date(String(run.ends_at)).getTime()).toBeGreaterThan(new Date(String(run.started_at)).getTime());
    expect((run.outcome as { status: string }).status).toBe("done");

    expect(db.tables.checks).toHaveLength(plan.items.length);
    expect(db.tables.events[0]).toMatchObject({ type: "run.started", run_id: "run-1", project_id: PROJECT, payload: { at_ms: 0 } });
    const built = db.tables.events.find((e) => e.type === "item.built");
    expect(built).toMatchObject({ item_id: expect.stringMatching(/^item-/), actor: "verifier", actor_label: "Verifier" });
    // Gmail isn't connected: it waits for its connection.
    expect(db.tables.events.find((e) => e.type === "item.needs_connection")).toMatchObject({ item_id: "item-attendee-email-threads", payload: { provider: "gmail" } });
    // Nothing is charged until the run settles.
    expect(db.tables.usage_ledger).toEqual([]);
  });

  it("each check is dated before its part's code", async () => {
    await startRun(admin(), "run-1");
    const started = new Date(String(db.tables.runs[0].started_at)).getTime();
    for (const c of db.tables.checks) {
      const building = db.tables.events.find((e) => e.type === "item.building" && e.item_id === c.item_id)!;
      expect(new Date(String(c.written_at)).getTime()).toBeLessThanOrEqual(started + Number((building.payload as { at_ms: number }).at_ms));
    }
  });

  it("only starts once", async () => {
    expect(await startRun(admin(), "run-1")).toBe(true);
    const n = db.tables.events.length;
    expect(await startRun(admin(), "run-1")).toBe(false);
    expect(db.tables.events).toHaveLength(n);
  });

  it("?sim=paused is stored on the run and blocks the brief writer", async () => {
    await startRun(admin(), "run-1", { variant: "paused", speed: 0.25 });
    expect(db.tables.runs[0]).toMatchObject({ variant: "paused", speed: 0.25 });
    expect((db.tables.runs[0].outcome as { status: string }).status).toBe("paused_item");
    expect(db.tables.events.filter((e) => e.type === "item.fixing")).toHaveLength(3);
  });

  it("a run that can't start is marked failed with nothing left behind", async () => {
    const insert = db.from.bind(db);
    db.from = (t: string) => {
      const q = insert(t);
      if (t === "events") q.insert = () => ({ then: (r: (v: unknown) => void) => r({ data: null, error: { message: "boom" } }) }) as never;
      return q;
    };
    expect(await startRun(admin(), "run-1")).toBe(false);
    expect(db.tables.runs[0].status).toBe("failed");
  });
});

describe("catchUpRuns", () => {
  it("starts a run left queued, and settles one whose time is up", async () => {
    db.tables.runs.push({ id: "run-old", project_id: PROJECT, status: "running", ends_at: new Date(Date.now() - 1000).toISOString() });
    await catchUpRuns(admin(), PROJECT);
    expect(db.tables.runs[0].status).toBe("running");
    expect(db.rpcCalls.filter((c) => c.fn === "settle_run")).toEqual([{ fn: "settle_run", args: { p_run: "run-old" } }]);
  });
});

describe("a Blocked part during the run (A-9)", () => {
  it("counts as Blocked only once its moment has played; amending moves the outcome, the end and the events", async () => {
    await startRun(admin(), "run-1", { variant: "paused", speed: 1 });
    const run = db.tables.runs[0];
    const pausedAt = (db.tables.events.find((e) => e.type === "item.paused")!.payload as { at_ms: number }).at_ms;
    // The database's "now": just before, then just after the part is Blocked.
    const base = db.rpc;
    let now = Date.parse(String(run.started_at)) + pausedAt - 1000;
    db.rpc = async (fn: string, args: Record<string, unknown>) => (fn === "db_now" ? { data: new Date(now).toISOString(), error: null } : base(fn, args));
    expect(await blockedInRun(admin(), PROJECT, "talking-points-generator")).toBeNull();
    now += 2000;
    const b = (await blockedInRun(admin(), PROJECT, "talking-points-generator"))!;
    expect(b.part).toMatchObject({ status: "paused" });

    const before = db.tables.events.length;
    const ok = await amendRun(admin(), b, { ...b.part, status: "built" }, [{ type: "item.built", delayMs: 3000, actor: "verifier", payload: {} }], "item-x");
    expect(ok).toBe(true);
    const outcome = run.outcome as { status: string; outcomes: { key: string; status: string }[] };
    expect(outcome.status).toBe("done");
    expect(outcome.outcomes.find((o) => o.key === "talking-points-generator")!.status).toBe("built");
    expect(db.tables.events.length).toBe(before + 1);
    expect((db.tables.events.at(-1)!.payload as { at_ms: number }).at_ms).toBe(b.elapsedMs + 3000);
    run.status = "done";
    expect(await amendRun(admin(), b, b.part, [], "item-x")).toBe(false);
  });
});
