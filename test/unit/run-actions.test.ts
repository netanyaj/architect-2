import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/db";
import { FakeDb } from "./fake-db";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
let db: FakeDb;
let role: Role;
vi.mock("@/server/db", () => ({ createAdminDb: () => db, createServerDb: async () => db }));
vi.mock("@/server/workspace", () => ({
  getAppContext: async () => ({ user: { id: "me" }, name: "Morgan Lee", role, workspace: { id: "ws-1", name: "Acme" }, memberships: [] }),
}));
const startFollowupRun = vi.fn();
const settleRun = vi.fn();
vi.mock("@/server/sim/run", () => ({ startFollowupRun: (...a: unknown[]) => startFollowupRun(...a), settleRun: (...a: unknown[]) => settleRun(...a) }));

const actions = await import("@/server/actions/run");

const P = "11111111-1111-4111-8111-111111111111";
const BP = "bp-1";
const ITEM = (n: number) => `22222222-2222-4222-8222-22222222222${n}`;
const project = { id: P, name: "Meeting Prep", workspace_id: "ws-1", budget_credits: 50 };

beforeEach(() => {
  role = "owner";
  startFollowupRun.mockReset().mockResolvedValue({ ok: true, runId: "run-2" });
  settleRun.mockReset().mockResolvedValue("done");
  const item = (n: number, key: string, status: string, extra: Record<string, unknown> = {}) => ({
    id: ITEM(n), key, title: key, status, provider: null, proved_when: "Done when briefs stay under 200 words and name every attendee.", estimate_likely: 10,
    blueprint_id: BP, project_id: P, fix_attempts: 0, projects: project, ...extra,
  });
  db = new FakeDb({
    projects: [{ ...project, current_version: 1, status: "paused" }],
    blueprints: [{ id: BP, project_id: P, version: 1, agreed_at: "2026-10-06T10:00:00Z" }],
    items: [
      item(1, "mail", "needs_connection", { provider: "gmail" }),
      item(2, "writer", "paused", { fix_attempts: 3 }),
      item(3, "later", "agreed"),
      item(4, "crm", "needs_connection", { provider: "hubspot" }),
    ],
    connections: [{ id: "c-1", workspace_id: "ws-1", provider: "gmail", status: "missing" }],
    policies: [{ workspace_id: "ws-1", kind: "connectors", config: { deny: ["hubspot"] } }],
    runs: [{ id: "run-1", project_id: P, status: "paused_budget", started_at: "2026-10-06T10:00:00Z" }],
    deployments: [],
    checks: [{ id: "chk-1", item_id: ITEM(2), kind: "eval", written_at: "2026-10-06T10:00:00Z", description: "x", written_by: "verifier" }],
    proofs: [],
    events: [],
    audit_log: [],
    usage_ledger: [],
  });
});

describe("connectPart (BL-9)", () => {
  it("connects the service and the waiting part works, with an event and an audit line", async () => {
    expect(await actions.connectPart({ itemId: ITEM(1) })).toEqual({ ok: true });
    expect(db.tables.connections[0].status).toBe("connected");
    expect(db.tables.items.find((i) => i.key === "mail")).toMatchObject({ status: "built", status_detail: null });
    expect(db.tables.events).toEqual([expect.objectContaining({ type: "item.built", actor: "user", item_id: ITEM(1) })]);
    expect(db.tables.audit_log[0]).toMatchObject({ action: "connection.connected", target: "gmail" });
  });
  it("refuses Viewers, a service the policy denies, and a part that doesn't wait for one", async () => {
    role = "viewer";
    expect(await actions.connectPart({ itemId: ITEM(1) })).toMatchObject({ ok: false });
    role = "builder";
    expect(await actions.connectPart({ itemId: ITEM(4) })).toEqual({ ok: false, message: "Your organisation's policy doesn't allow this app. IT has to approve it first." });
    expect(await actions.connectPart({ itemId: ITEM(3) })).toEqual({ ok: false, message: "That part doesn't need a connection." });
  });
});

