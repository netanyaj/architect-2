import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/db";
import { FakeDb } from "./fake-db";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
let db: FakeDb;
let role: Role;
let governance: boolean;
vi.mock("@/server/db", () => ({ createAdminDb: () => db }));
vi.mock("@/server/workspace", () => ({
  getAppContext: async () => ({ user: { id: "me" }, name: "Morgan Lee", role, workspace: { id: "ws-1", name: "Acme", governanceEnabled: governance }, memberships: [] }),
}));

const { shareWithTeam, goLive, goBack, setAccess, setAnalytics, saveListing, setDomain, shareTestLink, setGovernance } = await import("@/server/actions/launch");
const P = "11111111-1111-4111-8111-111111111111";
const project = { id: P, name: "Meeting Prep", workspace_id: "ws-1", current_version: 1, status: "built", launch_settings: {}, test_share_token: null };

beforeEach(() => {
  role = "owner";
  governance = true;
  db = new FakeDb({
    projects: [{ ...project }],
    blueprints: [{ id: "bp", project_id: P, version: 1, agreed_at: "2026-10-06T10:00:00Z" }],
    items: [
      { id: "i1", blueprint_id: "bp", key: "a", title: "Brief", status: "built", provider: null, estimate_likely: 10 },
      { id: "i2", blueprint_id: "bp", key: "b", title: "Last email", status: "needs_connection", provider: "gmail", estimate_likely: 10 },
    ],
    deployments: [],
    environments: [],
    approvals: [],
    runs: [],
    audit_log: [],
  });
});

describe("shareWithTeam", () => {
  it("waits for the checklist, then shares this version with the workspace", async () => {
    expect(await shareWithTeam({ projectId: P })).toEqual({ ok: false, message: "Fix 1 thing in the checklist first." });
    db.tables.items[1].status = "built";
    expect(await shareWithTeam({ projectId: P })).toEqual({ ok: true });
    expect(db.tables.deployments).toEqual([expect.objectContaining({ environment: "staging", blueprint_version: 1, status: "live", created_by: "me" })]);
    expect(db.tables.environments[0]).toMatchObject({ name: "staging", status: "live", url: "meeting-prep--team.architect.space" });
    expect(await shareWithTeam({ projectId: P })).toEqual({ ok: false, message: "Your team already has v1." });
  });
  it("refuses Viewers and while a build runs", async () => {
    db.tables.items[1].status = "built";
    role = "viewer";
    expect(await shareWithTeam({ projectId: P })).toMatchObject({ ok: false });
    role = "builder";
    db.tables.runs.push({ id: "r", project_id: P, status: "running" });
    expect(await shareWithTeam({ projectId: P })).toEqual({ ok: false, message: "A build is running. Share when it finishes." });
  });
});

describe("goLive and goBack", () => {
  beforeEach(() => {
    db.tables.items[1].status = "built";
    db.tables.deployments.push({ id: "d1", project_id: P, environment: "staging", blueprint_version: 1, status: "live", created_at: "2026-10-06T10:00:00Z" });
  });
  it("an Owner puts the team version live; the project is Live", async () => {
    expect(await goLive({ projectId: P })).toEqual({ ok: true, requested: false });
    expect(db.tables.deployments.find((d) => d.environment === "production")).toMatchObject({ blueprint_version: 1, status: "live" });
    expect(db.tables.projects[0].status).toBe("live");
  });
  it("a Builder's click asks the Owners and Admins instead", async () => {
    role = "builder";
    expect(await goLive({ projectId: P })).toEqual({ ok: true, requested: true });
    expect(db.tables.approvals[0]).toMatchObject({ kind: "deploy", title: "Meeting Prep: Live deploy of v1", requested_by: "me" });
    expect(db.tables.deployments.some((d) => d.environment === "production")).toBe(false);
  });
  it("go back serves an earlier version again; Live needs an Owner or Admin", async () => {
    db.tables.deployments[0].status = "rolled_back";
    db.tables.workspaces = [];
    db.tables.deployments.push({ id: "d2", project_id: P, environment: "staging", blueprint_version: 2, status: "live", created_at: "2026-10-06T11:00:00Z", projects: project });
    db.tables.deployments[0].projects = project;
    expect(await goBack({ deploymentId: "44444444-4444-4444-8444-444444444444" })).toMatchObject({ ok: false });
    db.tables.deployments[0].id = "44444444-4444-4444-8444-444444444444";
    expect(await goBack({ deploymentId: "44444444-4444-4444-8444-444444444444" })).toEqual({ ok: true });
    expect(db.tables.deployments.filter((d) => d.status === "live").map((d) => d.blueprint_version)).toEqual([1]);
  });
});

