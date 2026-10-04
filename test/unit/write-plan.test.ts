import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Blueprint } from "@/lib/blueprint";
import type { Role } from "@/lib/db";
import type { PlanEvent } from "@/server/blueprint/write-plan";
import { FakeDb } from "./fake-db";

/* ---------- the model is replaced by a recorded plan; everything else is the real code ---------- */

const plan: Blueprint = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "blueprints", "meeting-prep.gemini.json"), "utf8"));
const generate = vi.fn();
vi.mock("@/server/blueprint/generate", async (orig) => ({
  ...(await orig<object>()),
  generateBlueprint: (...a: unknown[]) => generate(...a),
}));
vi.mock("@/lib/gateway", async () => {
  class GatewayRateLimited extends Error {}
  class GatewayUnavailable extends Error {}
  return {
    GatewayRateLimited,
    GatewayUnavailable,
    resolveModel: (m: string) => ({ choice: m, label: m === "claude" ? "Claude Sonnet" : "Gemini", simulated: m === "claude", model: null }),
  };
});

const { writePlan, PlanRefused } = await import("@/server/blueprint/write-plan");
const { BlueprintInvalid } = await import("@/server/blueprint/generate");
const { GatewayRateLimited } = await import("@/lib/gateway");

const PROJECT = "11111111-1111-4111-8111-111111111111";
let db: FakeDb;
let events: PlanEvent[];
const ctx = (role: Role = "owner") => ({ user: { id: "me" }, name: "Morgan Lee", role, workspace: { id: "ws-1", name: "Acme" }, memberships: [] }) as never;

function run(opts: { role?: Role; model?: "gemini" | "claude" | "gpt"; prompt?: string } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return writePlan({ admin: db as any, ctx: ctx(opts.role), projectId: PROJECT, model: opts.model, prompt: opts.prompt }, (e) => events.push(e));
}

beforeEach(() => {
  events = [];
  generate.mockReset();
  db = new FakeDb({
    projects: [{ id: PROJECT, workspace_id: "ws-1", name: "Untitled app", prompt: "Before each meeting on my calendar, send me a Slack brief with each attendee's last email thread, a summary of any attached agenda PDF, and three talking points.", model: "gemini" }],
    policies: [{ workspace_id: "ws-1", kind: "models", config: { allowed: ["gemini", "openrouter", "claude"] } }],
    blueprints: [],
    items: [],
    questions: [],
    defaults: [],
    usage_ledger: [],
    files: [],
  });
});

