import { beforeEach, describe, expect, it, vi } from "vitest";
import { approvalView, decisionProblem, hostAllowed, queueRules, ruleTitle, scopeSummary, type ApprovalInput } from "@/lib/approvals";
import type { Role } from "@/lib/db";
import { launchState } from "@/lib/launch";
import { FakeDb } from "./fake-db";

let db: FakeDb;
let role: Role;
let governance: boolean;
const goLive = vi.fn();
const mergePullRequest = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/db", () => ({ createAdminDb: () => db, createServerDb: async () => db }));
vi.mock("@/server/actions/launch", () => ({ goLive: (i: unknown) => goLive(i) }));
vi.mock("@/server/actions/pull-requests", () => ({ mergePullRequest: (i: unknown) => mergePullRequest(i) }));
vi.mock("@/server/workspace", () => ({
  getAppContext: async () => ({ user: { id: "me" }, name: "Jordan Lee", role, workspace: { id: "ws-1", name: "Acme", governanceEnabled: governance }, memberships: [] }),
}));

const P = "11111111-1111-4111-8111-111111111111";
const Q = "22222222-2222-4222-8222-222222222222";
const A = "33333333-3333-4333-8333-333333333333";

const base: ApprovalInput = {
  id: A,
  kind: "connector",
  title: "Hubspot connector",
  status: "waiting",
  createdAt: "2026-10-10T08:00:00Z",
  decidedAt: null,
  decidedByName: null,
  reason: null,
  project: { id: P, name: "Lead scorer" },
  requestedByName: "Morgan Lee",
  payload: { provider: "hubspot", item_title: "HubSpot contact lookup", why: "Look up each attendee's company" },
  egressHosts: ["slack.com", "googleapis.com"],
};

describe("approval views (screen 11)", () => {
  it("an app for one project: approve for it, or allow it everywhere; the data-flow strip flags the host", () => {
    const v = approvalView(base);
    expect(v.title).toBe("Add HubSpot to Lead scorer");
    expect(v.meta).toBe("Morgan · needed for “HubSpot contact lookup”");
    expect(v.ruleLine).toBe("New tool · rule: tools not on your approved list need an admin");
    expect(v.facts.map((f) => f.label)).toEqual(["Asked by", "Why", "Access"]);
    expect(v.facts[0].value).toBe("Morgan Lee, from the plan part “HubSpot contact lookup”");
    expect(v.actions.map((a) => [a.scope, a.label])).toEqual([
      ["once", "Approve for this project"],
      ["rule", "Approve and allow everywhere"],
    ]);
    expect(v.flow).toEqual({ from: "Lead scorer", data: "contact details", host: "api.hubapi.com", allowed: false });
    expect(v.decided).toBeNull();
  });

  it("an app asked for the whole workspace can only be allowed everywhere", () => {
    const v = approvalView({ ...base, project: null, payload: { provider: "hubspot" } });
    expect(v.title).toBe("Allow HubSpot in the workspace");
    expect(v.actions.map((a) => a.scope)).toEqual(["rule"]);
  });

  it("Live deploys, pushes and tokens", () => {
    const deploy = approvalView({ ...base, kind: "deploy", title: "ticket-triage: Production deploy", project: { id: P, name: "ticket-triage" }, requestedByName: "Sam", payload: { version: 2 }, works: { done: 5, total: 6 } });
    expect(deploy.title).toBe("Make ticket-triage live");
    expect(deploy.meta).toBe("Sam · 5 of 6 parts work");
    expect(deploy.actions.map((a) => a.label)).toEqual(["Approve", "Approve and allow for ticket-triage"]);
    expect(deploy.flow).toBeNull();

    const push = approvalView({ ...base, kind: "push", title: "x: push PR #13 to main", project: { id: P, name: "ticket-triage" }, payload: { pr_number: 13, branch: "architect/ticket-triage-v2" } });
    expect(push.title).toBe("Push PR #13 of ticket-triage to main");
    expect(push.facts.at(-1)).toEqual({ label: "Branch", value: "architect/ticket-triage-v2 → main" });

    const token = approvalView({ ...base, kind: "token", project: { id: P, name: "Meeting Prep" }, requestedByName: "Sam", payload: { token_name: "Claude Code", scopes: ["read_plan", "change_parts"] } });
    expect(token.title).toBe("Let Claude Code edit Meeting Prep");
    expect(token.meta).toBe("Sam · read and propose changes only");
    expect(token.actions.map((a) => a.scope)).toEqual(["once"]);
  });

  it("a decided request says who, when, and whether a rule was made", () => {
    const v = approvalView({ ...base, status: "approved", decidedAt: "2026-10-10T09:00:00Z", decidedByName: "Jordan Lee", reason: "Sales needs it", payload: { ...base.payload, decision_scope: "rule" } });
    expect(v.decided).toEqual({ line: "Approved by Jordan Lee · 10 Oct · allowed from now on", reason: "Sales needs it" });
  });

  it("small rules: hosts, scopes, reasons, rule titles", () => {
    expect(hostAllowed("www.googleapis.com", ["googleapis.com"])).toBe(true);
    expect(hostAllowed("evilgoogleapis.com", ["googleapis.com"])).toBe(false);
    expect(scopeSummary(["read_plan", "change_parts", "run", "pull_requests", "approvals"])).toBe("read, propose changes, run tests, open pull requests and ask for approval");
    expect(decisionProblem("reject", "  ")).toMatch(/^Say why/);
    expect(decisionProblem("approve", "")).toBeNull();
    expect(decisionProblem("approve", "x".repeat(501))).toMatch(/500/);
    expect(ruleTitle({ action: "connector", projectName: null, target: "hubspot" })).toBe("HubSpot allowed in every project");
    expect(ruleTitle({ action: "production_deploy", projectName: "ticket-triage", target: null })).toBe("ticket-triage: Live deploys don't need an admin");
    const q = queueRules([
      { kind: "permission", config: { needs_approval: ["push_to_main", "production_deploy"] } },
      { kind: "connectors", config: { allow: ["slack"], deny: ["hubspot"] } },
    ]);
    expect(q.map((r) => r.title)).toEqual([
      "Live deploys need an Owner or Admin",
      "Pushes to main need an Owner or Admin",
      "Coding-agent tokens need an Owner or Admin",
      "Apps not on your allowed list need an Owner or Admin",
    ]);
    expect(q[3].detail).toBe("Allowed: Slack. Not allowed: HubSpot.");
  });
});

