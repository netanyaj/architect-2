import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./fake-db";

/* ---------- gateway: which models are real ---------- */

describe("resolveModel", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-google");
    vi.stubEnv("MODEL_GEMINI", "gemini-test");
  });

  it("Gemini is real; Claude, GPT and OpenRouter are simulated (answered by Gemini) without their keys", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const { modelAvailability } = await import("@/lib/gateway");
    expect(modelAvailability().map(({ choice, simulated }) => [choice, simulated])).toEqual([
      ["gemini", false],
      ["openrouter", true],
      ["claude", true],
      ["gpt", true],
      ["private", true],
    ]);
  });

  it("Claude becomes real when its key and model are set, with no code change", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic");
    vi.stubEnv("MODEL_CLAUDE", "claude-test");
    const { resolveModel } = await import("@/lib/gateway");
    expect(resolveModel("claude")).toMatchObject({ simulated: false, label: "Claude Sonnet" });
  });
});

describe("timeLimit (OpenRouter's 45 s)", () => {
  it("stops OpenRouter after 45 s and says it was our limit; other models have none", async () => {
    vi.useFakeTimers();
    const { timeLimit, MODEL_TIME_LIMIT_MS } = await vi.importActual<typeof import("@/lib/gateway")>("@/lib/gateway");
    expect(MODEL_TIME_LIMIT_MS).toEqual({ openrouter: 45_000 });
    const l = timeLimit("openrouter");
    vi.advanceTimersByTime(44_999);
    expect([l.signal?.aborted, l.timedOut()]).toEqual([false, false]);
    vi.advanceTimersByTime(1);
    expect([l.signal?.aborted, l.timedOut(), l.seconds]).toEqual([true, true, 45]);
    const g = timeLimit("gemini");
    expect([g.signal, g.timedOut()]).toEqual([undefined, false]);
    vi.useRealTimers();
  });
});

/* ---------- support actions ---------- */

const ask = vi.fn();
class GatewayRateLimited extends Error {}
vi.mock("@/lib/gateway", async (orig) => {
  // The resolveModel tests above import the real module (after resetModules); the actions below use this mock.
  const real = await orig<typeof import("@/lib/gateway")>();
  return { ...real, ask: (...a: unknown[]) => ask(...a), GatewayRateLimited };
});

let db: FakeDb;
vi.mock("@/server/db", () => ({ createAdminDb: () => db }));
vi.mock("@/server/workspace", () => ({
  getAppContext: async () => ({ user: { id: "me" }, name: "Morgan Lee", role: "owner", workspace: { id: "ws-1", name: "Acme Ops" } }),
}));
vi.mock("@/server/queries", () => ({
  listProjects: async () => [
    { name: "Lead scorer", summary: { meta: "Paused at its 100-credit budget", next: { text: "Blocked: raise budget" } }, budgetCredits: 100, creditsUsed: 100 },
  ],
}));

const P1 = "11111111-1111-4111-8111-111111111111";
const P_OTHER = "22222222-2222-4222-8222-222222222222";

describe("askSupport", () => {
  beforeEach(() => {
    ask.mockReset();
    db = new FakeDb();
  });

  it("answers from the FAQ plus this workspace's project states, quickly", async () => {
    const { askSupport } = await import("@/server/actions/support");
    ask.mockResolvedValue({ text: "It paused at its budget.", label: "Gemini", simulated: false });
    expect(await askSupport({ question: "Why did Lead scorer stop?" })).toEqual({ ok: true, answer: "It paused at its budget." });
    const call = ask.mock.calls[0][0];
    expect(call.instructions).toContain("Answer the person's question using ONLY the FAQ");
    expect(call.instructions).toContain("Lead scorer: Paused at its 100-credit budget. Next: Blocked: raise budget.");
    expect(call.instructions).toContain("The person is an owner.");
    expect(call).toMatchObject({ fast: true, prompt: "Person: Why did Lead scorer stop?" });
  });

  it("includes the last turns of the conversation", async () => {
    const { askSupport } = await import("@/server/actions/support");
    ask.mockResolvedValue({ text: "Yes.", label: "Gemini", simulated: false });
    await askSupport({ question: "And then?", history: [{ role: "user", text: "Hi" }, { role: "bot", text: "Hello" }] });
    expect(ask.mock.calls[0][0].prompt).toBe("Conversation so far:\nPerson: Hi\nHelp: Hello\n\nPerson: And then?");
  });

  it("a rate limit says so plainly, and other failures don't crash", async () => {
    const { askSupport } = await import("@/server/actions/support");
    ask.mockRejectedValueOnce(new GatewayRateLimited("Gemini"));
    expect(await askSupport({ question: "Hi" })).toMatchObject({ ok: false, rateLimited: true, message: expect.stringContaining("Help is busy right now") });
    ask.mockRejectedValueOnce(new Error("socket hang up"));
    expect(await askSupport({ question: "Hi" })).toEqual({ ok: false, message: "Help can't answer right now. Try again in a moment, or talk to a person." });
  });

  it("checks the question", async () => {
    const { askSupport } = await import("@/server/actions/support");
    expect(await askSupport({ question: "   " })).toEqual({ ok: false, message: "Type a question first." });
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("createSupportTicket", () => {
  beforeEach(() => {
    db = new FakeDb({
      projects: [
        { id: P1, workspace_id: "ws-1", name: "Lead scorer" },
        { id: P_OTHER, workspace_id: "ws-9", name: "Not yours" },
      ],
      support_tickets: [],
    });
  });

  it("saves the question and conversation, linked to the project, and returns the number", async () => {
    const { createSupportTicket } = await import("@/server/actions/support");
    const r = await createSupportTicket({ question: "Why?", transcript: [{ role: "user", text: "Why?" }], projectId: P1 });
    expect(r.ok).toBe(true);
    expect(db.tables.support_tickets[0]).toMatchObject({ user_id: "me", workspace_id: "ws-1", project_id: P1, question: "Why?", transcript: [{ role: "user", text: "Why?" }] });
  });

  it("won't link a project from another workspace, and works with no question", async () => {
    const { createSupportTicket } = await import("@/server/actions/support");
    await createSupportTicket({ projectId: P_OTHER });
    expect(db.tables.support_tickets[0]).toMatchObject({ project_id: null, question: "Asked for a person from Help" });
  });
});
