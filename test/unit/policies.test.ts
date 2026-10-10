import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/db";
import {
  appConfig,
  appPolicyOf,
  connectRefusal,
  locationLabel,
  locationOf,
  mcpProblem,
  modelPolicyOf,
  modelPolicyProblem,
  placement,
  privateModelProblem,
  summaries,
} from "@/lib/policies";
import { FakeDb } from "./fake-db";

let db: FakeDb;
let role: Role;
let governance: boolean;
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/db", () => ({ createAdminDb: () => db, createServerDb: async () => db }));
vi.mock("@/server/workspace", () => ({
  getAppContext: async () => ({ user: { id: "me" }, name: "Jordan Lee", role, workspace: { id: "ws-1", name: "Acme", governanceEnabled: governance }, memberships: [] }),
}));

describe("where it runs (C-1)", () => {
  it("reads the seeded config, and only VPC keeps a region", () => {
    expect(locationOf({ mode: "lyzr_cloud", label: "Lyzr Cloud" })).toEqual({ mode: "lyzr_cloud", region: null });
    expect(locationOf({ mode: "customer_vpc" })).toEqual({ mode: "customer_vpc", region: "us-east-1" });
    expect(locationOf({ mode: "mars" })).toEqual({ mode: "lyzr_cloud", region: null });
    expect(locationLabel({ mode: "customer_vpc", region: "eu-west-1" })).toBe("Your AWS VPC · eu-west-1");
  });

  it("the picture: everything inside your VPC except a commercial model, which it says how to bring inside", () => {
    const models = modelPolicyOf({ allowed: ["gemini", "claude"], architect: "claude", agent_default: "gemini" });
    const vpc = placement({ mode: "customer_vpc", region: "eu-west-1" }, models);
    expect(vpc.zones.map((z) => [z.name, z.owner])).toEqual([
      ["Your AWS account · VPC in eu-west-1", "yours"],
      ["Lyzr control plane", "lyzr"],
      ["Model providers' APIs", "outside"],
    ]);
    expect(vpc.zones[0].components).toContain("Sandboxes (code and checks run here)");
    expect(vpc.zones[2].components).toEqual(["Architect's model: Claude Sonnet", "App agents' models: Gemini"]);
    expect(vpc.notes[0]).toMatch(/register your private model/);

    const own = modelPolicyOf({ allowed: ["private", "gemini"], architect: "private", agent_default: "private", private: { name: "Acme Llama", url: "https://llm.acme", kind: "own" } });
    const inside = placement({ mode: "customer_vpc", region: "eu-west-1" }, own);
    expect(inside.zones.map((z) => z.owner)).toEqual(["yours", "lyzr"]);
    expect(inside.zones[0].components).toContain("Architect's model: Acme Llama");
    expect(inside.notes).toEqual([]);
    expect(placement({ mode: "on_prem", region: null }, models).notes[0]).toMatch(/^Air-gapped/);
  });
});

