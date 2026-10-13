import { describe, expect, it } from "vitest";
import { agentGraph, triggerChoice, triggerFor, type PlanPart } from "@/lib/agents";
import { parseSchedule, scheduleFromText, scheduleWords, storeSchedule, zoneWords } from "@/lib/schedule";

/* Agent schedules (round 7, Simulated): read, stored, said in plain words, and shown as the graph's first node. */
const part = (p: Partial<PlanPart> & Pick<PlanPart, "key" | "title" | "grp">, position: number): PlanPart => ({ description: null, provedWhen: "", status: "agreed", provider: null, position, ...p });

describe("schedule words", () => {
  it("says when it runs, in the viewer's time zone or another one by its city", () => {
    expect(scheduleWords({ days: "weekdays", time: "08:00", tz: "Europe/London" }, "Europe/London")).toBe("Weekdays at 8:00, your time zone");
    expect(scheduleWords({ days: "mon", time: "17:30", tz: "America/New_York" }, "Europe/London")).toBe("Mondays at 17:30, New York time");
    expect(scheduleWords({ days: "daily", time: "09:00", tz: "" })).toBe("Every day at 9:00, your time zone");
    expect(zoneWords("UTC")).toBe("UTC");
  });

  it("stores as JSON, and reads back a schedule, off, or nothing yet", () => {
    const s = { days: "weekdays" as const, time: "08:00", tz: "Asia/Kolkata" };
    expect(parseSchedule(storeSchedule(s))).toEqual(s);
    expect(parseSchedule(storeSchedule(null))).toBe("off");
    expect(parseSchedule(null)).toBeNull();
    expect(parseSchedule('{"days":"often","time":"8"}')).toBeNull();
    // An older free-text value is read as words.
    expect(parseSchedule("every weekday at 7am")).toEqual({ days: "weekdays", time: "07:00", tz: "" });
  });

  it("reads a schedule from a plan's words", () => {
    expect(scheduleFromText("Daily schedule Scoring runs once every weekday at 8:00")).toEqual({ days: "weekdays", time: "08:00", tz: "" });
    expect(scheduleFromText("Weekly digest on Fridays at 4pm")).toEqual({ days: "fri", time: "16:00", tz: "" });
    expect(scheduleFromText("Every morning")).toEqual({ days: "daily", time: "08:00", tz: "" });
    expect(scheduleFromText("Reads new tickets")).toBeNull();
  });
});

describe("the trigger node", () => {
  it("a plan with a schedule part starts with that schedule, which can be switched off", () => {
    const g = agentGraph({
      projectName: "Lead scorer",
      prompt: null,
      parts: [part({ key: "score", title: "Score from 0 to 100", grp: "agents" }, 1), part({ key: "sched", title: "Daily schedule", grp: "quality", provedWhen: "Scoring runs once every weekday at 8:00" }, 2)],
      uploads: [],
    });
    expect(g.schedule).toEqual({ days: "weekdays", time: "08:00", tz: "" });
    expect(triggerFor(g.trigger, g.schedule, "Europe/London")).toEqual({ label: "Starts when", title: "On a schedule", detail: "Weekdays at 8:00, your time zone", edge: "Time to run", scheduled: true });
    expect(triggerFor(g.trigger, null)).toMatchObject({ title: "Someone uses the app", scheduled: false });
    expect(triggerChoice(g.trigger)).toBe("When someone uses the app");
  });

  it("a plan started by a service keeps it until a schedule is set", () => {
    const g = agentGraph({
      projectName: "Triage",
      prompt: null,
      parts: [part({ key: "read", title: "New tickets read", grp: "integrations", provider: "zendesk" }, 1), part({ key: "label", title: "Urgency label", grp: "agents" }, 2)],
      uploads: [],
    });
    expect(g.schedule).toBeNull();
    expect(triggerFor(g.trigger, null)).toMatchObject({ title: "Zendesk", scheduled: false });
    expect(triggerChoice(g.trigger)).toBe("New ticket in Zendesk");
    expect(triggerFor(g.trigger, { days: "daily", time: "07:00", tz: "UTC" }, "Europe/London")).toMatchObject({ title: "On a schedule", detail: "Every day at 7:00, UTC" });
  });
});
