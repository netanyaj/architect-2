import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/db";
import { assignableRolesFor, buildBlockedReason, canBuild, canChangeMember, canManageMembers, canResetDemo } from "@/lib/permissions";
import { FakeDb } from "./fake-db";

/* ---------- mocks ---------- */

class Redirect extends Error {
  constructor(public url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}
const cookieJar = new Map<string, string>();
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Redirect(url); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "localhost:3000"]]),
  cookies: async () => ({ set: (k: string, v: string) => cookieJar.set(k, v), get: (k: string) => ({ value: cookieJar.get(k) }) }),
}));

let db: FakeDb;
let signedIn: { id: string; email: string; user_metadata: object } | null;
let ctx: { role: Role };
vi.mock("@/server/db", () => ({
  createAdminDb: () => db,
  createServerDb: async () => ({ auth: { getUser: async () => ({ data: { user: signedIn } }) } }),
}));
vi.mock("@/server/workspace", async (orig) => ({
  ...(await orig<object>()),
  getAppContext: async () => ({
    user: { id: "owner-1", email: "morgan@acme.example" },
    name: "Morgan Lee",
    role: ctx.role,
    workspace: { id: "ws-1", name: "Acme Ops" },
    memberships: [
      { workspaceId: "ws-1", workspaceName: "Acme Ops", role: ctx.role, label: "Your Acme Ops" },
      { workspaceId: "ws-2", workspaceName: "Acme Ops", role: "viewer", label: "Sam's Acme Ops" },
    ],
  }),
}));

const { inviteMember, changeRole, removeMember, acceptInvite, switchWorkspace, resetDemoData } = await import(
  "@/server/actions/members"
);

const INVITE_TOKEN = "0b8f7c1e-1d3a-4f55-9a3e-2b1c4d5e6f70";

function seed() {
  return new FakeDb({
    members: [
      { id: "m-owner", workspace_id: "ws-1", user_id: "owner-1", role: "owner", status: "active", email: "morgan@acme.example", display_name: "Morgan Lee" },
      { id: "m-admin", workspace_id: "ws-1", user_id: "admin-1", role: "admin", status: "active", email: "jo@acme.example", display_name: "Jo" },
      { id: "m-builder", workspace_id: "ws-1", user_id: "builder-1", role: "builder", status: "active", email: "kim@acme.example", display_name: "Kim" },
      { id: "m-invite", workspace_id: "ws-1", user_id: null, role: "viewer", status: "invited", email: "riley@example.com", invited_email: "riley@example.com", invite_token: INVITE_TOKEN },
    ],
    audit_log: [],
  });
}
const member = (id: string) => db.tables.members.find((m) => m.id === id);
const audits = () => db.tables.audit_log.map((a) => a.action);

beforeEach(() => {
  db = seed();
  ctx = { role: "owner" };
  signedIn = null;
  cookieJar.clear();
});

/* ---------- role rules ---------- */

describe("permissions", () => {
  it("only Owners, Admins and Builders can build; Viewers are told why", () => {
    expect((["owner", "admin", "builder"] as Role[]).every(canBuild)).toBe(true);
    expect(canBuild("viewer")).toBe(false);
    expect(buildBlockedReason("viewer")).toBe("Viewers can't build. Ask an Owner, Admin or Builder.");
    expect(buildBlockedReason("builder")).toBeUndefined();
  });
  it("only Owners and Admins manage people; only the Owner resets demo data", () => {
    expect(canManageMembers("admin")).toBe(true);
    expect(canManageMembers("builder")).toBe(false);
    expect(canResetDemo("owner")).toBe(true);
    expect(canResetDemo("admin")).toBe(false);
  });
  it("the Owner can make Admins; an Admin can't", () => {
    expect(assignableRolesFor("owner")).toEqual(["admin", "builder", "viewer"]);
    expect(assignableRolesFor("admin")).toEqual(["builder", "viewer"]);
    expect(assignableRolesFor("viewer")).toEqual([]);
  });
  it("nobody changes the Owner or themselves, and Admins can't change Admins", () => {
    const owner = { role: "owner" as const, userId: "o" };
    const admin = { role: "admin" as const, userId: "a" };
    expect(canChangeMember(owner, { role: "owner", userId: "x" })).toMatchObject({ ok: false });
    expect(canChangeMember(admin, { role: "admin", userId: "a" })).toMatchObject({ ok: false, reason: "You can't change your own role." });
    expect(canChangeMember(admin, { role: "admin", userId: "b" })).toMatchObject({ ok: false, reason: "Only the Owner can change an Admin." });
    expect(canChangeMember(admin, { role: "viewer", userId: "v" })).toEqual({ ok: true });
  });
});

