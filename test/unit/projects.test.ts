import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/db";
import { detectTools, relativeTime, summarizeProject } from "@/lib/project-status";
import { matchesStarter, STARTERS } from "@/lib/templates";
import { csvField } from "@/app/(app)/usage/usage-table";
import { FakeDb } from "./fake-db";

/* ---------- pure: summaries ---------- */

const built = (n: number, title = "Part") => Array.from({ length: n }, (_, i) => ({ status: "built", title: `${title} ${i}`, grp: "features" }));

describe("summarizeProject", () => {
  it("live with everything working: a quiet Live, nothing needs you", () => {
    const s = summarizeProject({ status: "live", budgetCredits: 250, items: built(12) });
    expect(s).toMatchObject({ total: 12, works: 12, meta: "Live · 12 of 12 parts work", needsYou: false, filter: "live" });
    expect(s.next).toEqual({ status: "works", text: "Live" });
  });
  it("waiting for IT approval", () => {
    const s = summarizeProject({ status: "built", budgetCredits: 150, items: [...built(5), { status: "needs_approval", title: "Production deploy", grp: "quality" }] });
    expect(s).toMatchObject({ meta: "Ready · 5 of 6 parts work", needsYou: true });
    expect(s.next).toEqual({ status: "approval", icon: "lock", text: "Waiting for IT approval" });
  });
  it("paused at budget is Blocked in neutral ink, with the budget named", () => {
    const s = summarizeProject({ status: "paused", budgetCredits: 100, runStatus: "paused_budget", items: [...built(4), ...Array(3).fill({ status: "agreed", title: "x", grp: "agents" })] });
    expect(s).toMatchObject({ meta: "Paused at its 100-credit budget", needsYou: true });
    expect(s.next).toEqual({ status: "blocked", icon: "pause", text: "Blocked: raise budget" });
  });
  it("a part waiting on a connection names the app", () => {
    const s = summarizeProject({ status: "building", budgetCredits: null, items: [...built(7), { status: "needs_connection", title: "Last email thread per attendee", grp: "integrations" }] });
    expect(s.next).toEqual({ status: "attention", icon: "plug", text: "Needs you: connect Gmail" });
    expect(s.meta).toBe("Building · 7 of 8 parts work");
  });
  it("set-aside and dropped parts don't count toward readiness", () => {
    const s = summarizeProject({ status: "live", budgetCredits: null, items: [...built(3), { status: "deferred", title: "a", grp: "features" }, { status: "dropped", title: "b", grp: "features" }] });
    expect(s).toMatchObject({ total: 3, works: 3 });
  });
  it("drafts with and without a plan", () => {
    expect(summarizeProject({ status: "draft", budgetCredits: null, items: Array(3).fill({ status: "proposed", title: "x", grp: "data" }) })).toMatchObject({
      meta: "Plan ready · 3 parts",
      next: { status: "todo", text: "Plan ready, not built" },
      filter: "draft",
    });
    expect(summarizeProject({ status: "draft", budgetCredits: null, items: [] })).toMatchObject({ meta: "No plan yet", next: { text: "Write the plan" } });
  });
});

describe("detectTools / relativeTime / starters / csv", () => {
  it("reads tools from the prompt and parts", () => {
    expect(detectTools(["Before each meeting on my calendar, send me a Slack brief with each attendee's last email thread"])).toEqual(["Calendar", "Gmail", "Slack"]);
    expect(detectTools(["post the top 5 to #sales from HubSpot"])).toEqual(["Slack", "HubSpot"]);
    expect(detectTools([null, undefined])).toEqual([]);
  });
  it("says when, in plain words", () => {
    const now = new Date("2026-10-04T12:00:00Z");
    expect(relativeTime("2026-10-04T10:00:00Z", now)).toBe("2 h ago");
    expect(relativeTime("2026-10-03T09:00:00Z", now)).toBe("yesterday");
    expect(relativeTime("2026-09-26T09:00:00Z", now)).toBe("last week");
  });
  it("finds starters by job, team or tool", () => {
    expect(STARTERS.filter((s) => matchesStarter(s, "zendesk")).map((s) => s.id)).toEqual(["support-triage"]);
    expect(STARTERS.filter((s) => matchesStarter(s, "finance")).length).toBeGreaterThan(0);
  });
  it("quotes CSV fields that need it", () => {
    expect(csvField('Fix · "Brief writer", try 1')).toBe('"Fix · ""Brief writer"", try 1"');
    expect(csvField(12)).toBe("12");
  });
});

