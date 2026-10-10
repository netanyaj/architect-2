import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditBy, auditCsv, auditEntries, auditProject, filterAudit } from "@/lib/audit";
import type { Role } from "@/lib/db";
import { keyRows, keyValueProblem, missingForLive } from "@/lib/keys";
import { launchState } from "@/lib/launch";
import { budgetState, capProblem, permissionConfig, permissionsOf } from "@/lib/policies";
import { FakeDb } from "./fake-db";

let db: FakeDb;
let role: Role;
let governance: boolean;
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/db", () => ({ createAdminDb: () => db, createServerDb: async () => db }));
vi.mock("@/server/actions/launch", async (orig) => orig());
vi.mock("@/server/workspace", () => ({
  getAppContext: async () => {
    db.tables.workspaces = [{ id: "ws-1", governance_enabled: governance, credits_reset_on: "2099-01-01" }];
    return { user: { id: "me" }, name: "Sam Lee", role, workspace: { id: "ws-1", name: "Acme", governanceEnabled: governance }, memberships: [] };
  },
}));

const P = "11111111-1111-4111-8111-111111111111";

describe("permission rules (C-10)", () => {
  it("the seed's rules, with Live keys on until the rules are saved; saved rules round-trip", () => {
    expect(permissionsOf({ needs_approval: ["push_to_main", "production_deploy"] })).toEqual({ deploy: true, push: true, secrets: true });
    expect(permissionsOf(permissionConfig({ deploy: false, push: true, secrets: false }))).toEqual({ deploy: false, push: true, secrets: false });
    expect(permissionConfig({ deploy: true, push: false, secrets: true })).toEqual({ rules_version: 2, needs_approval: ["production_deploy", "live_secrets"] });
  });

  it("with the Live deploy rule off, a Builder goes live without asking", () => {
    const base = {
      parts: [{ id: "i", key: "a", title: "A", status: "built", provider: null, estimate: 10 }],
      deployments: [{ id: "d", environment: "staging" as const, version: 1, status: "live", createdAt: "2026-10-10T08:00:00Z", by: null }],
      envLive: { staging: true, production: false },
      currentVersion: 1,
      role: "builder" as Role,
      governance: true,
      liveRequested: false,
      testsPassed: 3,
    };
    expect(launchState(base).goLive.request).toBe(true);
    expect(launchState({ ...base, deployNeedsApproval: false }).goLive).toMatchObject({ request: false, label: "Go live" });
  });
});

describe("budgets (C-7)", () => {
  it("an alert from 80%, stopped at 100%, and sensible caps", () => {
    expect(budgetState(null, 5000).level).toBe("none");
    expect(budgetState(1000, 799)).toEqual({ level: "ok", percent: 79, left: 201 });
    expect(budgetState(1000, 800).level).toBe("alert");
    expect(budgetState(1000, 1000)).toEqual({ level: "stopped", percent: 100, left: 0 });
    expect(capProblem(5)).toMatch(/^Set a cap/);
    expect(capProblem(null)).toBeNull();
  });
});

