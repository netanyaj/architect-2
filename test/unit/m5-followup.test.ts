import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiKeyEnvName, apiKeyProblem, apiKeyServiceId } from "@/lib/api-keys";
import type { Role } from "@/lib/db";
import { envKeys } from "@/lib/dev-view";
import { analyzeRepo } from "@/lib/repo-analysis";
import { whatsNotDone } from "@/lib/readiness";
import { launchState } from "@/lib/launch";
import { FakeDb } from "./fake-db";

/* M5 follow-up (gap analysis, 11 Oct): API key connections, and the rest of the build list below. */

let db: FakeDb;
let role: Role;
let governance = true;
let plan: "free" | "starter" | "pro" | "enterprise" = "enterprise";
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/db", () => ({ createAdminDb: () => db, createServerDb: async () => db }));
vi.mock("@/server/actions/launch", async (orig) => ({ ...(await orig<typeof import("@/server/actions/launch")>()), goLive: async () => ({ ok: true }) }));
vi.mock("@/server/actions/pull-requests", () => ({ mergePullRequest: async () => ({ ok: true }) }));
const lyzr = { configured: true, list: vi.fn() };
vi.mock("@/server/lyzr", () => ({ lyzrConfigured: () => ({ perAgent: lyzr.configured, shared: false }), listLyzrAgents: () => lyzr.list() }));
vi.mock("@/server/workspace", () => ({
  getAppContext: async () => ({ user: { id: "me" }, name: "Rita", role, workspace: { id: "ws-1", name: "Acme", governanceEnabled: governance, plan }, memberships: [] }),
}));

