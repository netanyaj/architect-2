import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/db";
import { FakeDb } from "./fake-db";

/* M5.8: intent replaces the Ask · Make changes switch (BL-4). The gateway is mocked: no model calls. */
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
let db: FakeDb;
let role: Role;
vi.mock("@/server/db", () => ({ createAdminDb: () => db, createServerDb: async () => db }));
vi.mock("@/server/workspace", () => ({
  getAppContext: async () => ({ user: { id: "me" }, name: role === "viewer" ? "Priya" : "Morgan", role, workspace: { id: "ws-1", name: "Acme" }, memberships: [] }),
}));
vi.mock("@/server/blueprint/write-plan", () => ({ allowedModels: async () => ["gemini", "claude"] }));
const ask = vi.fn();
const askObject = vi.fn();
vi.mock("@/lib/gateway", async (orig) => ({ ...(await orig<object>()), ask: (...a: unknown[]) => ask(...a), askObject: (...a: unknown[]) => askObject(...a) }));

const { sendMessage, answerInstead, turnIntoChange } = await import("@/server/actions/chat");

const P = "55555555-5555-4555-8555-555555555555";
const BP = "11111111-1111-4111-8111-111111111111";
const CARD = "66666666-6666-4666-8666-666666666666";
const slackDraft = {
  reply: "I'd add a Slack step.",
  add: [{ title: "Post the brief to Slack", description: "Posts it", proved_when: "A test brief appears", source_quote: "Slack", grp: "integrations", item_class: "integration.chat_send", size: "s" }],
  change: [],
  remove: [],
};

beforeEach(() => {
  role = "owner";
  ask.mockReset().mockResolvedValue({ text: "Because the notes came in after 8:00.", label: "Gemini", simulated: false });
  askObject.mockReset();
  db = new FakeDb({
    projects: [{ id: P, workspace_id: "ws-1", name: "Meeting Prep", model: "gemini", prompt: "Briefs", status: "built" }],
    blueprints: [{ id: BP, project_id: P, version: 1, status: "agreed", generation: "ready", agreed_at: "2026-10-10", prompt: "Briefs", name: "Meeting Prep" }],
    items: [{ blueprint_id: BP, key: "brief", grp: "core", title: "Brief", proved_when: "a brief is posted", status: "built", item_class: "logic", size: "s", position: 0 }],
    questions: [],
    messages: [],
    change_proposals: [],
  });
});

describe("sendMessage reads intent", () => {
  it("answers a question: no change card and no new version", async () => {
    expect(await sendMessage({ projectId: P, content: "Why did the Northwind brief skip the call notes?" })).toEqual({ ok: true, intent: "question" });
    expect(askObject).not.toHaveBeenCalled(); // the rules called it; no classifier call
    expect(db.tables.change_proposals).toEqual([]);
    expect(db.tables.blueprints).toHaveLength(1);
    expect(db.tables.messages.map((m) => [m.role, m.mode])).toEqual([
      ["user", "plan"],
      ["architect", "plan"],
    ]);
  });

  it("turns a change request into the change card, with its estimate, waiting for Apply", async () => {
    askObject.mockResolvedValueOnce({ object: slackDraft, label: "Gemini", simulated: false, tokens: 10 });
    const r = await sendMessage({ projectId: P, content: "Also post the brief to Slack" });
    expect(r).toMatchObject({ ok: true, intent: "change" });
    expect(db.tables.change_proposals).toHaveLength(1);
    expect(db.tables.change_proposals[0]).toMatchObject({ status: "proposed" });
    expect(Number(db.tables.change_proposals[0].estimate_likely)).toBeGreaterThan(0);
    expect((db.tables.change_proposals[0].diff as { unclear?: boolean }).unclear).toBeUndefined();
    expect(db.tables.blueprints).toHaveLength(1); // nothing changes until Apply
  });

  it("asks the default model when the rules can't tell, and an unclear card offers Just answer instead", async () => {
    askObject
      .mockResolvedValueOnce({ object: { intent: "change", sure: false }, label: "Gemini", simulated: false, tokens: 3 })
      .mockResolvedValueOnce({ object: slackDraft, label: "Gemini", simulated: false, tokens: 10 });
    await sendMessage({ projectId: P, content: "What if we added Slack?" });
    expect(askObject.mock.calls[0][0]).toMatchObject({ model: "gemini", fast: true });
    const card = db.tables.change_proposals[0];
    expect(card.diff).toMatchObject({ unclear: true, request: "What if we added Slack?" });

    // Just answer instead: the card is set aside and Architect answers the message.
    card.id = CARD;
    expect(await answerInstead({ proposalId: CARD })).toEqual({ ok: true, intent: "question" });
    expect(card).toMatchObject({ status: "discarded", diff: expect.objectContaining({ answered: true }) });
    expect(db.tables.messages.at(-1)).toMatchObject({ role: "architect", mode: "plan", content: "Because the notes came in after 8:00." });
    expect(db.tables.blueprints).toHaveLength(1);
  });

  it("makes a Viewer's change request a suggestion, which a Builder turns into a change", async () => {
    role = "viewer";
    expect(await sendMessage({ projectId: P, content: "Add a Slack step" })).toMatchObject({ ok: true, intent: "suggestion" });
    expect(askObject).not.toHaveBeenCalled(); // no change card was written for a Viewer
    const s = db.tables.change_proposals[0];
    expect(s.diff).toMatchObject({ suggestion: { text: "Add a Slack step", by: "Priya" } });
    s.id = CARD;
    expect(await turnIntoChange({ proposalId: CARD })).toMatchObject({ ok: false, message: expect.stringContaining("Owner, Admin or Builder") });
    // A Viewer's questions still get answers.
    expect(await sendMessage({ projectId: P, content: "How does the brief check work?" })).toEqual({ ok: true, intent: "question" });

    role = "builder";
    askObject.mockResolvedValueOnce({ object: slackDraft, label: "Gemini", simulated: false, tokens: 10 });
    expect(await turnIntoChange({ proposalId: CARD })).toMatchObject({ ok: true, intent: "change" });
    expect(s).toMatchObject({ status: "discarded", diff: expect.objectContaining({ turned_by: "Morgan" }) });
    expect(db.tables.change_proposals.at(-1)).toMatchObject({ status: "proposed" });
    expect(askObject.mock.calls.at(-1)![0].prompt).toContain("Add a Slack step (suggested by Priya)");
  });
});