/* ---------- inviteMember ---------- */

describe("inviteMember", () => {
  it("creates a pending invite with a link and an audit row", async () => {
    const r = await inviteMember({ email: "  Sam@Example.com ", role: "viewer" });
    expect(r).toMatchObject({ ok: true });
    const row = db.tables.members.find((m) => m.invited_email === "sam@example.com")!;
    expect(row).toMatchObject({ role: "viewer", status: "invited", invited_by: "owner-1", workspace_id: "ws-1" });
    expect(r.ok && r.link).toBe(`http://localhost:3000/invite/${row.invite_token}`);
    expect(audits()).toEqual(["member.invited"]);
  });
  it("re-inviting a pending address updates the role and keeps the same link", async () => {
    const r = await inviteMember({ email: "riley@example.com", role: "builder" });
    expect(r.ok && r.link).toBe(`http://localhost:3000/invite/${INVITE_TOKEN}`);
    expect(member("m-invite")!.role).toBe("builder");
    expect(db.tables.members.filter((m) => m.invited_email === "riley@example.com")).toHaveLength(1);
  });
  it("says when someone is already in the workspace", async () => {
    expect(await inviteMember({ email: "KIM@acme.example", role: "viewer" })).toEqual({ ok: false, message: "kim@acme.example is already in this workspace." });
  });
  it("doesn't treat _ in an email as a wildcard", async () => {
    db.tables.members.push({ id: "m-x", workspace_id: "ws-1", user_id: "x", role: "viewer", status: "active", email: "aXb@example.com" });
    expect(await inviteMember({ email: "a_b@example.com", role: "viewer" })).toMatchObject({ ok: true });
  });
  it("Builders and Viewers can't invite", async () => {
    ctx.role = "builder";
    expect(await inviteMember({ email: "sam@example.com", role: "viewer" })).toEqual({ ok: false, message: "Only Owners and Admins can invite people." });
  });
  it("an Admin can't invite an Admin", async () => {
    ctx.role = "admin";
    expect(await inviteMember({ email: "sam@example.com", role: "admin" })).toEqual({ ok: false, message: "Only the Owner can invite someone as Admin." });
  });
  it("checks the email and refuses Owner", async () => {
    expect(await inviteMember({ email: "not-an-email", role: "viewer" })).toMatchObject({ ok: false, message: "Enter an email address like sam@company.com." });
    expect(await inviteMember({ email: "sam@example.com", role: "owner" })).toMatchObject({ ok: false });
  });
});

/* ---------- changeRole / removeMember ---------- */

describe("changeRole", () => {
  it("changes the role and writes from/to to the audit log", async () => {
    expect(await changeRole({ memberId: "m-builder", role: "viewer" })).toEqual({ ok: true });
    expect(member("m-builder")!.role).toBe("viewer");
    expect(db.tables.audit_log[0]).toMatchObject({ action: "member.role_changed", target: "Kim", details: { from: "builder", to: "viewer" } });
  });
  it("refuses to change the Owner", async () => {
    expect(await changeRole({ memberId: "m-owner", role: "viewer" })).toEqual({ ok: false, message: "The Owner's role can't be changed." });
    expect(audits()).toEqual([]);
  });
  it("an Admin can't change another Admin or promote to Admin", async () => {
    ctx.role = "admin";
    expect(await changeRole({ memberId: "m-admin", role: "viewer" })).toMatchObject({ ok: false });
    expect(await changeRole({ memberId: "m-builder", role: "admin" })).toEqual({ ok: false, message: "Only the Owner can make someone Admin." });
    expect(member("m-builder")!.role).toBe("builder");
  });
  it("can't reach members of another workspace", async () => {
    db.tables.members.push({ id: "m-other", workspace_id: "ws-9", user_id: "z", role: "builder", status: "active" });
    expect(await changeRole({ memberId: "m-other", role: "viewer" })).toEqual({ ok: false, message: "That person isn't in this workspace any more." });
  });
});

