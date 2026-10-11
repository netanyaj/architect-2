import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/db";
import { FakeDb } from "./fake-db";

/* MCP servers in Connections (M6, BL-9): who can add one, the allowed list with governance on, the header in Vault,
   10 tests per person an hour, and every test audited. The MCP call itself is mocked here (mcp-client.test.ts and a
   live check cover it). */

let db: FakeDb;
let role: Role;
let governance: boolean;
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/db", () => ({ createAdminDb: () => db, createServerDb: async () => db }));
vi.mock("@/server/workspace", () => ({
  getAppContext: async () => ({ user: { id: "me" }, name: "Morgan Lee", role, workspace: { id: "ws-1", name: "Acme", governanceEnabled: governance }, memberships: [] }),
}));
vi.mock("@/server/policy", () => ({
  loadPolicies: async () => ({ governance, apps: { allow: [], whoCanConnect: "builders", scopes: {}, mcp: [{ name: "Docs", url: "https://docs.example.com/mcp" }] } }),
}));
const test = vi.fn(async () => ({ ok: true, serverName: "Docs", tools: [{ name: "search", description: "" }, { name: "read", description: "" }] }));
vi.mock("@/server/mcp-client", async (orig) => ({ ...(await orig<object>()), testMcpServer: (...a: unknown[]) => test(...(a as [])) }));

const actions = () => import("@/server/actions/mcp");

beforeEach(() => {
  vi.resetModules();
  role = "builder";
  governance = true;
  test.mockClear();
  db = new FakeDb({ connections: [], audit_log: [] });
});

describe("MCP servers in Connections", () => {
  it("with governance on, only servers on the allowed list; adding stores the header in Vault and runs one audited test", async () => {
    const { addMcpServer } = await actions();
    expect(await addMcpServer({ name: "Other", url: "https://other.example.com/mcp" })).toMatchObject({ ok: false, message: expect.stringMatching(/isn't on your organisation's list/) });
    const r = await addMcpServer({ name: "Docs", url: "https://docs.example.com/mcp/", authHeader: "Authorization: Bearer abc" });
    expect(r).toMatchObject({ ok: true, check: { ok: true, tools: ["search", "read"] } });
    expect(db.tables.connections[0]).toMatchObject({ kind: "mcp", provider: "mcp", name: "Docs", status: "connected", tools: [{ name: "search" }, { name: "read" }] });
    // The header goes to Vault, never into the row.
    expect(db.rpcCalls.find((c) => c.fn === "set_connection_secret")?.args).toMatchObject({ p_value: "Authorization: Bearer abc" });
    expect(JSON.stringify(db.tables.connections[0])).not.toContain("Bearer abc");
    expect(db.tables.audit_log.map((a) => a.action)).toEqual(["mcp.added", "mcp.tested"]);
  });

  it("with governance off, Builders and up add any HTTPS server; Viewers can't; private addresses are refused", async () => {
    governance = false;
    const { addMcpServer } = await actions();
    expect(await addMcpServer({ name: "Mine", url: "https://mine.example.com/mcp" })).toMatchObject({ ok: true });
    expect(await addMcpServer({ name: "Local", url: "https://127.0.0.1/mcp" })).toMatchObject({ ok: false, message: expect.stringMatching(/private or local/) });
    expect(await addMcpServer({ name: "Plain", url: "http://mine.example.com/mcp" })).toMatchObject({ ok: false, message: "The URL has to start with https://." });
    role = "viewer";
    expect(await addMcpServer({ name: "V", url: "https://v.example.com/mcp" })).toMatchObject({ ok: false, message: expect.stringMatching(/^Viewers can't/) });
  });

  it("a failed test says why and leaves it not connected; tests stop at 10 an hour per person", async () => {
    governance = false;
    const { addMcpServer, testMcpConnection } = await actions();
    test.mockResolvedValueOnce({ ok: false, error: "Needs a valid auth header." } as never);
    await addMcpServer({ name: "Mine", url: "https://mine.example.com/mcp" });
    // Real rows have UUIDs; the fake database's ids don't.
    const connectionId = "55555555-5555-4555-8555-555555555555";
    db.tables.connections[0].id = connectionId;
    expect(db.tables.connections[0]).toMatchObject({ status: "missing", check_error: "Needs a valid auth header." });
    for (let i = 0; i < 9; i++) {
      expect(await testMcpConnection({ connectionId })).toMatchObject({ ok: true });
      // Postgres stamps created_at; the fake database doesn't.
      for (const a of db.tables.audit_log) a.created_at ??= new Date().toISOString();
    }
    expect(await testMcpConnection({ connectionId })).toEqual({ ok: false, message: "Up to 10 connection tests an hour. Try again later." });
    expect(db.tables.audit_log.filter((a) => a.action === "mcp.tested")).toHaveLength(10);
  });
});