describe("API key connections (BL-9)", () => {
  beforeEach(() => {
    role = "builder";
    governance = true;
    db = new FakeDb({
      workspaces: [{ id: "ws-1", governance_enabled: true }],
      policies: [{ workspace_id: "ws-1", kind: "connectors", config: { allow: ["slack", "clearbit"] } }],
      connections: [{ id: "c-slack", workspace_id: "ws-1", provider: "slack", kind: "oauth", status: "connected" }],
      allow_rules: [],
      approvals: [],
      projects: [{ id: "p-1", workspace_id: "ws-1" }],
      items: [{ id: "i-1", project_id: "p-1", provider: "clearbit", status: "needs_connection" }],
      audit_log: [],
    });
  });

  it("names, ids and the key a part gets", () => {
    expect(apiKeyServiceId(" Open Weather ")).toBe("open_weather");
    expect(apiKeyEnvName("clearbit")).toBe("CLEARBIT_API_KEY");
    expect(apiKeyProblem("C", "x")).toMatch(/2 to 40/);
    expect(apiKeyProblem("Clearbit", "  ")).toBe("Paste the key first.");
    expect(apiKeyProblem("Clearbit", "sk_live_1")).toBeNull();
  });

  it("records Set, by whom and when, never the value; its parts stop waiting; the audit row has no value", async () => {
    const { setApiKey } = await import("@/server/actions/connections");
    expect(await setApiKey({ name: "Clearbit", value: "sk_live_secret" })).toEqual({ ok: true, provider: "clearbit" });
    const row = db.tables.connections.find((c) => c.provider === "clearbit")!;
    expect(row).toMatchObject({ kind: "api_key", status: "connected", set_by_name: "Rita" });
    expect(JSON.stringify(db.tables)).not.toContain("sk_live_secret");
    expect(db.tables.items[0].status).toBe("built");
    expect(db.tables.audit_log[0]).toMatchObject({ action: "connection.api_key_set", target: "clearbit", details: { simulated: true } });
    // Replacing keeps one row.
    expect((await setApiKey({ name: "clearbit", value: "another" })).ok).toBe(true);
    expect(db.tables.connections.filter((c) => c.provider === "clearbit")).toHaveLength(1);
    expect(db.tables.audit_log[1].action).toBe("connection.api_key_replaced");
  });

  it("refuses Viewers, apps the policy doesn't allow, and a service that signs in instead", async () => {
    const { setApiKey } = await import("@/server/actions/connections");
    expect(await setApiKey({ name: "Slack", value: "x" })).toEqual({ ok: false, message: "Slack connects by signing in, not with a key. Use Connect Slack instead." });
    expect(await setApiKey({ name: "Apollo", value: "x" })).toEqual({ ok: false, message: "Apollo isn't on your organisation's allowed apps. An Owner or Admin can add it in Governance › Apps." });
    role = "viewer";
    expect((await setApiKey({ name: "Clearbit", value: "x" })).ok).toBe(false);
  });

  it("Remove leaves the connection, Not set, so the parts show they need it; only API keys can be removed this way", async () => {
    const K = "33333333-3333-4333-8333-333333333333";
    db.tables.connections.push({ id: K, workspace_id: "ws-1", provider: "clearbit", kind: "api_key", status: "connected", set_by_name: "Jordan (IT)", set_at: "2026-10-08T10:00:00Z" });
    const { clearApiKey } = await import("@/server/actions/connections");
    expect(await clearApiKey({ connectionId: "c-slack" })).toEqual({ ok: false, message: "That key isn't in this workspace." });
    expect(await clearApiKey({ connectionId: K })).toEqual({ ok: true });
    expect(db.tables.connections.find((c) => c.id === K)).toMatchObject({ status: "missing", set_by_name: null, set_at: null });
    expect(db.tables.audit_log.at(-1)).toMatchObject({ action: "connection.api_key_removed", target: "clearbit" });
  });

  it("a part calling a keyed service needs <SERVICE>_API_KEY, provided by the connection", () => {
    const keys = envKeys({ parts: [{ key: "lookup", title: "Company size lookup", grp: "data", status: "built", provider: "clearbit" } as never], repoKeys: null, connected: ["clearbit"], envLive: { staging: false, production: true } });
    expect(keys).toContainEqual({ name: "CLEARBIT_API_KEY", why: "For Clearbit", test: true, team: false, live: true, service: "clearbit" });
  });

  it("a webhook signing secret is set by a person, not by connecting the app", () => {
    const a = analyzeRepo({ paths: [".env.example"], files: { ".env.example": "ZENDESK_API_TOKEN=\nZENDESK_WEBHOOK_SECRET=\nSTRIPE_SIGNING_SECRET=\n" } });
    expect(a.keys).toEqual([
      { name: "ZENDESK_API_TOKEN", service: "zendesk", lyzrInstead: false },
      { name: "ZENDESK_WEBHOOK_SECRET", service: null, lyzrInstead: false },
      { name: "STRIPE_SIGNING_SECRET", service: null, lyzrInstead: false },
    ]);
  });
});