describe("removeMember", () => {
  it("removes a member and logs it", async () => {
    expect(await removeMember({ memberId: "m-builder" })).toEqual({ ok: true });
    expect(member("m-builder")).toBeUndefined();
    expect(audits()).toEqual(["member.removed"]);
  });
  it("cancelling an invite kills its link", async () => {
    expect(await removeMember({ memberId: "m-invite" })).toEqual({ ok: true });
    expect(audits()).toEqual(["member.invite_cancelled"]);
  });
  it("Viewers can't remove anyone", async () => {
    ctx.role = "viewer";
    expect(await removeMember({ memberId: "m-builder" })).toMatchObject({ ok: false });
    expect(member("m-builder")).toBeDefined();
  });
});

/* ---------- acceptInvite / switchWorkspace ---------- */

describe("acceptInvite", () => {
  it("sends signed-out people to sign in first, then back to the invite", async () => {
    await expect(acceptInvite(INVITE_TOKEN)).rejects.toMatchObject({ url: `/login?next=%2Finvite%2F${INVITE_TOKEN}` });
  });
  it("joins with the invited email, switches to that workspace and goes Home", async () => {
    signedIn = { id: "riley-1", email: "Riley@Example.com", user_metadata: { full_name: "Riley Park" } };
    await expect(acceptInvite(INVITE_TOKEN)).rejects.toMatchObject({ url: "/home" });
    expect(member("m-invite")).toMatchObject({ user_id: "riley-1", status: "active", invite_token: null, display_name: "Riley Park", role: "viewer" });
    expect(cookieJar.get("ax_ws")).toBe("ws-1");
    expect(audits()).toEqual(["member.joined"]);
  });
  it("refuses a different email, and says which one to use", async () => {
    signedIn = { id: "x", email: "someone@else.com", user_metadata: {} };
    expect(await acceptInvite(INVITE_TOKEN)).toEqual({
      ok: false,
      message: "This invite is for riley@example.com. Sign out, then sign in with that email to accept it.",
    });
    expect(member("m-invite")!.status).toBe("invited");
  });
  it("a used or made-up link explains itself", async () => {
    signedIn = { id: "riley-1", email: "riley@example.com", user_metadata: {} };
    expect(await acceptInvite("not-a-uuid")).toEqual({ ok: false, message: "This invite link isn't valid." });
    member("m-invite")!.status = "active";
    expect(await acceptInvite(INVITE_TOKEN)).toMatchObject({ ok: false, message: "This invite was already used or cancelled. Ask for a new link." });
  });
});

describe("switchWorkspace", () => {
  it("switches only to workspaces you belong to", async () => {
    expect(await switchWorkspace("ws-2")).toEqual({ ok: true });
    expect(cookieJar.get("ax_ws")).toBe("ws-2");
    expect(await switchWorkspace("ws-9")).toEqual({ ok: false, message: "You're not a member of that workspace." });
    expect(cookieJar.get("ax_ws")).toBe("ws-2");
  });
});

/* ---------- resetDemoData ---------- */

describe("resetDemoData", () => {
  it("runs the reset for the Owner", async () => {
    expect(await resetDemoData()).toEqual({ ok: true });
    expect(db.rpcCalls).toEqual([{ fn: "reset_demo_workspace", args: { p_workspace: "ws-1", p_owner: "owner-1" } }]);
  });
  it("refuses everyone else", async () => {
    ctx.role = "admin";
    expect(await resetDemoData()).toEqual({ ok: false, message: "Only the workspace Owner can reset demo data." });
    expect(db.rpcCalls).toEqual([]);
  });
});
