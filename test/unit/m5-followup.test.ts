import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiKeyEnvName, apiKeyProblem, apiKeyServiceId } from "@/lib/api-keys";
import type { Role } from "@/lib/db";
import { envKeys } from "@/lib/dev-view";
import { analyzeRepo } from "@/lib/repo-analysis";
import { FakeDb } from "./fake-db";

/* M5 follow-up (gap analysis, 11 Oct): API key connections, and the rest of the build list below. */

let db: FakeDb;
let role: Role;
let governance = true;
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/db", () => ({ createAdminDb: () => db, createServerDb: async () => db }));
vi.mock("@/server/workspace", () => ({
  getAppContext: async () => ({ user: { id: "me" }, name: "Rita", role, workspace: { id: "ws-1", name: "Acme", governanceEnabled: governance }, memberships: [] }),
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