describe("editing a built part's check (A-7)", () => {
  const I = "44444444-4444-4444-8444-444444444444";
  const P = "55555555-5555-4555-8555-555555555555";
  const seed = (over: Record<string, unknown> = {}, budget: number | null = null) =>
    new FakeDb({
      workspaces: [{ id: "ws-1", governance_enabled: false }],
      policies: [],
      items: [{ id: I, key: "brief-writer", title: "Brief writer", status: "built", proved_when: "Done when the brief is under 200 words and names every attendee", estimate_likely: 16, project_id: P, blueprint_id: "bp", projects: { id: P, name: "Meeting Prep", workspace_id: "ws-1", budget_credits: budget }, ...over }],
      checks: [{ id: "c-1", item_id: I, kind: "eval", description: "old", written_by: "verifier", written_at: "2026-10-01T09:00:00Z" }],
      runs: [],
      usage_ledger: [{ project_id: P, credits: 100 }],
      events: [],
      proofs: [],
      audit_log: [],
    });
  beforeEach(() => {
    role = "builder";
    db = seed();
  });

  it("the estimate comes first and spends nothing", async () => {
    const { previewCheckEdit } = await import("@/server/actions/checks");
    const r = await previewCheckEdit({ itemId: I, provedWhen: "Done when the brief is under 200 words, names every attendee and lists open deals" });
    expect(r).toEqual({ ok: true, estimate: { low: 2, likely: 3, high: 5, seconds: 10 }, weakens: false });
    expect(db.tables.usage_ledger).toHaveLength(1);
    expect(db.tables.checks).toHaveLength(1);
  });

  it("Re-run records a new check by the person, charges the estimate, and the checker runs it again", async () => {
    const { editCheck } = await import("@/server/actions/checks");
    const after = "Done when the brief is under 200 words, names every attendee and lists open deals";
    expect(await editCheck({ itemId: I, provedWhen: after })).toEqual({ ok: true, credits: 3 });
    expect(db.tables.checks.at(-1)).toMatchObject({ item_id: I, description: after, written_by: "Rita", locked: true });
    expect(db.tables.items[0]).toMatchObject({ proved_when: after, status: "building", status_detail: "Re-running its check · check edited by Rita" });
    expect(db.tables.usage_ledger.at(-1)).toMatchObject({ kind: "change", credits: 3, note: "Check re-run · Brief writer" });
    expect(db.tables.events[0]).toMatchObject({ type: "check.edited", actor: "user" });
    expect(db.tables.audit_log[0]).toMatchObject({ action: "check.edited", details: { weakened: false, credits: 3 } });

    // Settled when its time is up: the part works again, with a proof against the new check.
    const { settleCodeEdits } = await import("@/server/code-edits");
    (db.tables.events[0].payload as { settle_at: string }).settle_at = new Date(Date.now() - 1000).toISOString();
    await settleCodeEdits(db as never, P);
    expect(db.tables.items[0]).toMatchObject({ status: "built", status_detail: null });
    expect(db.tables.proofs[0]).toMatchObject({ result: "pass", log: "Edited check", summary: "Passed the edited check against the code already built" });
  });

  it("a weaker check needs a reason, saved on the part", async () => {
    const { editCheck, previewCheckEdit } = await import("@/server/actions/checks");
    const weaker = "Done when the brief is under 300 words";
    expect(await previewCheckEdit({ itemId: I, provedWhen: weaker })).toMatchObject({ ok: true, weakens: true });
    expect(await editCheck({ itemId: I, provedWhen: weaker })).toEqual({ ok: false, message: "This check asks for less than before. Say why; it's saved on the part." });
    expect((await editCheck({ itemId: I, provedWhen: weaker, reason: "Briefs read on phones" })).ok).toBe(true);
    expect(db.tables.items[0].drop_reason).toBe("Weakened: Briefs read on phones");
  });

  it("refuses Viewers, parts not built, a build running, no change, and going past the budget", async () => {
    const { editCheck, previewCheckEdit } = await import("@/server/actions/checks");
    const next = "Done when the brief is under 150 words and names every attendee";
    expect((await previewCheckEdit({ itemId: I, provedWhen: "Done when the brief is under 200 words and names every attendee" })).ok).toBe(false);
    db = seed({}, 101);
    expect(await previewCheckEdit({ itemId: I, provedWhen: next })).toEqual({ ok: false, message: "That would go past the project's budget. Raise the budget first." });
    db = seed({ status: "agreed" });
    expect(await previewCheckEdit({ itemId: I, provedWhen: next })).toEqual({ ok: false, message: "Only a part that's built has a check to run again. Change it in the plan instead." });
    db = seed();
    db.tables.runs.push({ id: "r", project_id: P, status: "running" });
    expect(await editCheck({ itemId: I, provedWhen: next })).toEqual({ ok: false, message: "A build is running. Edit the check when it finishes." });
    role = "viewer";
    expect(await editCheck({ itemId: I, provedWhen: next })).toEqual({ ok: false, message: "Viewers can read checks but can't change them." });
  });
});

