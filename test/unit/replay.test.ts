import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Blueprint } from "@/lib/blueprint";
import { etaWords, failedBecause, replay, withLive, type RunInfo } from "@/lib/sim/replay";
import { buildTimeline, type SimItem } from "@/lib/sim/timeline";
import { estimate } from "@/server/estimate";

const plan: Blueprint = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "blueprints", "meeting-prep.gemini.json"), "utf8"));
const items: SimItem[] = plan.items.map((i, position) => ({ ...i, position, status: "agreed", estimate_likely: estimate(i).likely }));
const START = Date.parse("2026-10-06T10:00:00Z");

function runOf(variant: "default" | "paused" | "budget" = "default", status = "running"): { run: RunInfo; duration: number } {
  const t = buildTimeline({ runId: "r", items, connected: ["google_calendar", "slack"], denied: [], budget: { limit: null, spent: 0 }, variant });
  return {
    duration: t.durationMs,
    run: {
      id: "r",
      kind: "build",
      status,
      variant,
      startedAt: new Date(START).toISOString(),
      endsAt: new Date(START + t.durationMs).toISOString(),
      events: t.events.map((e, n) => ({ id: n + 1, type: e.type, itemKey: e.item_key ?? null, atMs: e.at_ms, actorLabel: e.actor === "verifier" ? "Verifier" : "Architect agent", payload: e.payload })),
    },
  };
}

describe("replay", () => {
  it("shows nothing before it starts, and only events whose time has come", () => {
    expect(replay(null, START).playing).toBe(false);
    const { run } = runOf();
    const early = replay(run, START + 1000);
    expect(early.playing).toBe(true);
    expect(early.total).toBe(6);
    expect(Object.values(early.parts)).toEqual([{ status: "building", statusDetail: "Building now" }]);
    expect(early.nextInMs).toBeGreaterThan(0);
  });

  it("is the same for every viewer at the same moment", () => {
    const { run } = runOf();
    expect(replay(run, START + 20_000)).toEqual(replay({ ...run }, START + 20_000));
  });

  it("the brief writer shows its failed check and the fix, then works", () => {
    const { run } = runOf();
    const fixing = run.events.find((e) => e.type === "item.fixing")!;
    const during = replay(run, START + fixing.atMs);
    expect(during.parts["talking-points-generator"]).toEqual({ status: "failed", statusDetail: "A check failed (too long). Fixing it, try 1 of 3." });
    const built = run.events.find((e) => e.type === "item.built" && e.itemKey === "talking-points-generator")!;
    expect(replay(run, START + built.atMs).parts["talking-points-generator"].status).toBe("built");
  });

  it("at the end it's due for settling, with every part's final state and the activity lines", () => {
    const { run, duration } = runOf();
    const end = replay(run, START + duration + 1);
    expect(end).toMatchObject({ playing: false, due: true, done: 5, total: 6, nextInMs: null, etaSeconds: null });
    expect(end.parts["attendee-email-threads"]).toEqual({ status: "needs_connection", statusDetail: "using sample data until connected" });
    expect(end.activity[0]).toMatchObject({ actor: "Architect agent", verb: "Building", object: "Calendar sync" });
    expect(end.revealed).toEqual(["/settings/connections", "/today#talking-points"]);
  });

  it("a settled run is history: all events show, nothing is due", () => {
    const { run } = runOf("default", "done");
    const r = replay(run, START);
    expect(r).toMatchObject({ playing: false, due: false });
    expect(r.activity.length).toBeGreaterThan(5);
  });

  it("?sim=paused ends with the part Blocked; ?sim=budget with the pause and its numbers", () => {
    const p = runOf("paused");
    expect(replay(p.run, START + p.duration).parts["talking-points-generator"]).toEqual({ status: "paused", statusDetail: "Stopped after 3 fixes to protect your credits" });
    const b = runOf("budget");
    const pause = replay(b.run, START + b.duration + 1).budgetPause!;
    expect(pause.budget % 5).toBe(0);
    expect(pause.remainingItems).toBeGreaterThan(0);
  });

  it("lays the live state over the saved parts only while the run plays", () => {
    const { run } = runOf();
    const live = replay(run, START + 1000);
    const saved = [{ key: "calendar-events", status: "agreed", statusDetail: null }];
    expect(withLive(saved, live, true)[0].status).toBe("building");
    expect(withLive(saved, live, false)[0].status).toBe("agreed");
  });
});

describe("words", () => {
  it("says why a check failed, and the time left", () => {
    expect(failedBecause("brief is 200 words or fewer", "236 words")).toBe("too long");
    expect(failedBecause("names every attendee", "2 of 3")).toBe("2 of 3");
    expect([etaWords(null), etaWords(30), etaWords(360)]).toEqual([null, "less than a minute", "about 6 min"]);
  });
});
