import { beforeEach, describe, expect, it, vi } from "vitest";
import { editLine, editProblem, lineDiff, suggestPart, withEdits } from "@/lib/code-edits";
import type { Role } from "@/lib/db";
import { FakeDb } from "./fake-db";

let db: FakeDb;
let role: Role;
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/db", () => ({ createAdminDb: () => db, createServerDb: async () => db }));
vi.mock("@/server/workspace", () => ({
  getAppContext: async () => ({ user: { id: "me" }, name: "Sam Lee", role, workspace: { id: "ws-1", name: "Acme", governanceEnabled: true }, memberships: [] }),
}));

const P = "11111111-1111-4111-8111-111111111111";
const parts = [
  { key: "calendar-sync", title: "Calendar sync" },
  { key: "brief-writer", title: "Brief writer" },
];

describe("code edits", () => {
  it("suggests the part that owns the file, else the closest name", () => {
    const groups = [{ key: "calendar-sync", title: "Calendar sync", label: "new", files: [{ path: "src/integrations/calendar_sync.ts", added: 3, removed: 0, lines: [] }] }];
    expect(suggestPart("src/integrations/calendar_sync.ts", groups, parts)).toBe("calendar-sync");
    expect(suggestPart("agents/brief_writer.py", groups, parts)).toBe("brief-writer");
    expect(suggestPart("README.md", groups, parts)).toBe("calendar-sync");
    expect(suggestPart("x", [], [])).toBeNull();
  });

  it("a line diff keeps what's shared and marks what changed; edits lay over Changes under their part", () => {
    const d = lineDiff("a.ts", "one\ntwo\nthree\n", "one\nTWO\nthree\nfour\n");
    // Only "one" is shared at the start; the ends differ, so the rest is removed and added.
    expect(d.lines.map((l) => `${l.kind}:${l.text}`)).toEqual(["same:one", "del:two", "del:three", "add:TWO", "add:three", "add:four"]);
    expect([d.added, d.removed]).toEqual([3, 2]);
    const simple = lineDiff("b.ts", "a\nb\nc", "a\nB\nc");
    expect(simple.lines.map((l) => `${l.kind}:${l.text}`)).toEqual(["same:a", "del:b", "add:B", "same:c"]);
    expect([simple.added, simple.removed]).toEqual([1, 1]);
    const groups = [{ key: "brief-writer", title: "Brief writer", label: "new", files: [{ path: "agents/brief.py", added: 9, removed: 0, lines: [] }] }];
    const out = withEdits(groups, [{ path: "agents/brief.py", partKey: "brief-writer", partTitle: "Brief writer", diff: simple }]);
    expect(out).toEqual([{ key: "brief-writer", title: "Brief writer", label: "new · edited", files: [simple] }]);
    expect(withEdits([], [{ path: "x.ts", partKey: "calendar-sync", partTitle: "Calendar sync", diff: simple }])[0]).toMatchObject({ key: "calendar-sync", label: "edited" });
    expect(editLine({ path: "agents/brief.py", partTitle: "Brief writer", check: "running" })).toBe("Code edit to agents/brief.py · re-runs the check for Brief writer");
  });

  it("what can't be saved", () => {
    expect(editProblem("../etc/passwd", "x", "y")).toBe("That file can't be edited.");
    expect(editProblem("a.ts", "same", "same")).toBe("Nothing changed in the file yet.");
    expect(editProblem("a.ts", "x".repeat(200_001), "")).toMatch(/200 KB/);
    expect(editProblem("a.ts", "new", "old")).toBeNull();
  });
});

describe("saving an edit", () => {
  beforeEach(() => {
    role = "builder";
    db = new FakeDb({
      projects: [{ id: P, name: "ticket-triage", workspace_id: "ws-1", repo_full_name: "netanyaj/ticket-triage", current_version: 2 }],
      blueprints: [{ id: "bp2", project_id: P, version: 2 }],
      items: [
        { id: "i1", blueprint_id: "bp2", key: "brief-writer", title: "Brief writer", status: "built" },
        { id: "i2", blueprint_id: "bp2", key: "later", title: "Later part", status: "agreed" },
      ],
      checks: [{ id: "c1", item_id: "i1", written_at: "2026-10-10T08:00:00Z" }],
      proofs: [],
      runs: [],
      files: [],
      events: [],
      pull_requests: [{ id: "pr12", project_id: P, number: 12, status: "merged", parts: [] }],
      audit_log: [],
    });
  });

  it("the part's check runs again, the edit goes on a new PR, and it settles to Works with a proof; never by its own say", async () => {
    const { saveCodeEdit } = await import("@/server/actions/dev");
    role = "viewer";
    expect(await saveCodeEdit({ projectId: P, path: "agents/brief.py", partKey: "brief-writer", before: "a", content: "b" })).toMatchObject({ ok: false });
    role = "builder";
    expect(await saveCodeEdit({ projectId: P, path: "agents/brief.py", partKey: "nope", before: "a", content: "b" })).toEqual({ ok: false, message: "Pick one of the plan's parts for this edit." });
    expect(await saveCodeEdit({ projectId: P, path: "agents/brief.py", partKey: "brief-writer", before: "a\nb", content: "a\nB" })).toEqual({ ok: true, prNumber: 13, rechecks: true });
    expect(db.tables.items[0]).toMatchObject({ status: "building", status_detail: "Re-running its check · code edit by Sam Lee" });
    expect(db.tables.files[0]).toMatchObject({ kind: "generated", path: "agents/brief.py", extracted_text: "a\nB", used_by: ["brief-writer"] });
    expect(db.tables.pull_requests[1]).toMatchObject({ number: 13, parts: [{ key: "brief-writer", title: "Brief writer" }] });
    expect(db.tables.events[0]).toMatchObject({ type: "code.edited", actor: "user", actor_label: "Sam Lee", payload: expect.objectContaining({ part_key: "brief-writer", pr_number: 13, settled: false }) });
    expect(db.tables.audit_log[0]).toMatchObject({ action: "code.edited", target: "ticket-triage: agents/brief.py" });

    // A second edit on the same PR; a part not built yet has no check to run again.
    db.tables.pull_requests[1].status = "open";
    expect(await saveCodeEdit({ projectId: P, path: "src/later.ts", partKey: "later", before: "x", content: "y" })).toEqual({ ok: true, prNumber: 13, rechecks: false });
    expect(db.tables.items[1].status).toBe("agreed");

    // Not due yet: nothing settles. Once due, the part works again with a passing proof.
    const { settleCodeEdits, loadCodeEdits } = await import("@/server/code-edits");
    await settleCodeEdits(db as never, P);
    expect(db.tables.items[0].status).toBe("building");
    (db.tables.events[0].payload as { settle_at: string }).settle_at = new Date(Date.now() - 1000).toISOString();
    await settleCodeEdits(db as never, P);
    expect(db.tables.items[0]).toMatchObject({ status: "built", status_detail: null });
    expect(db.tables.proofs[0]).toMatchObject({ item_id: "i1", result: "pass", summary: "Passed again after a code edit to agents/brief.py" });
    const loaded = await loadCodeEdits(db as never, P);
    expect(loaded.edits.map((e) => [e.path, e.check, e.prNumber])).toEqual([
      ["agents/brief.py", "passed", 13],
      ["src/later.ts", "passed", 13],
    ]);
    expect(loaded.files.find((f) => f.path === "agents/brief.py")).toMatchObject({ partKey: "brief-writer", content: "a\nB" });
  });
});