describe("readiness: what's not done (A-10) and the named pre-publish checks (BL-13)", () => {
  it("every part that doesn't work, with its reason, blocked first; working and dropped parts aren't listed", () => {
    const p = (key: string, status: string, extra: Record<string, unknown> = {}) => ({ key, title: key, status, ...extra });
    expect(
      whatsNotDone([
        p("a", "built"),
        p("b", "agreed"),
        p("c", "needs_connection", { provider: "gmail" }),
        p("d", "paused"),
        p("e", "needs_approval", { provider: "hubspot" }),
        p("f", "building", { statusDetail: "Re-running its check · check edited by Rita" }),
        p("g", "deferred"),
        p("h", "dropped"),
        p("i", "sample_data"),
        p("j", "needs_approval", { statusDetail: "IT admin reviews" }),
      ]),
    ).toEqual([
      { key: "d", title: "d", status: "blocked", reason: "Blocked: its check failed 3 times. Open it to decide" },
      { key: "c", title: "c", status: "attention", reason: "Works with sample data until you connect Gmail" },
      { key: "i", title: "i", status: "attention", reason: "Uses sample data: add your real data, or leave it out" },
      { key: "e", title: "e", status: "approval", reason: "Waiting for an Owner or Admin to approve HubSpot" },
      { key: "j", title: "j", status: "approval", reason: "Waiting for an Owner or Admin's approval" },
      { key: "f", title: "f", status: "building", reason: "Re-running its check · check edited by Rita" },
      { key: "b", title: "b", status: "todo", reason: "Not built yet" },
      { key: "g", title: "g", status: "todo", reason: "Set aside: not in this version" },
    ]);
  });

  it("the checklist names tests, the security scan and personal data as separate checks", () => {
    const s = launchState({ deployments: [], envLive: { staging: false, production: false }, currentVersion: 1, role: "owner", governance: true, liveRequested: false, testsPassed: 4, parts: [{ id: "1", key: "a", title: "A", status: "built", provider: null, estimate: 1 }] });
    expect(s.rows.filter((r) => r.kind === "fine").map((r) => r.title)).toEqual(["Tests passed", "Security scan passed", "Personal data is hidden in logs"]);
    expect(s.toFix).toBe(0);
  });
});