/* ---------- actions ---------- */

class Redirect extends Error {
  constructor(public url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}
const jar = new Map<string, string>();
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Redirect(url); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: (k: string, v: string) => jar.set(k, v) }) }));

let db: FakeDb;
let role: Role;
// The person's own session: setTheme saves the theme on their account.
const savedMetadata: Record<string, unknown>[] = [];
vi.mock("@/server/db", () => ({
  createAdminDb: () => db,
  createServerDb: async () => ({ auth: { updateUser: async ({ data }: { data: Record<string, unknown> }) => (savedMetadata.push(data), { data: {}, error: null }) } }),
}));
vi.mock("@/server/workspace", () => ({
  getAppContext: async () => ({ user: { id: "me" }, name: "Morgan Lee", role, workspace: { id: "ws-1", name: "Acme Ops" } }),
}));

const { startProject, duplicateProject, deleteProject, setProjectBudget, setTheme } = await import("@/server/actions/projects");
const { connectProvider } = await import("@/server/actions/connections");

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const C1 = "33333333-3333-4333-8333-333333333333";
const C2 = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  role = "owner";
  jar.clear();
  db = new FakeDb({
    projects: [
      { id: P1, workspace_id: "ws-1", name: "Meeting Prep", owner_id: "me", prompt: "Before each meeting…", icon: "calendar", model: "gemini", budget_credits: 250 },
      { id: P2, workspace_id: "ws-1", name: "Someone else's", owner_id: "other", prompt: "x", icon: "doc", model: "gemini", budget_credits: null },
    ],
    blueprints: [{ id: "bp-1", project_id: P1, version: 1, prompt: "Before each meeting…", summary: "Briefs", total_likely: 160 }],
    items: [
      { id: "i1", blueprint_id: "bp-1", project_id: P1, key: "a", grp: "features", title: "Brief", status: "built", position: 1 },
      { id: "i2", blueprint_id: "bp-1", project_id: P1, key: "b", grp: "data", title: "Old", status: "dropped", position: 2 },
    ],
    connections: [
      { id: C1, workspace_id: "ws-1", provider: "gmail", status: "missing" },
      { id: C2, workspace_id: "ws-1", provider: "hubspot", status: "missing" },
    ],
    policies: [{ workspace_id: "ws-1", kind: "connectors", config: { allow: ["gmail"], deny: ["hubspot"] } }],
    support_tickets: [{ id: 1, project_id: P1, question: "Why?" }],
    audit_log: [],
  });
});
const audits = () => db.tables.audit_log.map((a) => a.action);

