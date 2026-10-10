import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/db";
import { launchState } from "@/lib/launch";
import { mergeBlocker, prBranch, prChecks, prTitle, syncNotice } from "@/lib/pull-requests";
import { FakeDb } from "./fake-db";

let db: FakeDb;
let role: Role;
let governance: boolean;
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/db", () => ({ createAdminDb: () => db, createServerDb: async () => db }));
vi.mock("@/server/workspace", () => ({
  // The policies read the workspace's governance setting from the database: keep it in step with the context.
  getAppContext: async () => {
    db.tables.workspaces = [{ id: "ws-1", governance_enabled: governance }];
    return { user: { id: "me" }, name: "Sam Lee", role, workspace: { id: "ws-1", name: "Acme", governanceEnabled: governance }, memberships: [] };
  },
}));

const P = "11111111-1111-4111-8111-111111111111";
const PR = "22222222-2222-4222-8222-222222222222";

describe("PR rules", () => {
  it("branch, title and checks", () => {
    expect(prBranch("ticket-triage", 2)).toBe("architect/ticket-triage-v2");
    expect(prTitle("change", [{ title: "Friday recap" }])).toBe("Change: Friday recap");
    expect(prTitle("build", [{ title: "A" }, { title: "B" }, { title: "C" }, { title: "D" }])).toBe("Build: A, B and 2 more");
    expect(prChecks("running", [{ status: "built" }])).toBe("running");
    expect(prChecks("done", [{ status: "built" }, { status: "sample_data" }])).toBe("passing");
    expect(prChecks("done", [{ status: "built" }, { status: "paused" }])).toBe("failing");
  });

  it("merging waits for passing checks; a Builder's request waits for an Owner or Admin", () => {
    const pr = { status: "open" as const, checks: "passing" as const, pushRequested: false };
    expect(mergeBlocker(pr, true)).toBeNull();
    expect(mergeBlocker({ ...pr, checks: "running" }, true)).toBe("Wait for its checks to finish.");
    expect(mergeBlocker({ ...pr, checks: "failing" }, true)).toMatch(/^Its checks are failing/);
    expect(mergeBlocker({ ...pr, status: "merged" }, true)).toBe("Already merged into main.");
    expect(mergeBlocker({ ...pr, pushRequested: true }, false)).toBe("Your request is waiting for an Owner or Admin.");
  });

  it("sync: two outside commits, and the check of a part that works re-ran", () => {
    const n = syncNotice([{ key: "a", title: "Sort tickets", status: "agreed" }, { key: "b", title: "Send to team", status: "built" }]);
    expect(n.title).toBe("2 commits on main from outside Architect · checks re-run for 1 part");
    expect(n.rerun).toEqual({ key: "b", title: "Send to team", result: "passed" });
    expect(syncNotice([]).title).toBe("2 commits on main from outside Architect · checks re-run for 0 parts");
  });

  it("Launch for a repo project: Live waits for the merge into main", () => {
    const base = {
      parts: [{ id: "i", key: "a", title: "A", status: "built", provider: null, estimate: 10 }],
      deployments: [],
      envLive: { staging: false, production: false },
      currentVersion: 1,
      role: "owner" as Role,
      governance: false,
      liveRequested: false,
      testsPassed: 3,
    };
    expect(launchState({ ...base, repo: { prNumber: 13, branch: "architect/x-v1", merged: false } }).goLive.disabledReason).toBe("Merge PR #13 into main first. Live deploys from main.");
    expect(launchState({ ...base, repo: { prNumber: 13, branch: "architect/x-v1", merged: true } }).goLive.disabledReason).toBeUndefined();
    expect(launchState({ ...base, repo: null }).goLive.disabledReason).toBeUndefined();
  });
});

