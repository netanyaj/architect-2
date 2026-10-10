import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/db";
import { summarizeProject } from "@/lib/project-status";
import { crc32, zipFiles } from "@/lib/zip";
import { FakeDb } from "./fake-db";

let db: FakeDb;
let role: Role;
const askObject = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/db", () => ({ createAdminDb: () => db, createServerDb: async () => db }));
vi.mock("@/lib/gateway", async (orig) => ({ ...(await orig<typeof import("@/lib/gateway")>()), askObject: (i: unknown) => askObject(i) }));
// The move is what's tested here; the plan request from a full analysis is covered by import.test.ts.
vi.mock("@/lib/repo-analysis", async (orig) => ({ ...(await orig<typeof import("@/lib/repo-analysis")>()), repoPlanRequest: () => "Plan from repo netanyaj/ticket-triage." }));
vi.mock("@/server/workspace", () => ({
  getAppContext: async () => ({ user: { id: "me" }, name: "Vic Viewer", role, workspace: { id: "ws-1", name: "Acme", governanceEnabled: true }, memberships: [] }),
}));

const P = "11111111-1111-4111-8111-111111111111";

describe("Download code's zip", () => {
  it("CRC-32 and a stored zip a standard reader accepts", () => {
    expect(crc32(new TextEncoder().encode("123456789")).toString(16)).toBe("cbf43926");
    const z = zipFiles([{ path: "README.md", content: "hi" }, { path: "src/a.ts", content: "export const a = 1;\n" }]);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    // The end record says two entries, and points at the central directory.
    const end = z.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(2);
    expect(v.getUint32(v.getUint32(end + 16, true), true)).toBe(0x02014b50);
  });
});

describe("the Architect 1.0 app (F9)", () => {
  it("keeps running, and offers Move to 2.0 until it has moved", () => {
    expect(summarizeProject({ status: "live", budgetCredits: null, items: [], legacy: { movedTo: null } })).toMatchObject({ meta: "Architect 1.0 · keeps running as it is", next: { text: "Move to 2.0" }, filter: "live", needsYou: false });
    expect(summarizeProject({ status: "live", budgetCredits: null, items: [], legacy: { movedTo: "Ticket triage" } }).next).toEqual({ status: "works", text: "Moved to 2.0 as Ticket triage" });
  });
});

describe("comments on plan parts (BL-15)", () => {
  beforeEach(() => {
    db = new FakeDb({ projects: [{ id: P, name: "Meeting Prep", workspace_id: "ws-1" }], part_comments: [], audit_log: [] });
  });
  it("a Viewer comments; empty and other workspaces' projects are refused", async () => {
    role = "viewer";
    const { addPartComment } = await import("@/server/actions/comments");
    expect(await addPartComment({ projectId: P, itemKey: "brief-writer", body: "  " })).toEqual({ ok: false, message: "Write a comment first." });
    expect(await addPartComment({ projectId: P, itemKey: "brief-writer", body: "Could the brief be shorter?" })).toEqual({ ok: true });
    expect(db.tables.part_comments[0]).toMatchObject({ project_id: P, item_key: "brief-writer", body: "Could the brief be shorter?", author_name: "Vic Viewer" });
    db.tables.projects[0].workspace_id = "other";
    expect(await addPartComment({ projectId: P, itemKey: "x", body: "hi" })).toEqual({ ok: false, message: "That project isn't in this workspace." });
  });
});

describe("Help me decide", () => {
  beforeEach(() => {
    role = "builder";
    askObject.mockReset();
    db = new FakeDb({ workspaces: [{ id: "ws-1", governance_enabled: true }], policies: [{ workspace_id: "ws-1", kind: "models", config: { allowed: ["gemini", "claude"] } }] });
  });
  it("three ideas; only the person's own tools; hours kept sensible; the model labels, the server keeps it tidy", async () => {
    askObject.mockResolvedValue({
      label: "Gemini",
      simulated: false,
      tokens: 100,
      object: {
        ideas: [
          { title: "Meeting briefs in Slack", line: "A brief before each meeting.", tools: ["slack", "google_calendar", "salesforce"], hours_saved: 3.2, prompt: "Before each meeting, send me a Slack brief." },
          { title: "Morning lead scores", line: "Leads scored daily.", tools: ["hubspot"], hours_saved: 99, prompt: "Score new HubSpot leads every morning." },
          { title: "Follow-up drafts", line: "Drafts after calls.", tools: ["gmail"], hours_saved: 0.1, prompt: "Draft a follow-up in Gmail after each call." },
        ],
      },
    });
    const { suggestIdeas } = await import("@/server/actions/decide");
    expect(await suggestIdeas({ role: "x", timeSink: "meetings", tools: [] })).toEqual({ ok: false, message: "Say what you do, in a few words." });
    const r = await suggestIdeas({ role: "Sales operations lead", timeSink: "Meeting prep takes 4 h a week", tools: ["slack", "google_calendar", "gmail", "made-up"] });
    expect(r.ok && r.ideas.map((i) => [i.title, i.tools, i.hoursSaved])).toEqual([
      ["Meeting briefs in Slack", ["slack", "google_calendar"], 3],
      ["Morning lead scores", [], 20],
      ["Follow-up drafts", ["gmail"], 0.5],
    ]);
    expect(askObject.mock.calls[0][0]).toMatchObject({ model: "gemini" });
    expect(askObject.mock.calls[0][0].prompt).toContain("Their tools (ids): slack, google_calendar, gmail");
  });
});

describe("Move to 2.0 records the move", () => {
  it("the new project takes the app's name, and the 1.0 app points at it", async () => {
    role = "builder";
    db = new FakeDb({
      repo_imports: [{ id: "22222222-2222-4222-8222-222222222222", workspace_id: "ws-1", full_name: "netanyaj/ticket-triage", branch: "main", folder: "/", project_id: null, analysis: { analysis: { runnable: { ok: true }, keys: [], stack: "Node.js" }, behaviour: [] } }],
      projects: [{ id: P, name: "Ticket triage (Architect 1.0)", workspace_id: "ws-1", legacy_repo: "netanyaj/ticket-triage", moved_to: null }],
      audit_log: [],
    });
    const { planFromImport } = await import("@/server/actions/import");
    const r = await planFromImport({ importId: "22222222-2222-4222-8222-222222222222", fromProjectId: P });
    expect(r.ok).toBe(true);
    const created = db.tables.projects.find((p) => p.id !== P)!;
    expect(created).toMatchObject({ name: "Ticket triage", repo_full_name: "netanyaj/ticket-triage" });
    expect(db.tables.projects.find((p) => p.id === P)!.moved_to).toBe(created.id);
    expect(db.tables.audit_log.map((a) => a.action)).toEqual(["repo.imported", "project.moved_to_2"]);
  });
});
