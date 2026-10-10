import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/db";
import { blockedLine, dataFlow, egressOf, egressOfDraft, hostProblem, modelHost } from "@/lib/egress";
import { launchState } from "@/lib/launch";
import { modelPolicyOf } from "@/lib/policies";
import { FakeDb } from "./fake-db";

let db: FakeDb;
let role: Role;
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/db", () => ({ createAdminDb: () => db, createServerDb: async () => db }));
vi.mock("@/server/workspace", () => ({
  getAppContext: async () => ({ user: { id: "me" }, name: "Jordan Lee", role, workspace: { id: "ws-1", name: "Acme", governanceEnabled: true }, memberships: [] }),
}));

const SEED_HOSTS = { mode: "allow_list", hosts: ["slack.com", "googleapis.com", "zendesk.com"] };
const models = modelPolicyOf({ allowed: ["gemini", "claude"] });
const parts = [
  { title: "Calendar events read", status: "built", grp: "integrations", provider: "google_calendar" },
  { title: "HubSpot contact lookup", status: "built", grp: "integrations", provider: "hubspot" },
  { title: "Old CRM sync", status: "deferred", grp: "integrations", provider: "salesforce" },
  { title: "Brief writer", status: "built", grp: "agents", provider: null },
];

describe("data flow (C-4)", () => {
  it("apps go to their API host, agents to their model; the seed's hosts cover Google but not HubSpot", () => {
    const egress = egressOf(SEED_HOSTS);
    expect(egress.redact).toEqual(["email", "phone", "card"]);
    const paths = dataFlow({ parts, agentModels: [{ name: "Brief writer", model: "gpt" }], egress, models });
    expect(paths.map((p) => [p.id, p.host, p.allowed])).toEqual([
      ["app-google_calendar", "www.googleapis.com", true],
      ["app-hubspot", "api.hubapi.com", false],
      ["model-gpt", "api.openai.com", false],
    ]);
    expect(paths[1].rule).toBe("Data may only go to hosts on your allowed list (Data and egress)");
    expect(paths[2].rule).toBe("Data may only go to models your organisation allows (Models)");
    expect(paths[2].redacted).toEqual(["email addresses", "phone numbers", "payment card numbers"]);
    expect(paths[0].redacted).toEqual([]);
    expect(blockedLine(paths[1])).toEqual({ title: "Contact details would go to api.hubapi.com, which isn't allowed", detail: "From HubSpot contact lookup. Data may only go to hosts on your allowed list (Data and egress)." });
    // A draft list that adds the host frees the path.
    expect(egressOfDraft(["hubapi.com"])(paths[1]).allowed).toBe(true);
  });

  it("hosts and the private endpoint", () => {
    expect(hostProblem("https://api.hubapi.com/v3", [])).toMatch(/^Type a host name/);
    expect(hostProblem("api.hubapi.com", ["api.hubapi.com"])).toBe("api.hubapi.com is already on the list.");
    expect(hostProblem("API.hubapi.com", [])).toBeNull();
    const own = modelPolicyOf({ allowed: ["private"], private: { name: "Llama", url: "https://llm.acme.internal/v1", kind: "own" } });
    expect(modelHost("private", own)).toBe("llm.acme.internal");
  });

  it("Launch: a path that isn't allowed is a checklist row and holds every deploy", () => {
    const flows = dataFlow({ parts, agentModels: [], egress: egressOf(SEED_HOSTS), models });
    const base = {
      parts: [{ id: "i", key: "a", title: "A", status: "built", provider: null, estimate: 10 }],
      deployments: [{ id: "d", environment: "staging" as const, version: 1, status: "live", createdAt: "2026-10-10T08:00:00Z", by: null }],
      envLive: { staging: true, production: false },
      currentVersion: 1,
      role: "owner" as Role,
      governance: true,
      liveRequested: false,
      testsPassed: 3,
    };
    const s = launchState({ ...base, flows });
    expect(s.rows.filter((r) => r.kind === "egress").map((r) => r.title)).toEqual(["Contact details would go to api.hubapi.com, which isn't allowed"]);
    expect(s.goLive.disabledReason).toBe("Data would go somewhere your organisation doesn't allow. Fix it in the checklist first.");
    expect(s.share.disabledReason).toMatch(/^Fix 1 thing/);
    expect(launchState({ ...base, flows: [] }).goLive.disabledReason).toBeUndefined();
  });
});

describe("egress actions", () => {
  beforeEach(() => {
    role = "admin";
    db = new FakeDb({ workspaces: [{ id: "ws-1", governance_enabled: true }], policies: [{ id: "e", workspace_id: "ws-1", kind: "egress", config: SEED_HOSTS }], audit_log: [] });
  });

  it("an admin allows one host from Launch, or saves the list and redaction; Builders can't", async () => {
    const { allowHost, saveEgress } = await import("@/server/actions/policies");
    role = "builder";
    expect(await allowHost({ host: "api.hubapi.com" })).toMatchObject({ ok: false });
    role = "admin";
    expect(await allowHost({ host: "API.hubapi.com", projectId: "11111111-1111-4111-8111-111111111111" })).toEqual({ ok: true });
    expect(db.tables.policies[0].config).toEqual({ mode: "allow_list", hosts: ["slack.com", "googleapis.com", "zendesk.com", "api.hubapi.com"], redact: ["email", "phone", "card"] });
    expect(db.tables.audit_log[0]).toMatchObject({ action: "policy.changed", target: "Host allowed: api.hubapi.com" });
    expect(await saveEgress({ hosts: ["slack.com", "slack.com"], redact: [] })).toEqual({ ok: false, message: "slack.com is already on the list." });
    expect(await saveEgress({ hosts: ["slack.com"], redact: ["name"] })).toEqual({ ok: true });
    expect(db.tables.policies[0].config).toEqual({ mode: "allow_list", hosts: ["slack.com"], redact: ["name"] });
  });
});