describe("models (C-2)", () => {
  it("defaults, unknown models dropped, a private model only once registered", () => {
    expect(modelPolicyOf({ allowed: ["claude", "gpt", "gemini", "openrouter"] })).toEqual({ allowed: ["claude", "gpt", "gemini", "openrouter"], architect: "gemini", agentDefault: "gemini", private: null, ownKeys: [] });
    expect(modelPolicyOf({ allowed: ["claude", "llama", "private"] }).allowed).toEqual(["claude"]);
    expect(modelPolicyOf({ allowed: ["claude"], architect: "gpt" }).architect).toBe("claude");
    expect(modelPolicyOf(null).allowed).toEqual(["gemini", "claude", "gpt", "openrouter"]);
  });

  it("what can't be saved", () => {
    const p = modelPolicyOf({ allowed: ["gemini"] });
    expect(modelPolicyProblem({ ...p, allowed: [] })).toMatch(/^Allow at least one/);
    expect(modelPolicyProblem({ ...p, architect: "claude" })).toMatch(/^Architect's model/);
    expect(modelPolicyProblem({ ...p, allowed: ["gemini", "private"] })).toMatch(/^Register/);
    expect(modelPolicyProblem(p)).toBeNull();
    expect(privateModelProblem({ name: "Llama", url: "http://x" })).toBe("The endpoint has to use https.");
    expect(privateModelProblem({ name: "Llama", url: "nope" })).toMatch(/full URL/);
    expect(privateModelProblem({ name: " ", url: "https://x" })).toMatch(/^Give the model a name/);
    expect(privateModelProblem({ name: "Llama", url: "https://llm.acme.internal/v1" })).toBeNull();
  });
});

describe("apps and MCP servers (C-3)", () => {
  it("allowed list, scopes, who connects, MCP servers", () => {
    const p = appPolicyOf({ allow: ["gmail", "slack"], deny: ["hubspot"], scopes: { gmail: "read", slack: "bogus" }, who_can_connect: "admins", mcp: [{ name: "CRM", url: "https://mcp.acme" }, { name: 3 }] });
    expect(p).toEqual({ allow: ["gmail", "slack"], whoCanConnect: "admins", scopes: { gmail: "read" }, mcp: [{ name: "CRM", url: "https://mcp.acme" }] });
    expect(appConfig(p, ["gmail", "slack", "hubspot", "zendesk"]).deny).toEqual(["hubspot", "zendesk"]);
    expect(connectRefusal(p, true, false)).toMatch(/only Owners and Admins connect apps/);
    expect(connectRefusal(p, true, true)).toBeUndefined();
    expect(connectRefusal(p, false, false)).toBeUndefined();
    expect(mcpProblem({ name: "crm", url: "https://x" }, p.mcp)).toBe("There's already a server with that name.");
    expect(mcpProblem({ name: "Docs", url: "http://x" }, p.mcp)).toBe("The server's URL has to use https.");
    expect(mcpProblem({ name: "Docs", url: "https://mcp.docs" }, p.mcp)).toBeNull();
    expect(summaries({ location: { mode: "lyzr_cloud", region: null }, models: modelPolicyOf({ allowed: ["gemini"] }), apps: p })).toEqual({
      location: "Lyzr Cloud",
      models: "1 allowed · Architect: Gemini",
      apps: "2 apps allowed · 1 MCP server",
    });
  });
});

describe("policy actions", () => {
  beforeEach(() => {
    role = "admin";
    governance = true;
    db = new FakeDb({
      workspaces: [{ id: "ws-1", governance_enabled: true }],
      policies: [
        { id: "p-loc", workspace_id: "ws-1", kind: "location", config: { mode: "lyzr_cloud", label: "Lyzr Cloud" } },
        { id: "p-mod", workspace_id: "ws-1", kind: "models", config: { allowed: ["claude", "gpt", "gemini", "openrouter"] } },
        { id: "p-app", workspace_id: "ws-1", kind: "connectors", config: { allow: ["gmail", "slack"], deny: ["hubspot"] } },
      ],
      items: [],
      audit_log: [],
    });
  });

  it("Owners and Admins only, with governance on; v1 places only; every change audited", async () => {
    const { saveLocation } = await import("@/server/actions/policies");
    role = "builder";
    expect(await saveLocation({ mode: "customer_vpc", region: "eu-west-1" })).toMatchObject({ ok: false, message: expect.stringMatching(/^Only Owners and Admins/) });
    role = "admin";
    governance = false;
    expect(await saveLocation({ mode: "customer_vpc", region: "eu-west-1" })).toMatchObject({ ok: false, message: expect.stringMatching(/^Governance is off/) });
    governance = true;
    expect(await saveLocation({ mode: "on_prem", region: null })).toMatchObject({ ok: false, message: expect.stringMatching(/^Not in this version/) });
    expect(await saveLocation({ mode: "customer_vpc", region: "mars-1" })).toEqual({ ok: false, message: "Pick an AWS region." });
    expect(await saveLocation({ mode: "customer_vpc", region: "eu-west-1" })).toEqual({ ok: true });
    expect(db.tables.policies[0].config).toEqual({ mode: "customer_vpc", region: "eu-west-1", label: "Your AWS VPC · eu-west-1" });
    expect(db.tables.audit_log[0]).toMatchObject({ action: "policy.changed", target: "Where it runs: Your AWS VPC · eu-west-1", details: expect.objectContaining({ before: "Lyzr Cloud", after: "Your AWS VPC · eu-west-1" }) });
  });

  it("models: a private model is registered and allowed, picked for Architect, and can't be removed while it is", async () => {
    const { registerPrivateModel, removePrivateModel, saveModelPolicy } = await import("@/server/actions/policies");
    expect(await saveModelPolicy({ allowed: ["gemini"], architect: "claude", agentDefault: "gemini", ownKeys: [] })).toMatchObject({ ok: false, message: expect.stringMatching(/^Architect's model/) });
    expect(await registerPrivateModel({ name: "Acme Llama", url: "https://llm.acme.internal/v1", kind: "open_source" })).toEqual({ ok: true });
    expect((db.tables.policies[1].config as { allowed: string[] }).allowed).toContain("private");
    expect(await saveModelPolicy({ allowed: ["gemini", "private"], architect: "private", agentDefault: "gemini", ownKeys: ["gemini", "private"] })).toEqual({ ok: true });
    expect(db.tables.policies[1].config).toMatchObject({ allowed: ["gemini", "private"], architect: "private", agent_default: "gemini", own_keys: ["gemini"], private: { name: "Acme Llama" } });
    expect(await removePrivateModel()).toMatchObject({ ok: false, message: expect.stringMatching(/^It's Architect's model/) });

    // Pickers show only allowed models, the private one under its name.
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-google");
    const { modelSetupFor } = await import("@/server/project");
    const setup = await modelSetupFor("ws-1");
    expect(setup.options.map((o) => [o.choice, o.label, o.simulated])).toEqual([
      ["gemini", "Gemini", false],
      ["private", "Acme Llama", true],
    ]);
    expect(setup.architect).toBe("private");
  });

  it("apps: only known apps; MCP servers added once; with governance off, every model is allowed", async () => {
    const { addMcpServer, saveAppPolicy } = await import("@/server/actions/policies");
    expect(await saveAppPolicy({ allow: ["gmail", "made-up"], whoCanConnect: "admins", scopes: {} })).toEqual({ ok: false, message: "Pick from the apps shown." });
    expect(await saveAppPolicy({ allow: ["gmail", "hubspot"], whoCanConnect: "admins", scopes: { gmail: "read", slack: "read" } })).toEqual({ ok: true });
    expect(db.tables.policies[2].config).toMatchObject({ allow: ["gmail", "hubspot"], who_can_connect: "admins", scopes: { gmail: "read" } });
    expect((db.tables.policies[2].config as { deny: string[] }).deny).toContain("slack");
    expect(await addMcpServer({ name: "Acme CRM", url: "https://mcp.acme" })).toEqual({ ok: true });
    expect(await addMcpServer({ name: "acme crm", url: "https://mcp.acme" })).toMatchObject({ ok: false });

    db.tables.workspaces[0].governance_enabled = false;
    const { allowedModels } = await import("@/server/blueprint/write-plan");
    db.tables.policies[1].config = { allowed: ["gemini"] };
    expect(await allowedModels(db as never, "ws-1")).toEqual(["gemini", "claude", "gpt", "openrouter"]);
  });

  it("chat refuses a model the policy no longer allows, saves nothing and never switches it", async () => {
    const P = "11111111-1111-4111-8111-111111111111";
    db.tables.projects = [{ id: P, workspace_id: "ws-1", name: "Lead brief", model: "gpt", prompt: "x", status: "draft" }];
    db.tables.messages = [];
    db.tables.policies[1].config = { allowed: ["gemini"] };
    const { sendMessage } = await import("@/server/actions/chat");
    expect(await sendMessage({ projectId: P, content: "Add a weekly summary", talkFirst: true })).toEqual({
      ok: false,
      message: "This model is no longer allowed in this workspace. Switch model to carry on. Your message wasn't sent.",
    });
    expect(db.tables.messages).toEqual([]);
    expect(db.tables.projects[0].model).toBe("gpt");
  });
});