describe("keys and passwords", () => {
  const env = [
    { name: "LYZR_API_KEY", why: "For the app's agents", test: true, team: true, live: true, service: null },
    { name: "SLACK_WEBHOOK_URL", why: "For Slack", test: false, team: false, live: false, service: "slack" },
    { name: "PARTNER_API_KEY", why: "From .env.example", test: false, team: false, live: false, service: null },
  ];
  it("provided, set by a person, waiting, or missing; only keys no connection provides hold Live", () => {
    const rows = keyRows(env, [{ name: "PARTNER_API_KEY", environment: "staging", status: "set", by: "Sam Lee", at: "2026-10-10T08:00:00Z" }]);
    expect(rows[0].cells.production).toEqual({ state: "auto", note: "Provided by Architect" });
    expect(rows[1].cells.production).toEqual({ state: "missing", note: "Connect Slack, or set it" });
    expect(rows[2].cells.staging).toMatchObject({ state: "set", by: "Sam Lee" });
    expect(missingForLive(rows)).toEqual(["PARTNER_API_KEY"]);
    expect(keyValueProblem("partner key", "x")).toMatch(/^Key names/);
    expect(keyValueProblem("PARTNER_API_KEY", "  ")).toBe("Type the value first.");
  });

  it("a key missing for Live holds Go live, not the team version", () => {
    const s = launchState({
      parts: [{ id: "i", key: "a", title: "A", status: "built", provider: null, estimate: 10 }],
      deployments: [],
      envLive: { staging: false, production: false },
      currentVersion: 1,
      role: "owner",
      governance: true,
      liveRequested: false,
      testsPassed: 3,
      keysMissingForLive: ["PARTNER_API_KEY"],
    });
    expect(s.rows.find((r) => r.kind === "keys")?.title).toBe("1 key isn't set for Live");
    expect(s.share.disabledReason).toBeUndefined();
    expect(s.progress).toBe("ready to share");
    const later = launchState({ ...s.repo, parts: [{ id: "i", key: "a", title: "A", status: "built", provider: null, estimate: 10 }], deployments: [{ id: "d", environment: "staging", version: 1, status: "live", createdAt: "x", by: null }], envLive: { staging: true, production: false }, currentVersion: 1, role: "owner", governance: true, liveRequested: false, testsPassed: 3, keysMissingForLive: ["PARTNER_API_KEY"] });
    expect(later.goLive.disabledReason).toBe("Set 1 key for Live first, in Keys and passwords.");
  });
});

describe("the audit log (C-6)", () => {
  const rows = [
    { id: 3, created_at: "2026-10-10T09:00:00Z", actor: "Sam Lee", action: "pr.merged", target: "ticket-triage PR #12", details: { branch: "x", simulated: true } },
    { id: 2, created_at: "2026-10-10T08:00:00Z", actor: "system", action: "run.settled", target: "Meeting Prep", details: { kind: "build" } },
    { id: 1, created_at: "2026-10-10T07:00:00Z", actor: "Sam Lee", action: "coding_agent.update", target: "Meeting Prep: Brief writer", details: { via: "mcp" } },
  ];
  it("who did it, which project, filters and CSV", () => {
    expect(auditBy(rows[1])).toBe("architect");
    expect(auditBy(rows[2])).toBe("coding_agent");
    expect(auditProject({ target: "ticket-triage PR #12", details: {} }, ["ticket-triage", "Meeting Prep"])).toBe("ticket-triage");
    const entries = auditEntries(rows, ["ticket-triage", "Meeting Prep"]);
    expect(entries[0]).toMatchObject({ what: "Merged a pull request", project: "ticket-triage", details: "branch: x" });
    expect(entries[1]).toMatchObject({ actor: "Architect", what: "Finished a build run", project: "Meeting Prep" });
    expect(filterAudit(entries, { project: "Meeting Prep" }).map((e) => e.id)).toEqual([2, 1]);
    expect(filterAudit(entries, { by: "coding_agent" }).map((e) => e.id)).toEqual([1]);
    expect(filterAudit(entries, { person: "Sam Lee", query: "merged" }).map((e) => e.id)).toEqual([3]);
    const csv = auditCsv(entries.slice(0, 1));
    expect(csv.split("\r\n")[0]).toBe("When (UTC),Who,Kind,What,Action,On,Project,Details");
    expect(csv).toContain("Sam Lee,Person,Merged a pull request,pr.merged,ticket-triage PR #12,ticket-triage,branch: x");
  });
});

