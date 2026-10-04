import { describe, expect, it } from "vitest";
import { summarizeProject } from "@/lib/project-status";
import { workspaceState } from "@/lib/workspace-state";

const parts = (status: string, n: number) => Array.from({ length: n }, () => ({ status, title: "x", grp: "features" }));

describe("workspaceState", () => {
  it("a draft with a plan shows Build with its cost, off with the reason and credits beside it", () => {
    const s = workspaceState({
      status: "draft",
      role: "builder",
      summary: summarizeProject({ status: "draft", budgetCredits: null, items: parts("proposed", 3) }),
      planTotal: 48,
      hasPlan: true,
      creditsLeft: 1240,
    });
    expect(s).toMatchObject({ stage: "plan", progress: "3 parts", paused: false });
    expect(s.action.label).toBe("Build · ~48 credits");
    expect(s.action.disabledReason).toMatch(/Nothing has been built or charged/);
    expect(s.action.beside).toBe("Not built yet · 1,240 credits available");
  });

  it("a Viewer always gets the Viewer reason, on every stage", () => {
    for (const status of ["draft", "building", "live"] as const) {
      const s = workspaceState({
        status,
        role: "viewer",
        summary: summarizeProject({ status, budgetCredits: null, items: parts("built", 2) }),
        planTotal: 10,
        hasPlan: true,
        creditsLeft: 10,
      });
      expect(s.action.disabledReason).toBe("Viewers can't build. Ask an Owner, Admin or Builder.");
      expect(s.action.beside).toMatch(/^Viewers can't/);
    }
  });

  it("no plan yet: Build is off until the plan exists", () => {
    const s = workspaceState({ status: "draft", role: "owner", summary: summarizeProject({ status: "draft", budgetCredits: null, items: [] }), planTotal: null, hasPlan: false, creditsLeft: 5 });
    expect(s).toMatchObject({ stage: "plan", progress: "no plan yet", action: { label: "Build" } });
    expect(s.action.disabledReason).toMatch(/^Write the plan first/);
  });

  it("paused at budget: the Build stage with a pause, Launch blocked with its reason", () => {
    const s = workspaceState({
      status: "paused",
      role: "owner",
      summary: summarizeProject({ status: "paused", budgetCredits: 100, runStatus: "paused_budget", items: [...parts("built", 4), ...parts("agreed", 3)] }),
      planTotal: 125,
      hasPlan: true,
      creditsLeft: 900,
    });
    expect(s).toMatchObject({ stage: "build", progress: "paused at budget", paused: true, action: { label: "Launch", beside: "Blocked: budget used" } });
  });

  it("live: the Launch stage, Share with your team", () => {
    const s = workspaceState({ status: "live", role: "admin", summary: summarizeProject({ status: "live", budgetCredits: null, items: parts("built", 12) }), planTotal: 160, hasPlan: true, creditsLeft: 1 });
    expect(s).toMatchObject({ stage: "launch", progress: "Live", action: { label: "Share with your team", beside: "Live" } });
  });
});