describe("openPullRequest", () => {
  beforeEach(() => {
    db = new FakeDb({
      runs: [{ id: "r1", project_id: P, blueprint_id: "bp2", kind: "change" }],
      projects: [{ id: P, name: "ticket-triage", repo_full_name: "netanyaj/ticket-triage" }],
      blueprints: [{ id: "bp2", version: 2 }],
      items: [
        { key: "recap", title: "Friday recap", status: "agreed", position: 3, blueprint_id: "bp2" },
        { key: "sort", title: "Sort tickets", status: "built", position: 1, blueprint_id: "bp2" },
      ],
      pull_requests: [{ project_id: P, number: 12 }],
    });
  });

  it("a change on a repo project opens the next PR, listing only the parts the run builds", async () => {
    const { openPullRequest } = await import("@/server/pull-requests");
    expect(await openPullRequest(db as never, "r1")).toBe(13);
    expect(db.tables.pull_requests[1]).toMatchObject({ number: 13, branch: "architect/ticket-triage-v2", title: "Change: Friday recap", parts: [{ key: "recap", title: "Friday recap" }], run_id: "r1" });
  });

  it("nothing for a project that isn't from a repo, or a fix run", async () => {
    const { openPullRequest } = await import("@/server/pull-requests");
    db.tables.runs[0].kind = "fix";
    expect(await openPullRequest(db as never, "r1")).toBeNull();
    db.tables.runs[0].kind = "build";
    db.tables.projects[0].repo_full_name = null;
    expect(await openPullRequest(db as never, "r1")).toBeNull();
  });
});

describe("mergePullRequest", () => {
  beforeEach(() => {
    role = "owner";
    governance = true;
    db = new FakeDb({
      pull_requests: [{ id: PR, project_id: P, number: 13, branch: "architect/t-v2", base: "main", title: "Change: Friday recap", status: "open", parts: [{ key: "recap", title: "Friday recap" }], blueprint_id: "bp2", run_id: "r1", created_at: "2026-10-09T10:00:00Z", merged_at: null, merged_by: null, projects: { id: P, name: "ticket-triage", workspace_id: "ws-1" } }],
      items: [{ id: "i1", key: "recap", blueprint_id: "bp2", status: "built", checks: [{ description: "A recap every Friday", written_at: "2026-10-09T10:00:00Z" }] }],
      runs: [{ id: "r1", status: "done" }],
      approvals: [],
      audit_log: [],
    });
  });

  it("an Owner merges once checks pass: the PR is merged and audited", async () => {
    const { mergePullRequest } = await import("@/server/actions/pull-requests");
    expect(await mergePullRequest({ prId: PR })).toEqual({ ok: true, requested: false });
    expect(db.tables.pull_requests[0]).toMatchObject({ status: "merged", merged_by: "me" });
    expect(db.tables.audit_log[0]).toMatchObject({ action: "pr.merged", target: "ticket-triage PR #13" });
    expect(await mergePullRequest({ prId: PR })).toEqual({ ok: false, message: "Already merged into main." });
  });

  it("a Builder under governance asks instead: an approval for the push, nothing merged", async () => {
    role = "builder";
    const { mergePullRequest } = await import("@/server/actions/pull-requests");
    expect(await mergePullRequest({ prId: PR })).toEqual({ ok: true, requested: true });
    expect(db.tables.approvals[0]).toMatchObject({ kind: "push", title: "ticket-triage: push PR #13 to main", payload: { pr_id: PR } });
    expect(db.tables.pull_requests[0].status).toBe("open");
    governance = false;
    expect(await mergePullRequest({ prId: PR })).toEqual({ ok: true, requested: false });
  });

  it("refuses failing checks, Viewers and other workspaces' PRs", async () => {
    const { mergePullRequest } = await import("@/server/actions/pull-requests");
    db.tables.items[0].status = "paused";
    expect(await mergePullRequest({ prId: PR })).toMatchObject({ ok: false, message: expect.stringMatching(/^Its checks are failing/) });
    role = "viewer";
    expect(await mergePullRequest({ prId: PR })).toEqual({ ok: false, message: "Viewers can't merge pull requests." });
    role = "owner";
    (db.tables.pull_requests[0].projects as { workspace_id: string }).workspace_id = "ws-2";
    expect(await mergePullRequest({ prId: PR })).toEqual({ ok: false, message: "That pull request isn't here." });
  });
});

describe("disconnectGitHub", () => {
  it("Owners and Admins remove the installation from this workspace", async () => {
    db = new FakeDb({ github_installations: [{ workspace_id: "ws-1", installation_id: 5 }], audit_log: [] });
    const { disconnectGitHub } = await import("@/server/actions/import");
    role = "builder";
    expect(await disconnectGitHub({ installationId: 5 })).toEqual({ ok: false, message: "Only Owners and Admins can disconnect GitHub." });
    role = "admin";
    expect(await disconnectGitHub({ installationId: 5 })).toEqual({ ok: true });
    expect(db.tables.github_installations).toEqual([]);
  });
});