describe("actions", () => {
  beforeEach(() => {
    role = "builder";
    governance = true;
    db = new FakeDb({
      projects: [{ id: P, name: "Lead brief", workspace_id: "ws-1", current_version: 2, status: "live" }],
      policies: [
        { id: "perm", workspace_id: "ws-1", kind: "permission", config: { needs_approval: ["push_to_main", "production_deploy"] } },
        { id: "bud", workspace_id: "ws-1", kind: "budget", config: { monthly_cap: 100 } },
      ],
      project_keys: [],
      approvals: [],
      audit_log: [],
      usage_ledger: [{ workspace_id: "ws-1", project_id: P, credits: 120, created_at: "2099-01-01T00:00:00Z" }],
      deployments: [{ id: "d1", project_id: P, environment: "production", blueprint_version: 2, status: "live", created_at: "2026-10-09T00:00:00Z" }],
      environments: [{ id: "e1", project_id: P, name: "production", status: "live" }],
    });
  });

  it("a key's value is never stored; a Builder's Live key waits for an admin, who approves it", async () => {
    const { setProjectKey } = await import("@/server/actions/keys");
    expect(await setProjectKey({ projectId: P, name: "PARTNER_API_KEY", environment: "staging", value: "s3cret-value" })).toEqual({ ok: true, waiting: false });
    expect(await setProjectKey({ projectId: P, name: "PARTNER_API_KEY", environment: "production", value: "s3cret-value" })).toEqual({ ok: true, waiting: true });
    expect(JSON.stringify(db.tables)).not.toContain("s3cret-value");
    expect(db.tables.project_keys.map((k) => [k.environment, k.status, k.set_by_name])).toEqual([
      ["staging", "set", "Sam Lee"],
      ["production", "waiting", "Sam Lee"],
    ]);
    expect(db.tables.approvals[0]).toMatchObject({ kind: "secret", status: "waiting", payload: expect.objectContaining({ key: "PARTNER_API_KEY" }) });
    expect(await setProjectKey({ projectId: P, name: "PARTNER_API_KEY", environment: "production", value: "again" })).toEqual({ ok: false, message: "This key is already waiting for an Owner or Admin." });

    role = "admin";
    db.tables.approvals[0].id = "33333333-3333-4333-8333-333333333333";
    db.tables.project_keys[1].approval_id = "33333333-3333-4333-8333-333333333333";
    const { decideApproval } = await import("@/server/actions/approvals");
    expect(await decideApproval({ approvalId: "33333333-3333-4333-8333-333333333333", decision: "approve" })).toMatchObject({ ok: true });
    expect(db.tables.project_keys[1].status).toBe("set");
    role = "viewer";
    expect(await setProjectKey({ projectId: P, name: "X_KEY", environment: "preview", value: "v" })).toMatchObject({ ok: false });
  });

  it("at 100% of the cap paid actions stop; a Builder asks to raise it and an admin's approval raises it", async () => {
    const { budgetRefusal } = await import("@/server/policy");
    await import("@/server/workspace").then((w) => w.getAppContext());
    expect(await budgetRefusal(db as never, "ws-1")).toMatch(/^Your organisation has used its monthly credit cap/);
    const { requestCapRaise } = await import("@/server/actions/policies");
    expect(await requestCapRaise({ cap: 90 })).toMatchObject({ ok: false, message: expect.stringMatching(/^Ask for more than the cap now/) });
    expect(await requestCapRaise({ cap: 300, why: "Quarter-end demos" })).toEqual({ ok: true });
    expect(db.tables.approvals[0]).toMatchObject({ kind: "budget", payload: expect.objectContaining({ cap: 300, current: 100 }) });
    role = "admin";
    db.tables.approvals[0].id = "44444444-4444-4444-8444-444444444444";
    const { decideApproval } = await import("@/server/actions/approvals");
    expect(await decideApproval({ approvalId: "44444444-4444-4444-8444-444444444444", decision: "approve" })).toMatchObject({ ok: true });
    expect(db.tables.policies[1].config).toEqual({ monthly_cap: 300 });
    expect(await budgetRefusal(db as never, "ws-1")).toBeUndefined();
  });

  it("Take offline keeps the version; Go live again brings it back; Builders can't under the Live rule", async () => {
    const { bringBackLive, takeOffline } = await import("@/server/actions/launch");
    expect(await takeOffline({ projectId: P })).toEqual({ ok: false, message: "Only Owners and Admins can take Live offline or bring it back." });
    role = "admin";
    expect(await takeOffline({ projectId: P })).toEqual({ ok: true });
    expect(db.tables.deployments[0].status).toBe("offline");
    expect(db.tables.environments[0].status).toBe("offline");
    expect(db.tables.projects[0].status).toBe("built");
    expect(await bringBackLive({ projectId: P })).toEqual({ ok: true, version: 2 });
    expect(db.tables.deployments.find((d) => d.status === "live")).toMatchObject({ environment: "production", blueprint_version: 2 });
    expect(db.tables.projects[0].status).toBe("live");
    expect(db.tables.audit_log.map((a) => a.action)).toEqual(["deploy.offline", "deploy.live"]);
  });
});
