import { describe, expect, it, vi } from "vitest";

/* The daily cron deletes demo visitors (anonymous sign-ins) older than 7 days, with the workspaces they own (M5.10). */

vi.mock("server-only", () => ({}));
const { deleteExpiredDemoUsers } = await import("@/server/demo");

describe("demo cleanup", () => {
  it("deletes anonymous users past 7 days and their workspaces; keeps newer ones and real accounts", async () => {
    const now = new Date("2026-10-20T03:00:00Z");
    const day = 24 * 3600_000;
    const users = [
      { id: "old-demo", is_anonymous: true, created_at: new Date(now.getTime() - 8 * day).toISOString() },
      { id: "new-demo", is_anonymous: true, created_at: new Date(now.getTime() - 2 * day).toISOString() },
      { id: "old-real", is_anonymous: false, created_at: new Date(now.getTime() - 30 * day).toISOString() },
    ];
    const deletedUsers: string[] = [];
    const deletedWorkspaces: string[] = [];
    const admin = {
      auth: { admin: { listUsers: async () => ({ data: { users }, error: null }), deleteUser: async (id: string) => void deletedUsers.push(id) } },
      from: (t: string) => ({
        select: () => ({ eq: (_c: string, uid: string) => ({ eq: async () => ({ data: t === "members" ? [{ workspace_id: `ws-of-${uid}` }] : [] }) }) }),
        delete: () => ({ eq: async (_c: string, id: string) => void deletedWorkspaces.push(id) }),
      }),
    };
    expect(await deleteExpiredDemoUsers(admin as never, now)).toBe(1);
    expect(deletedUsers).toEqual(["old-demo"]);
    expect(deletedWorkspaces).toEqual(["ws-of-old-demo"]);
  });
});