describe("the external-calls rule (C-10)", () => {
  const P = "66666666-6666-4666-8666-666666666666";
  const seed = (permission: Record<string, unknown> = { needs_approval: ["production_deploy"] }) =>
    new FakeDb({
      workspaces: [{ id: "ws-1", governance_enabled: true }],
      policies: [{ workspace_id: "ws-1", kind: "permission", config: permission }],
      connections: [{ workspace_id: "ws-1", provider: "clearbit", kind: "api_key", status: "connected" }],
      projects: [{ id: P, name: "Lead scorer", workspace_id: "ws-1" }],
      blueprints: [{ id: "bp", project_id: P, version: 1 }],
      items: [
        { blueprint_id: "bp", project_id: P, title: "Company size lookup", status: "built", provider: "clearbit" },
        { blueprint_id: "bp", project_id: P, title: "Top 5 posted to #sales", status: "built", provider: "slack" },
      ],
      allow_rules: [],
      approvals: [],
      audit_log: [],
    });
  beforeEach(() => {
    governance = true;
    db = seed();
  });

  it("a part calling a keyed service is held for Live until allowed; the team version isn't held", async () => {
    const { externalCallHolds, loadPolicies } = await import("@/server/policy");
    const holds = await externalCallHolds(db as never, "ws-1", P, db.tables.items as never, await loadPolicies(db as never, "ws-1"));
    expect(holds).toEqual([{ provider: "clearbit", parts: ["Company size lookup"], waiting: false }]);
    const s = launchState({ deployments: [], envLive: { staging: false, production: false }, currentVersion: 1, role: "owner", governance: true, liveRequested: false, testsPassed: 3, externalCalls: holds, parts: [{ id: "1", key: "a", title: "A", status: "built", provider: null, estimate: 1 }] });
    expect(s.rows[0]).toMatchObject({ kind: "external", status: "approval", title: "Clearbit is called with a key: an Owner or Admin allows it first" });
    expect(s.share.disabledReason).toBeUndefined();
    // Rule off, or governance off: nothing is held.
    db = seed({ rules_version: 3, needs_approval: [] });
    expect(await externalCallHolds(db as never, "ws-1", P, db.tables.items as never, await loadPolicies(db as never, "ws-1"))).toEqual([]);
  });

  it("an Owner or Admin allows it for the project (a rule, audited); a Builder asks, once", async () => {
    const { allowExternalCall } = await import("@/server/actions/external-calls");
    role = "builder";
    expect(await allowExternalCall({ projectId: P, provider: "clearbit" })).toEqual({ ok: true, asked: true });
    expect(db.tables.approvals[0]).toMatchObject({ kind: "external_call", project_id: P, payload: { provider: "clearbit", parts: ["Company size lookup"], requested_by_name: "Rita" } });
    expect(await allowExternalCall({ projectId: P, provider: "clearbit" })).toEqual({ ok: false, message: "Your request is waiting for an Owner or Admin." });
    role = "admin";
    db = seed();
    expect(await allowExternalCall({ projectId: P, provider: "clearbit" })).toEqual({ ok: true, asked: false });
    expect(db.tables.allow_rules[0]).toMatchObject({ action: "external_call", project_id: P, target: "clearbit", created_by_name: "Rita" });
    expect(db.tables.audit_log[0]).toMatchObject({ action: "rule.created", target: "Lead scorer: Clearbit called with a key" });
    expect(await allowExternalCall({ projectId: P, provider: "clearbit" })).toEqual({ ok: false, message: "Clearbit doesn't need an admin's OK in Lead scorer any more." });
  });

  it("approving everywhere makes a workspace rule; the request's view names the parts and the host", async () => {
    const { approvalView } = await import("@/lib/approvals");
    const v = approvalView({ id: "a1", kind: "external_call", status: "waiting", title: "x", payload: { provider: "clearbit", parts: ["Company size lookup"], requested_by_name: "Sam" }, requestedByName: null, project: { id: P, name: "Lead scorer" }, egressHosts: ["api.clearbit.com"], decidedByName: null, decidedAt: null, reason: null } as never);
    expect(v).toMatchObject({ title: "Let Lead scorer call Clearbit with a key", ruleLine: "External call · rule: calls to outside services with a key need an admin", flow: { host: "api.clearbit.com", allowed: true } });
    expect(v.actions.map((a) => a.label)).toEqual(["Approve for this project", "Approve and allow everywhere"]);

    role = "admin";
    db.tables.approvals.push({ id: "a1", workspace_id: "ws-1", project_id: P, kind: "external_call", title: "Lead scorer: call Clearbit with a key", status: "waiting", payload: { provider: "clearbit" } });
    const { decide } = await import("@/server/approvals");
    const r = await decide(db as never, { user: { id: "me" }, name: "Rita", role: "admin", workspace: { id: "ws-1", name: "Acme", governanceEnabled: true } } as never, { approvalId: "a1", decision: "approve", scope: "rule", reason: "Read only" });
    expect(r.ok).toBe(true);
    expect(db.tables.allow_rules[0]).toMatchObject({ action: "external_call", project_id: null, target: "clearbit" });
    const { externalCallHolds, loadPolicies } = await import("@/server/policy");
    expect(await externalCallHolds(db as never, "ws-1", P, db.tables.items as never, await loadPolicies(db as never, "ws-1"))).toEqual([]);
  });
});

describe("Attach agent: Lyzr Studio's agent list (BL-2)", () => {
  it("real when a Lyzr key is set; sample agents, marked simulated, without one or when Studio doesn't answer", async () => {
    role = "builder";
    const { studioAgents } = await import("@/server/actions/studio-agents");
    lyzr.configured = true;
    lyzr.list.mockResolvedValue([{ id: "68ab", name: "Research agent · Architect", description: "" }]);
    expect(await studioAgents()).toEqual({ ok: true, agents: [{ id: "68ab", name: "Research agent · Architect", description: "" }], simulated: false });
    lyzr.list.mockRejectedValue(new Error("down"));
    expect(await studioAgents()).toMatchObject({ ok: true, simulated: true, note: "Lyzr Studio didn't answer, so these are sample agents. Try again later for yours." });
    lyzr.configured = false;
    expect(await studioAgents()).toMatchObject({ ok: true, simulated: true });
    role = "viewer";
    expect((await studioAgents()).ok).toBe(false);
  });
});