describe("deciding a request", () => {
  beforeEach(() => {
    role = "admin";
    governance = true;
    goLive.mockReset().mockResolvedValue({ ok: true, requested: false });
    mergePullRequest.mockReset().mockResolvedValue({ ok: true, requested: false });
    db = new FakeDb({
      projects: [
        { id: P, name: "Lead scorer", workspace_id: "ws-1" },
        { id: Q, name: "Meeting Prep", workspace_id: "ws-1" },
      ],
      approvals: [
        { id: A, workspace_id: "ws-1", project_id: P, kind: "connector", title: "Hubspot connector", status: "waiting", payload: { provider: "hubspot", item_key: "crm" } },
        { id: "other", workspace_id: "ws-1", project_id: Q, kind: "connector", title: "Hubspot connector", status: "waiting", payload: { provider: "hubspot" } },
      ],
      items: [
        { id: "i1", project_id: P, provider: "hubspot", status: "needs_approval" },
        { id: "i2", project_id: Q, provider: "hubspot", status: "needs_approval" },
        { id: "i3", project_id: P, provider: "slack", status: "built" },
      ],
      policies: [{ id: "pol", workspace_id: "ws-1", kind: "connectors", config: { allow: ["slack"], deny: ["hubspot"] } }],
      runs: [],
      allow_rules: [],
      audit_log: [],
    });
  });

  async function decide(input: Parameters<typeof import("@/server/actions/approvals").decideApproval>[0]) {
    const { decideApproval } = await import("@/server/actions/approvals");
    return decideApproval(input);
  }

  it("only Owners and Admins, only with governance on, and a reason to reject", async () => {
    role = "builder";
    expect(await decide({ approvalId: A, decision: "approve" })).toEqual({ ok: false, message: "Only Owners and Admins decide on requests." });
    role = "admin";
    governance = false;
    expect(await decide({ approvalId: A, decision: "approve" })).toMatchObject({ ok: false, message: expect.stringMatching(/^Governance is off/) });
    governance = true;
    expect(await decide({ approvalId: A, decision: "reject", reason: " " })).toMatchObject({ ok: false, message: expect.stringMatching(/^Say why/) });
    expect(await decide({ approvalId: "nope", decision: "approve" })).toEqual({ ok: false, message: "That request isn't in this workspace." });
    db.tables.runs.push({ id: "r", project_id: P, status: "running" });
    expect(await decide({ approvalId: A, decision: "approve" })).toEqual({ ok: false, message: "A build is running on Lead scorer. Decide when it finishes." });
    expect(db.tables.approvals[0].status).toBe("waiting");
  });

  it("approve for this project: the part asks to connect, the decision and an audit row are recorded, no rule", async () => {
    expect(await decide({ approvalId: A, decision: "approve", reason: "Sales needs it" })).toEqual({ ok: true, note: undefined });
    expect(db.tables.approvals[0]).toMatchObject({ status: "approved", decided_by: "me", decided_by_name: "Jordan Lee", reason: "Sales needs it" });
    expect(db.tables.items.find((i) => i.id === "i1")).toMatchObject({ status: "needs_connection", status_detail: "Approved · connect HubSpot to use it" });
    expect(db.tables.items.find((i) => i.id === "i2")).toMatchObject({ status: "needs_approval" });
    expect(db.tables.allow_rules).toHaveLength(0);
    expect(db.tables.audit_log.map((r) => r.action)).toEqual(["approval.approved"]);
    expect(await decide({ approvalId: A, decision: "reject", reason: "x" })).toEqual({ ok: false, message: "Jordan Lee already approved this request. It's in Decided." });

    // The build and Connect now treat HubSpot as allowed for this project only.
    const { deniedForProject } = await import("@/server/policy");
    expect(await deniedForProject(db as never, "ws-1", P)).toEqual([]);
    expect(await deniedForProject(db as never, "ws-1", Q)).toEqual(["hubspot"]);
  });

  it("approve and allow everywhere: a rule, the policy, every waiting part and request of that app", async () => {
    expect(await decide({ approvalId: A, decision: "approve", scope: "rule" })).toMatchObject({ ok: true });
    expect(db.tables.allow_rules).toEqual([expect.objectContaining({ workspace_id: "ws-1", action: "connector", project_id: null, target: "hubspot", approval_id: A, created_by_name: "Jordan Lee" })]);
    expect(db.tables.policies[0].config).toEqual({ allow: ["slack", "hubspot"], deny: [] });
    expect(db.tables.items.filter((i) => i.provider === "hubspot").map((i) => i.status)).toEqual(["needs_connection", "needs_connection"]);
    expect(db.tables.approvals[1]).toMatchObject({ status: "approved", reason: "Covered by the rule allowing HubSpot everywhere" });
    expect(db.tables.audit_log.map((r) => r.action)).toEqual(["approval.approved", "rule.created"]);

    // Removing the rule puts HubSpot back on the not-allowed list; the rule stays, marked removed.
    const { removeAllowRule } = await import("@/server/actions/approvals");
    const ruleId = "44444444-4444-4444-8444-444444444444";
    db.tables.allow_rules[0].id = ruleId;
    db.tables.allow_rules[0].removed_at = null;
    expect(await removeAllowRule({ ruleId })).toEqual({ ok: true });
    expect(db.tables.allow_rules[0].removed_at).toEqual(expect.any(String));
    expect(db.tables.policies[0].config).toEqual({ allow: ["slack"], deny: ["hubspot"] });
    expect(db.tables.audit_log.at(-1)).toMatchObject({ action: "rule.removed", target: "HubSpot" });
  });

  it("reject: the part is set aside with the reason, the rest of the project carries on", async () => {
    expect(await decide({ approvalId: A, decision: "reject", reason: "Use the CRM export instead" })).toMatchObject({ ok: true });
    expect(db.tables.items.find((i) => i.id === "i1")).toMatchObject({ status: "deferred", status_detail: "Not approved: Use the CRM export instead" });
    expect(db.tables.items.find((i) => i.id === "i3")).toMatchObject({ status: "built" });
    expect(db.tables.audit_log[0]).toMatchObject({ action: "approval.rejected", details: expect.objectContaining({ reason: "Use the CRM export instead" }) });
  });

  it("Live deploy: approving deploys it; if it can't go yet, the decision stands and says why", async () => {
    db.tables.approvals.push({ id: "dep", workspace_id: "ws-1", project_id: P, kind: "deploy", title: "Lead scorer: Live deploy of v1", status: "waiting", payload: { version: 1, requested_by_name: "Sam Lee" } });
    db.tables.items.push({ id: "i4", project_id: P, provider: null, status: "needs_approval" });
    db.tables.checks = [];
    db.tables.proofs = [];
    expect(await decide({ approvalId: "dep", decision: "approve" })).toEqual({ ok: true, note: undefined });
    expect(goLive).toHaveBeenCalledWith({ projectId: P });
    expect(db.tables.items.find((i) => i.id === "i4")).toMatchObject({ status: "built" });
    expect(db.tables.proofs[0]).toMatchObject({ item_id: "i4", result: "pass", summary: "Approved by Jordan Lee" });

    db.tables.approvals.push({ id: "dep2", workspace_id: "ws-1", project_id: P, kind: "deploy", title: "x", status: "waiting", payload: { requested_by_name: "Sam Lee" } });
    goLive.mockResolvedValueOnce({ ok: false, message: "Share this version with your team first. Live always follows the team version." });
    expect(await decide({ approvalId: "dep2", decision: "approve", scope: "rule" })).toEqual({
      ok: true,
      note: "Approved. Lead scorer isn't live yet: Share this version with your team first. Live always follows the team version. Sam can go live without asking again.",
    });
    expect(db.tables.allow_rules).toEqual([expect.objectContaining({ action: "production_deploy", project_id: P, target: null })]);
  });

  it("push to main: approving merges; a token: approving turns it on, rejecting revokes it", async () => {
    db.tables.approvals.push({ id: "push", workspace_id: "ws-1", project_id: P, kind: "push", title: "x", status: "waiting", payload: { pr_id: "pr-1" } });
    expect(await decide({ approvalId: "push", decision: "approve" })).toMatchObject({ ok: true });
    expect(mergePullRequest).toHaveBeenCalledWith({ prId: "pr-1" });

    db.tables.approvals.push({ id: "tok", workspace_id: "ws-1", project_id: P, kind: "token", title: "x", status: "waiting", payload: {} });
    db.tables.approvals.push({ id: "tok2", workspace_id: "ws-1", project_id: P, kind: "token", title: "y", status: "waiting", payload: {} });
    db.tables.project_tokens = [
      { id: "t1", approval_id: "tok", status: "waiting" },
      { id: "t2", approval_id: "tok2", status: "waiting" },
    ];
    expect(await decide({ approvalId: "tok", decision: "approve", scope: "rule" })).toEqual({ ok: false, message: "This request can only be approved once." });
    expect(await decide({ approvalId: "tok", decision: "approve" })).toMatchObject({ ok: true });
    expect(await decide({ approvalId: "tok2", decision: "reject", reason: "Too broad" })).toMatchObject({ ok: true });
    expect(db.tables.project_tokens.map((t) => t.status)).toEqual(["active", "revoked"]);
  });
});