describe("a Blocked part (screen 6)", () => {
  it("What I suggest: the check changes to 250 words and the part works, at no cost", async () => {
    expect(await actions.acceptSuggestion({ itemId: ITEM(2) })).toEqual({ ok: true });
    expect(db.tables.items.find((i) => i.key === "writer")).toMatchObject({ status: "built", proved_when: "Done when briefs stay under 250 words and name every attendee." });
    expect(db.tables.proofs[0]).toMatchObject({ result: "pass", attempt: 3 });
    expect(db.tables.usage_ledger).toEqual([]);
    expect(await actions.acceptSuggestion({ itemId: ITEM(2) })).toEqual({ ok: false, message: "That part isn't blocked any more." });
  });
  it("Try once more starts a fix run for that part, through the gate", async () => {
    expect(await actions.retryPart({ itemId: ITEM(2) })).toEqual({ ok: true });
    expect(startFollowupRun).toHaveBeenCalledWith(db, { projectId: P, userId: "me", kind: "fix", focus: ["writer"], estimate: 3 });
    startFollowupRun.mockResolvedValue({ ok: false, message: "That would go past the project's budget. Raise the budget first." });
    expect(await actions.retryPart({ itemId: ITEM(2) })).toMatchObject({ ok: false, message: expect.stringContaining("budget") });
  });
  it("Set aside for now: the part waits in Up next", async () => {
    expect(await actions.setPartAside({ itemId: ITEM(2) })).toEqual({ ok: true });
    expect(db.tables.items.find((i) => i.key === "writer")).toMatchObject({ status: "deferred", status_detail: "Set aside" });
  });
  it("its drawer offers the suggestion only while it's blocked", async () => {
    const r = await actions.loadPart({ itemId: ITEM(2) });
    expect(r.ok && r.detail.suggestion).toMatchObject({ button: "Allow 250 words" });
    const other = await actions.loadPart({ itemId: ITEM(3) });
    expect(other.ok && other.detail.suggestion).toBeNull();
  });
});

describe("paused at the budget (screen 7)", () => {
  it("Raise budget and continue: Owners and Admins only; the waiting parts build", async () => {
    expect(await actions.raiseBudgetAndContinue({ projectId: P, budget: 80 })).toEqual({ ok: true });
    expect(db.tables.projects[0].budget_credits).toBe(80);
    expect(startFollowupRun).toHaveBeenCalledWith(db, { projectId: P, userId: "me", kind: "build", focus: null, estimate: 10 });
    role = "builder";
    expect(await actions.raiseBudgetAndContinue({ projectId: P, budget: 90 })).toMatchObject({ ok: false, message: expect.stringContaining("Only Owners and Admins") });
  });
  it("Set the parts aside, or Stop here: the project is built with what works", async () => {
    expect(await actions.setWaitingAside({ projectId: P })).toEqual({ ok: true });
    expect(db.tables.items.find((i) => i.key === "later")!.status).toBe("deferred");
    db.tables.items.find((i) => i.key === "later")!.status = "agreed";
    db.tables.items.find((i) => i.key === "writer")!.status = "built";
    expect(await actions.stopHere({ projectId: P })).toEqual({ ok: true });
    expect(db.tables.runs[0].status).toBe("done");
    expect(db.tables.projects[0].status).toBe("built");
  });
});

describe("settleRunNow", () => {
  it("settles a run the person can see; not one they can't", async () => {
    expect(await actions.settleRunNow({ runId: "33333333-3333-4333-8333-333333333333" })).toMatchObject({ ok: false });
    db.tables.runs.push({ id: "33333333-3333-4333-8333-333333333333", project_id: P, status: "running" });
    expect(await actions.settleRunNow({ runId: "33333333-3333-4333-8333-333333333333" })).toEqual({ ok: true, status: "done" });
  });
});