describe("writePlan", () => {
  it("streams each part with a server-side price, then saves the plan, names the project and adds a Usage line", async () => {
    generate.mockImplementation(async (_input, ev) => {
      for (const [i, item] of plan.items.entries()) await ev.onItem(item, i);
      return { blueprint: plan, tokens: 4500, label: "Gemini", simulated: false, ms: 5000 };
    });
    await run();

    expect(events[0]).toMatchObject({ type: "started", version: 1, model: { label: "Gemini", simulated: false } });
    const parts = events.filter((e) => e.type === "item");
    expect(parts).toHaveLength(plan.items.length);
    for (const e of parts) if (e.type === "item") expect(e.item.estimate.likely).toBeGreaterThan(0);
    expect(events.at(-1)).toMatchObject({ type: "done", name: plan.name, blocking: 1 });

    const bp = db.tables.blueprints[0];
    expect(bp).toMatchObject({ version: 1, generation: "ready", name: plan.name, drafting_credits: 2 });
    expect(Number(bp.total_likely)).toBe(db.tables.items.reduce((s, i) => s + Number(i.estimate_likely), 0));
    expect(db.tables.items.every((i) => i.status === "proposed")).toBe(true);
    expect(db.tables.questions.filter((q) => q.blocking)).toHaveLength(1);
    expect(db.tables.projects[0]).toMatchObject({ name: plan.name, model: "gemini", current_version: 1 });
    expect(db.tables.usage_ledger).toEqual([expect.objectContaining({ kind: "blueprint", credits: 2, note: "Plan written · v1" })]);
    expect(db.tables.runs ?? []).toEqual([]); // never starts a build
  });

  it("prices never come from the model: estimates follow the chosen model's factor", async () => {
    generate.mockResolvedValue({ blueprint: plan, tokens: 100, label: "x", simulated: true, ms: 1 });
    await run({ model: "claude" });
    const claude = db.tables.items.reduce((s, i) => s + Number(i.estimate_likely), 0);
    db.tables.blueprints = [];
    db.tables.items = [];
    await run({ model: "gemini" });
    const gemini = db.tables.items.filter((i) => i.blueprint_id === db.tables.blueprints.at(-1)!.id).reduce((s, i) => s + Number(i.estimate_likely), 0);
    expect(gemini).toBeLessThan(claude);
    expect(db.tables.usage_ledger[0].note).toBe("Plan written · v1 · Claude Sonnet (simulated)");
  });

  it("on the retry, throws away the first attempt's parts and says so", async () => {
    generate.mockImplementation(async (_input, ev) => {
      await ev.onItem({ ...plan.items[0], key: "wrong-one" }, 0);
      await ev.onRetry(["Item quotes words that aren't in the request."]);
      for (const [i, item] of plan.items.entries()) await ev.onItem(item, i);
      return { blueprint: plan, tokens: 9000, label: "Gemini", simulated: false, ms: 9000 };
    });
    await run();
    expect(events.map((e) => e.type)).toContain("reset");
    expect(db.tables.items.map((i) => i.key)).not.toContain("wrong-one");
    expect(db.tables.items).toHaveLength(plan.items.length);
  });

  it("a rate limit keeps the parts written so far and marks the plan failed (the paused banner)", async () => {
    generate.mockImplementation(async (_input, ev) => {
      await ev.onItem(plan.items[0], 0);
      await ev.onItem(plan.items[1], 1);
      throw new GatewayRateLimited("Gemini");
    });
    await run();
    expect(events.at(-1)).toMatchObject({ type: "error", kind: "rate_limited", kept: 2 });
    expect(db.tables.blueprints[0]).toMatchObject({ generation: "failed", error_kind: "rate_limited" });
    expect(db.tables.items).toHaveLength(2);
    expect(db.tables.usage_ledger).toEqual([]); // nothing charged for a plan that didn't finish
  });

  it("a plan that fails its checks twice is the stopped-part-way error", async () => {
    generate.mockRejectedValue(new BlueprintInvalid(["bad"]));
    await run();
    expect(events.at(-1)).toMatchObject({ type: "error", kind: "invalid" });
  });

  it("refuses before saving anything: Viewers, other workspaces, disallowed models, an empty request", async () => {
    await expect(run({ role: "viewer" })).rejects.toBeInstanceOf(PlanRefused);
    await expect(run({ model: "gpt" })).rejects.toThrow("GPT isn't allowed in this workspace. Pick another model.");
    await expect(run({ prompt: "   " })).rejects.toThrow("Describe what you want first.");
    db.tables.projects[0].workspace_id = "ws-other";
    await expect(run()).rejects.toThrow("That project isn't in this workspace.");
    expect(db.tables.blueprints).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
  });

  it("an edited request is saved on the project and written as the next version", async () => {
    generate.mockResolvedValue({ blueprint: plan, tokens: 100, label: "Gemini", simulated: false, ms: 1 });
    db.tables.blueprints.push({ id: "old", project_id: PROJECT, version: 1 });
    await run({ prompt: "Before each meeting on my calendar, send me a Slack brief with three talking points." });
    expect(events[0]).toMatchObject({ type: "started", version: 2 });
    expect(db.tables.projects[0].prompt).toBe("Before each meeting on my calendar, send me a Slack brief with three talking points.");
  });
});
