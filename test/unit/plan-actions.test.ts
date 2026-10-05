import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/db";
import { FakeDb } from "./fake-db";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
let db: FakeDb;
let role: Role;
const rpc = vi.fn();
vi.mock("@/server/db", () => ({ createAdminDb: () => Object.assign(db, { rpc }), createServerDb: async () => db }));
vi.mock("@/server/workspace", () => ({
  getAppContext: async () => ({ user: { id: "me" }, name: "Morgan", role, workspace: { id: "ws-1", name: "Acme" }, memberships: [] }),
}));
vi.mock("@/server/blueprint/write-plan", () => ({ allowedModels: async () => ["gemini", "openrouter", "claude"] }));
const startRun = vi.fn();
vi.mock("@/server/sim/run", async (orig) => ({ ...(await orig<object>()), startRun: (...a: unknown[]) => startRun(...a) }));

const { answerQuestion, editItem, buildPlan, setProjectModel, changeDefault } = await import("@/server/actions/plan");

const BP = "11111111-1111-4111-8111-111111111111";
const Q = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const DEF = "44444444-4444-4444-8444-444444444444";
const PROJECT = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  role = "owner";
  rpc.mockReset();
  startRun.mockReset();
  db = new FakeDb({
    blueprints: [{ id: BP, project_id: PROJECT, agreed_at: null, generation: "ready", total_likely: 120, projects: { workspace_id: "ws-1", budget_credits: 100 } }],
    questions: [{ id: Q, blueprint_id: BP, options: [{ value: "connected" }, { value: "other" }], answer: null }],
    items: [{ id: ITEM, blueprint_id: BP, title: "Brief", description: "d", proved_when: "p" }],
    defaults: [{ id: DEF, blueprint_id: BP, value: "30 minutes before", alternatives: ["1 hour before"] }],
    projects: [{ id: PROJECT, workspace_id: "ws-1", model: "gemini" }],
  });
});

describe("answerQuestion / changeDefault", () => {
  it("records the answer and who gave it", async () => {
    expect(await answerQuestion({ questionId: Q, value: "connected" })).toEqual({ ok: true });
    expect(db.tables.questions[0]).toMatchObject({ answer: "connected", answered_by: "me" });
  });
  it("only accepts the answers shown, and not from Viewers or on agreed plans", async () => {
    expect(await answerQuestion({ questionId: Q, value: "made-up" })).toEqual({ ok: false, message: "Pick one of the answers shown." });
    db.tables.blueprints[0].agreed_at = "2026-10-04";
    expect(await answerQuestion({ questionId: Q, value: "connected" })).toMatchObject({ ok: false, message: expect.stringContaining("This version is agreed") });
    role = "viewer";
    expect(await answerQuestion({ questionId: Q, value: "connected" })).toMatchObject({ ok: false, message: expect.stringContaining("Viewers can't change the plan") });
  });
  it("switches a default to an alternative, keeping the old value to switch back", async () => {
    expect(await changeDefault({ defaultId: DEF, value: "1 hour before" })).toEqual({ ok: true });
    expect(db.tables.defaults[0]).toMatchObject({ value: "1 hour before", alternatives: ["30 minutes before"] });
    expect(await changeDefault({ defaultId: DEF, value: "never" })).toMatchObject({ ok: false });
  });
});

describe("editItem", () => {
  it("saves new wording and marks it edited", async () => {
    expect(await editItem({ itemId: ITEM, title: "Brief writer", description: "Writes the brief", provedWhen: "A brief under 200 words is posted" })).toEqual({ ok: true });
    expect(db.tables.items[0]).toMatchObject({ title: "Brief writer", proved_when: "A brief under 200 words is posted" });
    expect(db.tables.items[0].edited_at).toBeTruthy();
  });
  it("keeps the plan's limits", async () => {
    expect(await editItem({ itemId: ITEM, title: "x".repeat(61), description: "", provedWhen: "p" })).toEqual({ ok: false, message: "Keep the title under 60 characters." });
    expect(await editItem({ itemId: ITEM, title: "ok", description: "", provedWhen: " " })).toEqual({ ok: false, message: "Say how Architect can check it works." });
  });
});

