import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/db";
import { agentSession, codingAgentUpdate, MCP_TOOLS, SCOPES, sessionLine, sessionPart } from "@/lib/mcp";
import { FakeDb } from "./fake-db";

let db: FakeDb;
let role: Role;
let governance: boolean;
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/db", () => ({ createAdminDb: () => db, createServerDb: async () => db }));
vi.mock("@/server/workspace", () => ({
  getAppContext: async () => ({ user: { id: "me" }, name: "Sam Lee", role, workspace: { id: "ws-1", name: "Acme", governanceEnabled: governance }, memberships: [] }),
}));

const P = "11111111-1111-4111-8111-111111111111";

describe("the MCP spec", () => {
  it("lists the seven tools, each in a scope", () => {
    expect(MCP_TOOLS.map((t) => t.name)).toEqual(["get_blueprint", "update_item", "run_in_sandbox", "run_tests", "open_pr", "request_approval", "get_preview_url"]);
    for (const t of MCP_TOOLS) expect(SCOPES.some((s) => s.id === t.scope && s.tools.includes(t.name))).toBe(true);
  });
});

describe("codingAgentUpdate: only the checker marks a part Works", () => {
  it("a change sends the part to wait for its check; asking for Works (or any status) is refused", () => {
    expect(codingAgentUpdate({ instructions: "Shorter brief" })).toEqual({ ok: true, status: "waiting_for_check" });
    expect(codingAgentUpdate({ status: "built" })).toEqual({ ok: false, reason: "Only the checker can mark a part Works. It re-runs the part's check after this change." });
    expect(codingAgentUpdate({ status: "agreed" })).toEqual({ ok: false, reason: "A coding agent can't set a part's status." });
  });
});

describe("the scripted session (?sim=byoagent)", () => {
  const parts = [
    { key: "calendar", title: "Calendar sync", grp: "integrations", status: "built" },
    { key: "brief-writer", title: "Brief writer", grp: "agents", status: "built" },
  ];
  it("picks Brief writer, else an agent that works, else any part that works", () => {
    expect(sessionPart(parts)?.key).toBe("brief-writer");
    expect(sessionPart([parts[0], { key: "a", title: "Scorer", grp: "agents", status: "built" }])?.key).toBe("a");
    expect(sessionPart([{ key: "x", title: "X", grp: "agents", status: "agreed" }])).toBeNull();
  });

  it("updates the part, is refused Works, waits for the check, and the checker passes it", () => {
    const s = agentSession({ part: parts[1], partCount: 2, version: 1, owner: "Sam", repo: true });
    const lines = s.steps.map((step) => sessionLine(s, step));
    expect(lines).toContain("Coding agent: Claude Code (Sam) · via MCP · updated ‘Brief writer’");
    expect(lines).toContain("Coding agent: Claude Code (Sam) · via MCP · tried to mark ‘Brief writer’ Works · refused: Only the checker can mark a part Works. It re-runs the part's check after this change.");
    expect(lines).toContain("Checker · Passed 3 of 3 · ‘Brief writer’ works");
    // Every permission rule applies to the agent (C-10): each attempt is refused and points at request_approval.
    for (const tried of ["tried to deploy to Live", "tried to merge its branch into main", "tried to set a key for Live", "tried to call an outside service with a key on Live"]) {
      expect(lines.find((l) => l.includes(tried))).toMatch(/· refused: .*use request_approval$/);
    }
    // Without a repo there's no main to merge into.
    expect(agentSession({ part: parts[1], partCount: 2, version: 1, owner: "Sam", repo: false }).steps.some((x) => x.text.includes("merge"))).toBe(false);
    expect(lines.at(-1)).toBe("Coding agent: Claude Code (Sam) · via MCP · opened a pull request for ‘Brief writer’");
    // The part waits from the change until the checker passes it; the agent's own test run is inside that window.
    const tests = s.steps.find((x) => x.text.startsWith("ran the tests"))!;
    expect(tests.atMs).toBeGreaterThan(s.waitFromMs);
    expect(tests.atMs).toBeLessThan(s.worksAtMs);
    expect(s.steps.find((x) => x.text.endsWith("works"))!.who).toBe("checker");
  });
});

describe("project tokens", () => {
  beforeEach(() => {
    role = "builder";
    governance = true;
    db = new FakeDb({ projects: [{ id: P, name: "ticket-triage", workspace_id: "ws-1" }], project_tokens: [], approvals: [], audit_log: [] });
  });

  it("shows the token once and stores only its hash and last 4; with governance on it waits for approval", async () => {
    const { createProjectToken } = await import("@/server/actions/tokens");
    const r = await createProjectToken({ projectId: P, name: "Sam's Claude Code", scopes: ["read_plan", "change_parts"] });
    if (!r.ok) throw new Error(r.message);
    expect(r.token).toMatch(/^ax_pt_[A-Za-z0-9_-]{43}$/);
    expect(r.status).toBe("waiting");
    const row = db.tables.project_tokens[0];
    expect(row).toMatchObject({ name: "Sam's Claude Code", scopes: ["read_plan", "change_parts"], last4: r.token.slice(-4), status: "waiting" });
    expect(JSON.stringify(row)).not.toContain(r.token);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(db.tables.approvals[0]).toMatchObject({ kind: "token", title: "ticket-triage: coding agent token “Sam's Claude Code”" });
    expect(row.approval_id).toBe(db.tables.approvals[0].id);
  });

  it("without governance it's active at once", async () => {
    governance = false;
    const { createProjectToken } = await import("@/server/actions/tokens");
    expect(await createProjectToken({ projectId: P, name: "Cursor", scopes: ["run"] })).toMatchObject({ ok: true, status: "active" });
    expect(db.tables.approvals).toEqual([]);
  });

  it("Owners and Admins approve; anyone who can build revokes; Viewers and bad input are refused", async () => {
    const { approveProjectToken, createProjectToken, revokeProjectToken } = await import("@/server/actions/tokens");
    await createProjectToken({ projectId: P, name: "Cursor", scopes: ["run"] });
    const id = "33333333-3333-4333-8333-333333333333";
    Object.assign(db.tables.project_tokens[0], { id, project_id: P, projects: { id: P, name: "ticket-triage", workspace_id: "ws-1" } });
    expect(await approveProjectToken({ tokenId: id })).toEqual({ ok: false, message: "Only Owners and Admins approve tokens." });
    role = "admin";
    expect(await approveProjectToken({ tokenId: id })).toEqual({ ok: true });
    expect(db.tables.project_tokens[0].status).toBe("active");
    expect(db.tables.approvals[0]).toMatchObject({ status: "approved", decided_by: "me" });
    role = "builder";
    expect(await revokeProjectToken({ tokenId: id })).toEqual({ ok: true });
    expect(db.tables.project_tokens[0]).toMatchObject({ status: "revoked" });
    role = "viewer";
    expect(await createProjectToken({ projectId: P, name: "x", scopes: ["run"] })).toMatchObject({ ok: false, message: expect.stringMatching(/^Viewers can't/) });
    role = "builder";
    expect(await createProjectToken({ projectId: P, name: " ", scopes: ["run"] })).toMatchObject({ ok: false });
    expect(await createProjectToken({ projectId: P, name: "x", scopes: [] })).toEqual({ ok: false, message: "Pick at least one thing the agent may do." });
  });
});