describe("Launch after a decision", () => {
  const input = {
    parts: [{ id: "i", key: "a", title: "A", status: "built", provider: null, estimate: 10 }],
    deployments: [{ id: "d", environment: "staging" as const, version: 2, status: "live", createdAt: "2026-10-10T08:00:00Z", by: null }],
    envLive: { staging: true, production: false },
    currentVersion: 2,
    role: "builder" as Role,
    governance: true,
    liveRequested: false,
    testsPassed: 3,
  };

  it("an approval for this version, or an allow-rule, lets a Builder go live; a rejection asks again", () => {
    expect(launchState(input).goLive).toMatchObject({ label: "Ask to go live", request: true });
    const approved = launchState({ ...input, liveDecisions: [{ status: "approved", by: "Jordan", reason: null, version: 2 }] });
    expect(approved.goLive).toMatchObject({ label: "Go live", request: false });
    expect(approved.live.decision).toMatchObject({ status: "approved", by: "Jordan" });
    // An approval for an older version doesn't count for this one.
    expect(launchState({ ...input, liveDecisions: [{ status: "approved", by: "Jordan", reason: null, version: 1 }] }).goLive.request).toBe(true);
    const rejected = launchState({ ...input, liveDecisions: [{ status: "rejected", by: "Jordan", reason: "Not before Monday", version: 2 }] });
    expect(rejected.goLive).toMatchObject({ request: true, disabledReason: undefined });
    expect(rejected.live.decision?.reason).toBe("Not before Monday");
    expect(launchState({ ...input, liveRule: true }).goLive.request).toBe(false);
  });
});
