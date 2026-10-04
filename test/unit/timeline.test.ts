import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Blueprint } from "@/lib/blueprint";
import { buildTimeline, hash, MAX_FIXES, type SimItem, type TimelineInput } from "@/lib/sim/timeline";
import { estimate } from "@/server/estimate";

/* The recorded Meeting Prep plan, priced like the real thing, is the build's input. */
const plan: Blueprint = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "blueprints", "meeting-prep.gemini.json"), "utf8"));
const items: SimItem[] = plan.items.map((i, position) => ({ ...i, position, status: "agreed", estimate_likely: estimate(i).likely }));

const input = (over: Partial<TimelineInput> = {}): TimelineInput => ({
  runId: "run-1",
  items,
  connected: ["google_calendar", "slack"],
  denied: [],
  budget: { limit: null, spent: 0 },
  ...over,
});
const outcome = (t: ReturnType<typeof buildTimeline>, key: string) => t.outcomes.find((o) => o.key === key)!;
const typesFor = (t: ReturnType<typeof buildTimeline>, key: string) => t.events.filter((e) => e.item_key === key).map((e) => e.type);

describe("buildTimeline", () => {
  it("is deterministic per run, and differs between runs", () => {
    expect(buildTimeline(input())).toEqual(buildTimeline(input()));
    expect(buildTimeline(input({ runId: "run-2" })).durationMs).not.toBe(buildTimeline(input()).durationMs);
    expect(hash("run-1")).toBe(hash("run-1"));
  });

  it("runs parts in the scenario's group order, and every event is in time order", () => {
    const t = buildTimeline(input());
    const started = t.events.filter((e) => e.type === "item.building").map((e) => e.item_key);
    expect(started).toEqual(["calendar-events", "attendee-email-threads", "slack-brief-delivery", "agenda-pdf-summariser", "talking-points-generator", "brief-schedule"]);
    const times = t.events.map((e) => e.at_ms);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(t.events[0].type).toBe("run.started");
    expect(t.events.at(-1)).toMatchObject({ type: "run.done", payload: { total: 6 } });
  });

  it("writes each part's check before its code (A-7)", () => {
    const t = buildTimeline(input());
    for (const i of items) {
      const types = typesFor(t, i.key);
      expect(types.indexOf("check.written")).toBeLessThan(types.indexOf("item.building"));
    }
  });

  it("an integration whose account isn't connected waits for its connection, and the build carries on", () => {
    const t = buildTimeline(input());
    expect(outcome(t, "attendee-email-threads")).toMatchObject({ status: "needs_connection", provider: "gmail" });
    expect(typesFor(t, "attendee-email-threads")).toContain("item.needs_connection");
    expect(outcome(t, "calendar-events").status).toBe("built");
    expect(t.runStatus).toBe("done");
  });

  it("a service the workspace's policy denies waits for approval and costs nothing", () => {
    const t = buildTimeline(input({ denied: ["slack"] }));
    expect(outcome(t, "slack-brief-delivery")).toMatchObject({ status: "needs_approval", credits: 0, statusDetail: "IT admin reviews" });
  });

  it("the last agent part fails its check once, then passes on fix 1, with the fix as its own cost", () => {
    const t = buildTimeline(input());
    const o = outcome(t, "talking-points-generator");
    expect(o.status).toBe("built");
    expect(o.fixes).toHaveLength(1);
    expect(o.fixes[0].credits).toBeGreaterThanOrEqual(2);
    expect(o.fixes[0].credits).toBeLessThanOrEqual(3);
    expect(typesFor(t, "talking-points-generator")).toEqual(["check.written", "item.building", "log.line", "item.failed", "item.fixing", "log.line", "log.line", "item.built"]);
    expect(t.events.find((e) => e.type === "item.failed")?.payload).toMatchObject({ reason: "brief is 200 words or fewer", measured: "236 words" });
    expect(t.totals.fixCredits).toBe(o.fixes[0].credits);
    // Every other part passes on the first try.
    expect(t.outcomes.filter((x) => x.fixes.length)).toHaveLength(1);
  });

  it("?sim=paused: three fixes fail, the part is Blocked, and the run pauses on it alone", () => {
    const t = buildTimeline(input({ variant: "paused" }));
    const o = outcome(t, "talking-points-generator");
    expect(o.status).toBe("paused");
    expect(o.statusDetail).toBe("Stopped after 3 fixes to protect your credits");
    expect(o.attempts.map((a) => [a.measured, a.note, a.result])).toEqual([
      ["236 words", "Told the agent about the word limit", "fail"],
      ["212 words", "Trimmed the brief after writing it", "fail"],
      ["204 words", "Shortened the talking points", "fail"],
    ]);
    expect(o.fixes).toHaveLength(MAX_FIXES);
    expect(typesFor(t, "talking-points-generator").filter((x) => x === "item.fixing")).toHaveLength(3);
    expect(t.runStatus).toBe("paused_item");
    // The parts after it still build.
    expect(outcome(t, "brief-schedule").status).toBe("built");
  });

  it("?sim=budget: a budget of ~60% of the build, paused before the part that would pass it, keeping what's finished", () => {
    const t = buildTimeline(input({ variant: "budget" }));
    const pause = t.events.find((e) => e.type === "run.paused_budget")!;
    const budget = Number(pause.payload.budget);
    expect(budget % 5).toBe(0);
    expect(budget).toBeLessThan(items.reduce((s, i) => s + i.estimate_likely!, 0));
    expect(Number(pause.payload.used)).toBeLessThanOrEqual(budget);
    expect(t.outcomes.filter((o) => o.status === "built").length).toBeGreaterThan(0);
    expect(t.runStatus).toBe("paused_budget");
    expect(t.events.some((e) => e.type === "run.done")).toBe(false);
    const waiting = t.outcomes.filter((o) => o.status === "agreed");
    expect(waiting.length).toBe(pause.payload.remaining_items);
    expect(waiting.every((o) => o.credits === 0)).toBe(true);
    expect(t.totals.credits + t.totals.fixCredits).toBeLessThanOrEqual(budget);
  });

  it("a project budget counts what it has already spent", () => {
    const t = buildTimeline(input({ budget: { limit: 50, spent: 45 } }));
    expect(t.runStatus).toBe("paused_budget");
  });

  it("charges each part its estimate × 0.85–1.15", () => {
    const t = buildTimeline(input());
    for (const i of items) {
      const o = outcome(t, i.key);
      expect(o.credits).toBeGreaterThanOrEqual(Math.floor(i.estimate_likely! * 0.85));
      expect(o.credits).toBeLessThanOrEqual(Math.ceil(i.estimate_likely! * 1.15));
    }
  });

  it("skips parts already built, set aside or dropped (a change run builds only what's new)", () => {
    const t = buildTimeline(input({ items: items.map((i, n) => ({ ...i, status: n < 4 ? "built" : n === 4 ? "deferred" : "agreed" })) }));
    expect(t.outcomes.map((o) => o.key)).toEqual(["brief-schedule"]);
  });

  it("takes about 90 s at normal pace, and ?sim=fast is quicker", () => {
    const t = buildTimeline(input());
    expect(t.durationMs).toBeGreaterThan(30_000);
    expect(t.durationMs).toBeLessThan(120_000);
    expect(buildTimeline(input({ speed: 0.25 })).durationMs).toBeLessThan(t.durationMs / 3);
  });

  it("reveals preview sections as their groups finish", () => {
    const paths = buildTimeline(input()).events.filter((e) => e.type === "preview.updated").map((e) => e.payload.path);
    expect(paths).toEqual(["/settings/connections", "/today#talking-points"]);
  });
});
