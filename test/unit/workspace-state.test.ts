import { describe, expect, it } from "vitest";
import { summarizeProject } from "@/lib/project-status";
import { workspaceState, type PlanState } from "@/lib/workspace-state";

const parts = (status: string, n: number) => Array.from({ length: n }, () => ({ status, title: "x", grp: "features" }));
const draft = summarizeProject({ status: "draft", budgetCredits: null, items: parts("proposed", 6) });
const ready = (p: Partial<PlanState> = {}): PlanState => ({ generation: "ready", blockingOpen: 0, total: 75, parts: 6, agreed: false, ...p });

describe("workspaceState: the Plan stage", () => {
  it("a blocking question holds Build, with the reason beside it (screen 2)", () => {
    const s = workspaceState({ status: "draft", role: "owner", summary: draft, plan: ready({ blockingOpen: 1 }), creditsLeft: 1240 });
    expect(s).toMatchObject({ stage: "plan", progress: "1 question left" });
    expect(s.action).toEqual({
      label: "Build · ~75 credits",
      disabledReason: "Answer 1 question to build. Build waits because there's no safe default.",
      beside: "Answer 1 question to build · 1,240 credits available",
    });
  });

  it("once questions are answered, Build is enabled (still only a click starts it)", () => {
    const s = workspaceState({ status: "draft", role: "builder", summary: draft, plan: ready(), creditsLeft: 1240 });
    expect(s.action).toEqual({ label: "Build · ~75 credits", disabledReason: undefined, beside: "1,240 credits available" });
    expect(s.progress).toBe("6 parts");
  });

  it("while writing, and after a failure, Build stays off with the reason", () => {
    expect(workspaceState({ status: "draft", role: "owner", summary: draft, plan: null, writingNow: true, creditsLeft: 5 })).toMatchObject({
      progress: "writing the plan…",
      action: { label: "Build", disabledReason: "The plan is still being written." },
    });
    expect(workspaceState({ status: "draft", role: "owner", summary: draft, plan: ready({ generation: "failed", parts: 5 }), creditsLeft: 5 })).toMatchObject({
      progress: "stopped at 5 parts",
      action: { disabledReason: "Finish the plan first: try again, or switch model." },
    });
    expect(workspaceState({ status: "draft", role: "owner", summary: draft, plan: null, creditsLeft: 5 }).action.disabledReason).toBe("The plan comes first.");
  });

  it("a Viewer can't build; after Build, Launch is navigation, so they can open it to look", () => {
    const draft = workspaceState({ status: "draft", role: "viewer", summary: summarizeProject({ status: "draft", budgetCredits: null, items: parts("built", 2) }), plan: ready(), creditsLeft: 10 });
    expect(draft.action.disabledReason).toBe("Viewers can't build. Ask an Owner, Admin or Builder.");
    expect(draft.action.beside).toMatch(/^Viewers can't/);
    for (const status of ["building", "live"] as const) {
      const s = workspaceState({ status, role: "viewer", summary: summarizeProject({ status, budgetCredits: null, items: parts("built", 2) }), plan: ready(), creditsLeft: 10 });
      expect(s.action).toEqual({ label: "Launch", opensLaunch: true });
    }
  });
});

describe("workspaceState: after Build", () => {
  it("a queued build shows in the stepper; Launch opens, with what's left to fix (M5.5 review)", () => {
    const s = workspaceState({ status: "building", role: "owner", summary: summarizeProject({ status: "building", budgetCredits: null, items: parts("agreed", 6) }), plan: ready({ agreed: true }), runStatus: "queued", creditsLeft: 1 });
    expect(s).toMatchObject({ stage: "build", progress: "build queued", action: { label: "Launch", opensLaunch: true } });
    expect(s.action.beside).toBeUndefined();
    expect(s.action.disabledReason).toBeUndefined();
  });

  it("paused at budget: the Build stage with a pause; Launch still opens, with the count", () => {
    const s = workspaceState({
      status: "paused",
      role: "owner",
      summary: summarizeProject({ status: "paused", budgetCredits: 100, runStatus: "paused_budget", items: [...parts("built", 4), ...parts("agreed", 3)] }),
      plan: ready({ agreed: true }),
      creditsLeft: 900,
      toFix: 3,
    });
    expect(s).toMatchObject({ stage: "build", progress: "paused at budget", paused: true, action: { label: "Launch · 3 to fix", opensLaunch: true } });
  });

  it("live: the Launch stage, and the action opens Launch", () => {
    const s = workspaceState({ status: "live", role: "admin", summary: summarizeProject({ status: "live", budgetCredits: null, items: parts("built", 12) }), plan: ready({ agreed: true }), creditsLeft: 1 });
    expect(s).toMatchObject({ stage: "launch", progress: "Live", action: { label: "Launch", opensLaunch: true } });
    expect(s.action.disabledReason).toBeUndefined();
  });

  const building = (b: Partial<import("@/lib/workspace-state").BuildProgress>) =>
    workspaceState({
      status: "building",
      role: "owner",
      summary: summarizeProject({ status: "building", budgetCredits: null, items: parts("agreed", 12) }),
      plan: ready({ agreed: true }),
      creditsLeft: 1,
      build: { works: 7, total: 12, blocked: 0, eta: "about 6 min", playing: true, budgetPaused: false, ...b },
    });

  it("while it plays: the live count and time left (screen 3)", () => {
    expect(building({})).toMatchObject({ stage: "build", progress: "7 of 12 working · about 6 min", paused: false, action: { label: "Launch", opensLaunch: true } });
  });

  it("a Blocked part: counted in the stepper, Launch waits for it (screen 6)", () => {
    expect(building({ works: 10, playing: false, blocked: 1 })).toMatchObject({ progress: "10 of 12 working · 1 blocked", paused: true, action: { label: "Launch", opensLaunch: true } });
  });

  it("paused at the budget, live (screen 7)", () => {
    expect(building({ works: 4, total: 7, playing: false, budgetPaused: true })).toMatchObject({ progress: "paused at budget · 4 of 7 working", paused: true });
  });
});
