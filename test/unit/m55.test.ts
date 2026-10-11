import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/db";
import { openInDevOf, projectHref } from "@/lib/dev-preference";
import { FakeDb } from "./fake-db";

/* M5.5 polish: server actions and rules. */

let db: FakeDb;
let role: Role;
const inviteUserByEmail = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => {}, get: () => undefined }) }));
vi.mock("@/server/origin", () => ({ origin: async () => "https://architect.test" }));
vi.mock("@/server/db", () => ({
  createAdminDb: () => Object.assign(db, { auth: { admin: { inviteUserByEmail: (...a: unknown[]) => inviteUserByEmail(...a) } } }),
  createServerDb: async () => db,
}));
vi.mock("@/server/workspace", async (orig) => ({
  ...(await orig<typeof import("@/server/workspace")>()),
  getAppContext: async () => ({ user: { id: "me", email: "me@example.com" }, name: "Rita", role, workspace: { id: "ws-1", name: "Acme Ops (Enterprise)", governanceEnabled: true, plan: "enterprise", kind: "demo" }, memberships: [] }),
}));

describe("pending invites: Resend link and email (People)", () => {
  const M = "11111111-1111-4111-8111-111111111111";
  beforeEach(() => {
    role = "admin";
    inviteUserByEmail.mockReset().mockResolvedValue({ error: null });
    delete process.env.INVITE_EMAILS;
    db = new FakeDb({ members: [{ id: M, workspace_id: "ws-1", role: "viewer", status: "invited", invited_email: "sam@example.com", email: "sam@example.com", invite_token: "old-token" }], audit_log: [] });
  });

  it("a new link replaces the old one; copy-a-link only unless invite emails are on", async () => {
    const { resendInvite } = await import("@/server/actions/members");
    const r = await resendInvite({ memberId: M });
    expect(r.ok && r.emailed).toBe(false);
    expect(db.tables.members[0].invite_token).not.toBe("old-token");
    expect(r.ok && r.link).toBe(`https://architect.test/invite/${db.tables.members[0].invite_token}`);
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(db.tables.audit_log[0]).toMatchObject({ action: "member.invite_resent", target: "sam@example.com" });
  });

  it("with INVITE_EMAILS=on (custom SMTP set up in Supabase), the invite is emailed too", async () => {
    process.env.INVITE_EMAILS = "on";
    const { resendInvite } = await import("@/server/actions/members");
    const r = await resendInvite({ memberId: M });
    expect(r.ok && r.emailed).toBe(true);
    expect(inviteUserByEmail).toHaveBeenCalledWith("sam@example.com", { redirectTo: expect.stringMatching(/^https:\/\/architect\.test\/invite\//) });
  });

  it("only Owners and Admins; only pending invites", async () => {
    const { resendInvite } = await import("@/server/actions/members");
    role = "builder";
    expect((await resendInvite({ memberId: M })).ok).toBe(false);
    role = "admin";
    db.tables.members[0].status = "active";
    expect(await resendInvite({ memberId: M })).toEqual({ ok: false, message: "That invite isn't pending any more." });
  });
});

describe("Open projects in Developer view", () => {
  it("imported repos open in Developer view by default; Always and Never; never for Viewers", () => {
    expect(openInDevOf(undefined)).toBe("repos");
    expect(projectHref("p1", { repo: true, pref: "repos", canBuild: true })).toBe("/p/p1?dev=1");
    expect(projectHref("p1", { repo: false, pref: "repos", canBuild: true })).toBe("/p/p1");
    expect(projectHref("p1", { repo: false, pref: "always", canBuild: true })).toBe("/p/p1?dev=1");
    expect(projectHref("p1", { repo: true, pref: "never", canBuild: true })).toBe("/p/p1");
    expect(projectHref("p1", { repo: true, pref: "always", canBuild: false })).toBe("/p/p1");
  });
});
