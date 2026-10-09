import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/db";
import { FakeDb } from "./fake-db";

let db: FakeDb;
let role: Role;
let me: string;
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/db", () => ({ createAdminDb: () => db, createServerDb: async () => db }));
vi.mock("@/server/workspace", () => ({
  getAppContext: async () => ({ user: { id: me }, name: me === "morgan" ? "Morgan Lee" : "Riley Kim", role, workspace: { id: "ws-1", name: "Acme", governanceEnabled: true }, memberships: [] }),
}));

const P = "11111111-1111-4111-8111-111111111111";
const RILEY = "22222222-2222-4222-8222-222222222222";
const SAM = "33333333-3333-4333-8333-333333333333";
const VIEWER = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  me = "morgan";
  role = "owner";
  db = new FakeDb({
    projects: [
      { id: P, name: "Meeting Prep", owner_id: "morgan", owner_display_name: null, workspace_id: "ws-1" },
      { id: "p2", name: "ticket-triage", owner_id: "morgan", owner_display_name: "Sam", workspace_id: "ws-1" },
    ],
    members: [
      { id: "m-morgan", workspace_id: "ws-1", user_id: "morgan", role: "owner", status: "active", display_name: "Morgan Lee" },
      { id: RILEY, workspace_id: "ws-1", user_id: "riley", role: "builder", status: "active", display_name: "Riley Kim" },
      { id: SAM, workspace_id: "ws-1", user_id: null, role: "builder", status: "invited", display_name: "Sam", invited_email: "sam@acme-ops.example" },
      { id: VIEWER, workspace_id: "ws-1", user_id: "v", role: "viewer", status: "active", display_name: "Val" },
    ],
    ownership_transfers: [],
    audit_log: [],
  });
});

describe("transferOwnership and acceptTransfer", () => {
  it("offers with a note; nothing changes until the member accepts in the project", async () => {
    const { transferOwnership, acceptTransfer } = await import("@/server/actions/handoff");
    expect(await transferOwnership({ projectId: P, memberId: RILEY, note: "Briefs go to #sales." })).toEqual({ ok: true, invited: false });
    const t = db.tables.ownership_transfers[0];
    expect(t).toMatchObject({ project_id: P, from_user: "morgan", from_name: "Morgan Lee", to_member: RILEY, to_name: "Riley Kim", note: "Briefs go to #sales.", status: "pending" });
    expect(db.tables.projects[0].owner_id).toBe("morgan");
    t.id = "55555555-5555-4555-8555-555555555555";
    t.projects = { id: P, workspace_id: "ws-1", owner_id: "morgan" };
    // Only the person it's for can accept.
    expect(await acceptTransfer({ transferId: t.id as string })).toEqual({ ok: false, message: "This hand-off is for someone else." });
    me = "riley";
    role = "builder";
    expect(await acceptTransfer({ transferId: t.id as string })).toEqual({ ok: true });
    expect(db.tables.projects[0]).toMatchObject({ owner_id: "riley", owner_display_name: null });
    expect(t).toMatchObject({ status: "accepted", to_user: "riley", to_name: "Riley Kim" });
    expect(db.tables.audit_log.map((a) => a.action)).toEqual(["project.ownership_offered", "project.ownership_accepted"]);
  });

  it("a new offer replaces the open one; Viewers can't own; only the owner or an Owner or Admin can hand over", async () => {
    const { transferOwnership } = await import("@/server/actions/handoff");
    await transferOwnership({ projectId: P, memberId: RILEY });
    expect(await transferOwnership({ projectId: P, memberId: SAM })).toEqual({ ok: true, invited: true });
    expect(db.tables.ownership_transfers.map((t) => t.status)).toEqual(["cancelled", "pending"]);
    expect(await transferOwnership({ projectId: P, memberId: VIEWER })).toEqual({ ok: false, message: "Viewers can't own projects. Change their role in Settings first." });
    me = "riley";
    role = "builder";
    expect(await transferOwnership({ projectId: P, memberId: SAM })).toEqual({ ok: false, message: "Only the project's owner, or an Owner or Admin, can hand it over." });
  });
});

describe("completeOnInvite", () => {
  it("accepting the invite link completes offers to that member, and makes projects seeded as theirs theirs", async () => {
    const { transferOwnership } = await import("@/server/actions/handoff");
    await transferOwnership({ projectId: P, memberId: SAM, note: "All yours." });
    const { completeOnInvite } = await import("@/server/handoff");
    await completeOnInvite(db as never, { memberId: SAM, workspaceId: "ws-1", displayName: "Sam", user: { id: "sam", name: "Sam Ortiz" } });
    expect(db.tables.projects.map((p) => [p.name, p.owner_id, p.owner_display_name])).toEqual([
      ["Meeting Prep", "sam", null],
      ["ticket-triage", "sam", null],
    ]);
    const triage = db.tables.ownership_transfers.find((t) => t.project_id === "p2")!;
    expect(triage).toMatchObject({ from_name: "Morgan Lee", to_name: "Sam Ortiz", status: "accepted", note: "ticket-triage was set up as Sam's project." });
  });
});