describe("startProject (Write the plan)", () => {
  it("creates a draft with the prompt and opens it; nothing is charged", async () => {
    await expect(startProject({ prompt: "  Every Friday, send me a recap.  " })).rejects.toMatchObject({ url: expect.stringMatching(/^\/p\//) });
    const created = db.tables.projects.at(-1)!;
    expect(created).toMatchObject({ name: "Untitled app", prompt: "Every Friday, send me a recap.", status: "draft", owner_id: "me", workspace_id: "ws-1" });
    expect(db.tables.usage_ledger ?? []).toEqual([]);
  });
  it("Viewers can't start, and say why", async () => {
    role = "viewer";
    expect(await startProject({ prompt: "x" })).toEqual({ ok: false, message: "Viewers can't start projects. Ask an Owner, Admin or Builder." });
  });
  it("needs a prompt", async () => {
    expect(await startProject({ prompt: "   " })).toEqual({ ok: false, message: "Describe what you want first." });
  });
});

describe("duplicateProject", () => {
  it("copies the latest plan as a fresh draft: parts proposed, dropped parts left out", async () => {
    const r = await duplicateProject({ projectId: P1 });
    expect(r.ok).toBe(true);
    const copy = db.tables.projects.find((p) => p.name === "Meeting Prep copy")!;
    expect(copy).toMatchObject({ status: "draft", owner_id: "me", current_version: 1 });
    const parts = db.tables.items.filter((i) => i.project_id === copy.id);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ title: "Brief", status: "proposed" });
    expect(audits()).toEqual(["project.duplicated"]);
  });
  it("refuses a project from another workspace", async () => {
    db.tables.projects.push({ id: "55555555-5555-4555-8555-555555555555", workspace_id: "ws-9", name: "x" });
    expect(await duplicateProject({ projectId: "55555555-5555-4555-8555-555555555555" })).toMatchObject({ ok: false });
  });
});

describe("deleteProject", () => {
  it("deletes, keeps support tickets, and logs it", async () => {
    expect(await deleteProject({ projectId: P1 })).toEqual({ ok: true });
    expect(db.tables.projects.find((p) => p.id === P1)).toBeUndefined();
    expect(db.tables.support_tickets[0]).toMatchObject({ question: "Why?", project_id: null });
    expect(audits()).toEqual(["project.deleted"]);
  });
  it("removes the project's uploaded files from the bucket, and only those", async () => {
    db.objects.uploads = new Set([`ws-1/${P1}/a-agenda.pdf`, `ws-1/${P1}/b-logo.png`, `ws-1/${P2}/c-other.pdf`]);
    expect(await deleteProject({ projectId: P1 })).toEqual({ ok: true });
    expect([...db.objects.uploads]).toEqual([`ws-1/${P2}/c-other.pdf`]);
  });
  it("a Builder can delete their own project but not someone else's", async () => {
    role = "builder";
    expect(await deleteProject({ projectId: P2 })).toEqual({ ok: false, message: "Only the project's owner, an Owner or an Admin can delete it." });
    expect(await deleteProject({ projectId: P1 })).toEqual({ ok: true });
  });
});

describe("setProjectBudget", () => {
  it("sets and clears a budget, with from/to in the audit log", async () => {
    expect(await setProjectBudget({ projectId: P1, credits: 300 })).toEqual({ ok: true });
    expect(db.tables.projects[0].budget_credits).toBe(300);
    expect(db.tables.audit_log[0]).toMatchObject({ action: "budget.changed", details: { from: 250, to: 300 } });
    expect(await setProjectBudget({ projectId: P1, credits: null })).toEqual({ ok: true });
    expect(db.tables.projects[0].budget_credits).toBeNull();
  });
  it("checks the number and the role", async () => {
    expect(await setProjectBudget({ projectId: P1, credits: 0 })).toEqual({ ok: false, message: "A budget needs at least 1 credit." });
    expect(await setProjectBudget({ projectId: P1, credits: 12.5 })).toEqual({ ok: false, message: "Use a whole number of credits." });
    role = "builder";
    expect(await setProjectBudget({ projectId: P1, credits: 10 })).toEqual({ ok: false, message: "Only Owners and Admins can change budgets." });
  });
});

describe("setTheme", () => {
  it("saves light or dark on the person's account, and in this browser so pages render in it at once", async () => {
    expect(await setTheme("dark")).toEqual({ ok: true });
    expect(savedMetadata.at(-1)).toEqual({ theme: "dark" });
    expect(jar.get("ax_theme")).toBe("dark");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await setTheme("purple" as any)).toMatchObject({ ok: false });
  });
});

describe("connectProvider (simulated)", () => {
  it("flips the app to connected and logs that it was simulated", async () => {
    expect(await connectProvider({ connectionId: C1 })).toEqual({ ok: true });
    expect(db.tables.connections[0].status).toBe("connected");
    expect(db.tables.audit_log[0]).toMatchObject({ action: "connection.connected", target: "gmail", details: { simulated: true } });
  });
  it("refuses an app the policy blocks", async () => {
    expect(await connectProvider({ connectionId: C2 })).toEqual({
      ok: false,
      message: "Your organisation's policy doesn't allow this app. IT has to approve it first.",
    });
    expect(db.tables.connections[1].status).toBe("missing");
  });
  it("Viewers can't connect", async () => {
    role = "viewer";
    expect(await connectProvider({ connectionId: C1 })).toMatchObject({ ok: false });
  });
});