describe("buildPlan (the only way a build starts)", () => {
  it("goes through the database's Build gate as the person who clicked, then starts that run", async () => {
    rpc.mockResolvedValue({ data: "run-1", error: null });
    expect(await buildPlan({ blueprintId: BP })).toEqual({ ok: true, runId: "run-1" });
    expect(rpc).toHaveBeenCalledWith("agree_and_build", { p_blueprint: BP, p_user: "me", p_kind: "build" });
    expect(startRun).toHaveBeenCalledWith(expect.anything(), "run-1", { variant: "default", speed: 1 });
  });
  it("passes the demo variant from ?sim= through", async () => {
    rpc.mockResolvedValue({ data: "run-1", error: null });
    await buildPlan({ blueprintId: BP, sim: "paused,fast" });
    expect(startRun).toHaveBeenCalledWith(expect.anything(), "run-1", { variant: "paused", speed: 0.25 });
  });
  it("turns the gate's refusals into plain reasons", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "blocking_questions_open" } });
    expect(await buildPlan({ blueprintId: BP })).toEqual({ ok: false, message: "Answer the open question first. It holds Build because there's no safe default." });
    rpc.mockResolvedValue({ data: null, error: { message: "over_budget" } });
    expect(await buildPlan({ blueprintId: BP })).toMatchObject({ ok: false, message: expect.stringContaining("~120 credits would go past the project's 100-credit budget") });
  });
  it("Viewers never reach the gate; other workspaces' plans are refused", async () => {
    role = "viewer";
    expect(await buildPlan({ blueprintId: BP })).toEqual({ ok: false, message: "Viewers can't build. Ask an Owner, Admin or Builder." });
    role = "owner";
    db.tables.blueprints[0].projects = { workspace_id: "ws-other" };
    expect(await buildPlan({ blueprintId: BP })).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
    expect(startRun).not.toHaveBeenCalled();
  });
});

describe("setProjectModel", () => {
  it("only allowed models", async () => {
    expect(await setProjectModel({ projectId: PROJECT, model: "claude" })).toEqual({ ok: true });
    expect(db.tables.projects[0].model).toBe("claude");
    expect(await setProjectModel({ projectId: PROJECT, model: "gpt" })).toEqual({ ok: false, message: "GPT isn't allowed in this workspace." });
  });
});

describe("editItem: the conflict guard covers edits too (A-3)", () => {
  const strong = "Done when briefs stay under 200 words and name every attendee";
  beforeEach(() => {
    db.tables.items[0].proved_when = strong;
  });
  it("an edit that drops a line of the check needs a decision; nothing is saved until then", async () => {
    const r = await editItem({ itemId: ITEM, title: "Brief", description: "d", provedWhen: "Done when briefs name every attendee" });
    expect(r).toMatchObject({ ok: false, conflict: { before: strong, after: "Done when briefs name every attendee" } });
    expect(db.tables.items[0].proved_when).toBe(strong);
  });
  it("Keep saves the wording but not the weaker check; Set aside defers the part; Drop needs a reason and records it", async () => {
    const weaker = { itemId: ITEM, title: "Brief v2", description: "d", provedWhen: "Done when briefs stay under 400 words and name every attendee" };
    expect(await editItem({ ...weaker, decision: { decision: "keep" } })).toEqual({ ok: true, applied: "kept" });
    expect(db.tables.items[0]).toMatchObject({ title: "Brief v2", proved_when: strong });
    expect(await editItem({ ...weaker, decision: { decision: "drop" } })).toMatchObject({ ok: false, message: expect.stringContaining("Say why") });
    expect(await editItem({ ...weaker, decision: { decision: "drop", reason: "Long meetings need room" } })).toEqual({ ok: true, applied: "edit" });
    expect(db.tables.items[0]).toMatchObject({ proved_when: weaker.provedWhen, drop_reason: "Weakened: Long meetings need room" });
    db.tables.items[0].proved_when = strong;
    expect(await editItem({ ...weaker, decision: { decision: "defer" } })).toEqual({ ok: true, applied: "deferred" });
    expect(db.tables.items[0].status).toBe("deferred");
  });
  it("an edit that keeps every line goes straight through", async () => {
    expect(await editItem({ itemId: ITEM, title: "Brief", description: "d", provedWhen: `${strong}, sent by Slack` })).toEqual({ ok: true });
  });
});