describe("without governance (the fast path)", () => {
  beforeEach(() => {
    governance = false;
    db.tables.items[1].status = "built";
  });
  it("a Builder goes live straight from the test version; no team version, no approval", async () => {
    role = "builder";
    expect(await goLive({ projectId: P })).toEqual({ ok: true, requested: false });
    expect(db.tables.deployments.map((d) => d.environment)).toEqual(["production"]);
    expect(db.tables.approvals).toEqual([]);
  });
});

describe("deploy failure (?sim=deployfail)", () => {
  it("records the failed step; the version before keeps serving", async () => {
    db.tables.items[1].status = "built";
    db.tables.deployments.push({ id: "d1", project_id: P, environment: "staging", blueprint_version: 1, status: "live", created_at: "2026-10-06T10:00:00Z" });
    const r = await goLive({ projectId: P, sim: "deployfail" });
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("failed at the health check") });
    const failed = db.tables.deployments.find((d) => d.environment === "production")!;
    expect(failed).toMatchObject({ status: "failed", checks: { failure: { step: "Health check" } } });
    expect(db.tables.projects[0].status).toBe("built");
    expect(db.tables.deployments.find((d) => d.id === "d1")!.status).toBe("live");
  });
});

describe("launch settings", () => {
  it("who can open it, analytics and the listing are saved; bad input is refused", async () => {
    expect(await setAccess({ projectId: P, access: "link" })).toEqual({ ok: true });
    expect(await setAccess({ projectId: P, access: "everyone" as never })).toMatchObject({ ok: false });
    expect(await setAnalytics({ projectId: P, on: true })).toEqual({ ok: true });
    expect(await saveListing({ projectId: P, listing: { scope: "public", category: "Sales", description: "d", summary: "s", tags: ["CRM", "crm"] } })).toEqual({ ok: true });
    expect(db.tables.projects[0].launch_settings).toEqual({ access: "link", analytics: true, listing: { scope: "public", category: "Sales", description: "d", summary: "s", tags: ["crm"] } });
    expect(await saveListing({ projectId: P, listing: { scope: "public", category: "Sales", description: "d", summary: "x".repeat(161), tags: [] } })).toEqual({ ok: false, message: "Keep the short description to 160 characters." });
    role = "builder";
    expect(await saveListing({ projectId: P, listing: { scope: "public", category: "Sales", description: "d", summary: "s", tags: [] } })).toMatchObject({ ok: false, message: expect.stringContaining("Public Agentlets") });
    role = "viewer";
    expect(await setAccess({ projectId: P, access: "invited" })).toMatchObject({ ok: false });
  });

  it("a custom domain goes enter → record → checking → secured, and the next deploy uses it", async () => {
    expect(await setDomain({ projectId: P, env: "production", step: "start", name: "https://x" })).toMatchObject({ ok: false });
    expect(await setDomain({ projectId: P, env: "production", step: "start", name: "Prep.Acme.com" })).toEqual({ ok: true, status: "dns" });
    expect(await setDomain({ projectId: P, env: "production", step: "check" })).toEqual({ ok: true, status: "checking" });
    const settings = () => db.tables.projects[0].launch_settings as { domains: { production: { status: string; since: string } } };
    expect(settings().domains.production.status).toBe("checking");
    expect(await setDomain({ projectId: P, env: "production", step: "verify" })).toEqual({ ok: true, status: "checking" });
    expect(settings().domains.production.status).toBe("checking");
    settings().domains.production.since = new Date(Date.now() - 10_000).toISOString();
    await setDomain({ projectId: P, env: "production", step: "verify" });
    expect(settings().domains.production).toMatchObject({ status: "secured" });
    db.tables.items[1].status = "built";
    db.tables.deployments.push({ id: "d1", project_id: P, environment: "staging", blueprint_version: 1, status: "live", created_at: "2026-10-06T10:00:00Z" });
    await goLive({ projectId: P });
    expect(db.tables.environments.find((e) => e.name === "production")!.url).toBe("prep.acme.com");
  });

  it("the test link can be shared and stopped; governance is for Owners and Admins", async () => {
    const r = await shareTestLink({ projectId: P, on: true });
    expect(r.ok && r.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(await shareTestLink({ projectId: P, on: false })).toEqual({ ok: true, token: null });
    expect(db.tables.projects[0].test_share_token).toBeNull();
    db.tables.workspaces = [{ id: "ws-1", governance_enabled: true }];
    expect(await setGovernance({ on: false })).toEqual({ ok: true });
    expect(db.tables.workspaces[0].governance_enabled).toBe(false);
    role = "builder";
    expect(await setGovernance({ on: true })).toMatchObject({ ok: false });
  });
});