describe("plans and the Built with Architect badge (simulated billing)", () => {
  const P = "77777777-7777-4777-8777-777777777777";
  beforeEach(() => {
    db = new FakeDb({
      workspaces: [{ id: "ws-1", plan: "free" }],
      projects: [{ id: P, name: "Meeting Prep", workspace_id: "ws-1", launch_settings: { analytics: true } }],
      audit_log: [],
    });
  });

  it("Free always shows the badge; a paid plan can hide it", async () => {
    const { setBadge } = await import("@/server/actions/launch");
    role = "builder";
    plan = "free";
    expect(await setBadge({ projectId: P, on: false })).toEqual({ ok: false, message: "The Free plan always shows it. Starter and up can hide it, in Settings › Plan." });
    plan = "starter";
    expect(await setBadge({ projectId: P, on: false })).toEqual({ ok: true });
    expect(db.tables.projects[0].launch_settings).toEqual({ analytics: true, badge: false });
  });

  it("Owners and Admins switch plans (no payment); back on Free, live apps show the badge again", async () => {
    const { setWorkspacePlan } = await import("@/server/actions/launch");
    role = "builder";
    expect((await setWorkspacePlan({ plan: "pro" })).ok).toBe(false);
    role = "owner";
    plan = "pro";
    db.tables.projects[0].launch_settings = { badge: false };
    expect(await setWorkspacePlan({ plan: "gold" })).toEqual({ ok: false, message: "Pick one of the plans shown." });
    expect(await setWorkspacePlan({ plan: "free" })).toEqual({ ok: true });
    expect(db.tables.workspaces[0].plan).toBe("free");
    expect(db.tables.projects[0].launch_settings).toEqual({ badge: true });
    expect(db.tables.audit_log.at(-1)).toMatchObject({ action: "plan.changed", details: { from: "pro", to: "free", simulated: true } });
  });
});

describe("approving an app can allow its data host in the same step (drift 1)", () => {
  const P = "88888888-8888-4888-8888-888888888888";
  const seed = () =>
    new FakeDb({
      workspaces: [{ id: "ws-1", governance_enabled: true }],
      policies: [
        { id: "pol-e", workspace_id: "ws-1", kind: "egress", config: { mode: "allow_list", hosts: ["slack.com"], redact: ["email"] } },
        { id: "pol-c", workspace_id: "ws-1", kind: "connectors", config: { allow: ["slack"] } },
      ],
      approvals: [{ id: "a1", workspace_id: "ws-1", project_id: P, kind: "connector", title: "Lead brief: HubSpot", status: "waiting", payload: { provider: "hubspot" } }],
      projects: [{ id: P, name: "Lead brief", workspace_id: "ws-1" }],
      runs: [],
      items: [],
      allow_rules: [],
      audit_log: [],
    });
  const ctx = { user: { id: "me" }, name: "Rita", role: "admin", workspace: { id: "ws-1", name: "Acme", governanceEnabled: true } } as never;

  it("ticked (the default in the panel): api.hubapi.com joins the allowed hosts, audited", async () => {
    db = seed();
    const { decide } = await import("@/server/approvals");
    expect((await decide(db as never, ctx, { approvalId: "a1", decision: "approve", scope: "once", reason: "", allowHost: true })).ok).toBe(true);
    expect(db.tables.policies[0].config).toEqual({ mode: "allow_list", hosts: ["slack.com", "api.hubapi.com"], redact: ["email"] });
    expect(db.tables.audit_log.map((a) => a.target)).toContain("Host allowed: api.hubapi.com");
  });

  it("unticked: the app is approved and the host stays held, as before", async () => {
    db = seed();
    const { decide } = await import("@/server/approvals");
    expect((await decide(db as never, ctx, { approvalId: "a1", decision: "approve", scope: "once", reason: "", allowHost: false })).ok).toBe(true);
    expect((db.tables.policies[0].config as { hosts: string[] }).hosts).toEqual(["slack.com"]);
  });
});
