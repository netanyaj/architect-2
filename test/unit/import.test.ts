import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/db";
import { analyzeRepo, filesToRead, type RepoEntry } from "@/lib/repo-analysis";
import { FakeDb } from "./fake-db";

/* Import a repo (B-1 to B-3): GitHub errors in plain words, the import actions with GitHub and the gateway faked,
   and the step that turns the repo's tests into proof once the plan is written. */

let db: FakeDb;
let role: Role;
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/db", () => ({ createAdminDb: () => db, createServerDb: async () => db }));
vi.mock("@/server/workspace", () => ({
  getAppContext: async () => ({ user: { id: "me" }, name: "Sam Lee", role, workspace: { id: "ws-1", name: "Acme", governanceEnabled: true }, memberships: [] }),
}));

const DIR = join(__dirname, "../fixtures/repos/ticket-triage");
const tree = JSON.parse(readFileSync(join(DIR, "tree.json"), "utf8")) as RepoEntry[];
const files = Object.fromEntries(filesToRead(tree).read.map((p) => [p, readFileSync(join(DIR, "files", p), "utf8")]));

const github = {
  listRepos: vi.fn(async () => [{ fullName: "netanyaj/ticket-triage", private: false, defaultBranch: "main", language: "JavaScript", pushedAt: "2026-10-02T07:24:43Z" }]),
  listBranches: vi.fn(async () => ["main", "fix-sso"]),
  readTree: vi.fn(async () => ({ sha: "abc123", entries: tree, folders: ["agents", "client", "client/src", "server", "tests"], truncated: false })),
  readRepoFiles: vi.fn(async () => ({ paths: tree.map((e) => e.path), files, skippedLarge: 0 })),
};
vi.mock("@/server/github", async (orig) => {
  const real = await orig<typeof import("@/server/github")>();
  return { ...real, listRepos: () => github.listRepos(), listBranches: () => github.listBranches(), readTree: () => github.readTree(), readRepoFiles: () => github.readRepoFiles() };
});
const askObject = vi.fn();
vi.mock("@/lib/gateway", async (orig) => ({ ...(await orig<typeof import("@/lib/gateway")>()), askObject: (o: unknown) => askObject(o) }));

beforeEach(() => {
  role = "builder";
  askObject.mockReset();
  askObject.mockResolvedValue({
    object: {
      parts: [
        { title: "Sort tickets by urgency", description: "P1 to P3 from keywords.", tests: ["outage is P1", "SSO login failure is P1"], agent: "" },
        { title: "Send to the right team", description: "Billing, Identity or Product.", tests: ["billing tickets go to Billing", "not a real test"], agent: "" },
        { title: "Show incoming tickets", description: "A list of tickets.", tests: [], agent: "" },
      ],
    },
    label: "Gemini",
    simulated: false,
    tokens: 100,
  });
  db = new FakeDb({
    github_installations: [{ workspace_id: "ws-1", installation_id: 167616247 }],
    repo_imports: [],
    projects: [],
    audit_log: [],
    items: [],
    checks: [],
    proofs: [],
  });
});

describe("toProblem: GitHub failures say what happened and what to do", () => {
  it("rate limit, empty repo, lost access, app removed, outage", async () => {
    const { toProblem } = await import("@/server/github");
    const limited = toProblem({ status: 403, message: "API rate limit exceeded", response: { headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1791547200" } } });
    expect(limited.kind).toBe("rate_limited");
    expect(limited.message).toMatch(/^GitHub's limit for reading repos is used up for now\. Nothing was lost\. Try again after \d\d:\d\d UTC\.$/);
    expect(toProblem({ status: 409, message: "Git Repository is empty." }, "acme/new")).toMatchObject({ kind: "empty", message: "acme/new is empty, so there's nothing to import yet. Push some code to it, then try again." });
    expect(toProblem({ status: 404 }, "acme/billing")).toMatchObject({ kind: "access_lost", message: expect.stringMatching(/^Architect can't read acme\/billing any more/) });
    expect(toProblem({ status: 404 })).toMatchObject({ kind: "not_installed", message: "The GitHub App isn't installed on this account any more. Install it on the repos you want to import." });
    expect(toProblem({ status: 502 })).toMatchObject({ kind: "unavailable" });
  });
});

describe("importRepos and importRepoDetails", () => {
  it("only for installations this workspace has confirmed", async () => {
    const { importRepos } = await import("@/server/actions/import");
    expect(await importRepos({ installationId: 999 })).toEqual({ ok: false, message: "This workspace isn't connected to that GitHub account. Install the GitHub App, or connect it again." });
    expect(await importRepos({ installationId: 167616247 })).toMatchObject({ ok: true, repos: [{ fullName: "netanyaj/ticket-triage" }] });
    role = "viewer";
    expect(await importRepos({ installationId: 167616247 })).toMatchObject({ ok: false, message: expect.stringMatching(/^Viewers can't import/) });
  });

  it("branches default to the repo's default branch; folders to two levels", async () => {
    const { importRepoDetails } = await import("@/server/actions/import");
    expect(await importRepoDetails({ installationId: 167616247, repo: "netanyaj/ticket-triage" })).toEqual({ ok: true, branches: ["main", "fix-sso"], branch: "main", folders: ["agents", "client", "client/src", "server", "tests"] });
    expect(await importRepoDetails({ installationId: 167616247, repo: "../etc" })).toMatchObject({ ok: false });
  });
});

describe("analyzeImport", () => {
  it("analyses the repo, keeps only tests that exist, adds the CrewAI agent as a part, and saves the import", async () => {
    const { analyzeImport } = await import("@/server/actions/import");
    const r = await analyzeImport({ installationId: 167616247, repo: "netanyaj/ticket-triage", branch: "main", folder: "/" });
    if (!r.ok) throw new Error(r.message);
    expect(r.view.analysis.stack).toBe("Node.js (Express), React 18 (Vite) and Python (CrewAI)");
    expect(r.view.behaviour.map((b) => [b.title, b.tests, b.agent])).toEqual([
      ["Sort tickets by urgency", ["outage is P1", "SSO login failure is P1"], null],
      ["Send to the right team", ["billing tickets go to Billing"], null],
      ["Show incoming tickets", [], null],
      ["Triager agent (CrewAI)", [], "triager"],
    ]);
    expect(db.tables.repo_imports[0]).toMatchObject({ workspace_id: "ws-1", installation_id: 167616247, full_name: "netanyaj/ticket-triage", branch: "main", folder: "/", commit_sha: "abc123", created_by: "me" });
  });

  it("a busy model keeps the analysis and says what to do", async () => {
    const { GatewayRateLimited } = await import("@/lib/gateway");
    askObject.mockRejectedValueOnce(new GatewayRateLimited("Gemini"));
    const { analyzeImport } = await import("@/server/actions/import");
    const r = await analyzeImport({ installationId: 167616247, repo: "netanyaj/ticket-triage", branch: "main", folder: "/" });
    expect(r.ok && r.view.behaviour).toEqual([]);
    expect(r.ok && r.view.behaviourError).toMatch(/^Gemini is busy right now \(rate limit\)\. The analysis above is complete/);
  });

  it("rejects folders that climb out of the repo", async () => {
    const { analyzeImport } = await import("@/server/actions/import");
    expect(await analyzeImport({ installationId: 167616247, repo: "netanyaj/ticket-triage", branch: "main", folder: "/../secrets" })).toMatchObject({ ok: false });
  });
});

describe("planFromImport", () => {
  const save = (analysis: ReturnType<typeof analyzeRepo>) =>
    db.tables.repo_imports.push({ id: "11111111-1111-4111-8111-111111111111", workspace_id: "ws-1", full_name: "acme/app", branch: "main", folder: "/", project_id: null, analysis: { analysis, behaviour: [], behaviourError: null } });

  it("makes a draft project that keeps the repo's stack, with the analysis as its request; nothing is built", async () => {
    save(analyzeRepo({ paths: tree.map((e) => e.path), files }));
    const { planFromImport } = await import("@/server/actions/import");
    const r = await planFromImport({ importId: "11111111-1111-4111-8111-111111111111" });
    expect(r).toMatchObject({ ok: true });
    expect(db.tables.projects[0]).toMatchObject({ name: "app", status: "draft", stack: "Node.js (Express), React 18 (Vite) and Python (CrewAI)", repo_full_name: "acme/app", icon: "repo", owner_id: "me" });
    expect(String(db.tables.projects[0].prompt)).toMatch(/^Plan from repo acme\/app \(branch main\)\. Keep its stack/);
    expect(db.tables.repo_imports[0].project_id).toBe(db.tables.projects[0].id);
    expect(db.tables.runs ?? []).toEqual([]);
  });

  it("a stack Architect can't run needs Configure or Port first; Port is recorded as consent and uses the default stack", async () => {
    save(analyzeRepo({ paths: ["Gemfile", "app.rb"], files: { Gemfile: 'gem "sinatra"' } }));
    const { planFromImport } = await import("@/server/actions/import");
    expect(await planFromImport({ importId: "11111111-1111-4111-8111-111111111111" })).toEqual({
      ok: false,
      message: "Choose Configure or Port first: Architect runs Node and Python as they are. This repo also uses Ruby, which needs moving to a supported stack first.",
    });
    expect(db.tables.projects).toEqual([]);
    expect(await planFromImport({ importId: "11111111-1111-4111-8111-111111111111", port: true })).toMatchObject({ ok: true });
    expect(db.tables.projects[0]).toMatchObject({ stack: "default" });
    expect(String(db.tables.projects[0].prompt)).toContain("Port it to the default stack (Next.js + Python with the Lyzr SDK)");
    expect(db.tables.repo_imports[0].analysis).toMatchObject({ port: true });
  });
});

describe("applyRepoProofs", () => {
  it("tested parts get the repo's tests as check and proof; all passing works, a known-failing test stays to build", async () => {
    const analysis = analyzeRepo({ paths: tree.map((e) => e.path), files });
    db.tables.repo_imports.push({
      project_id: "p1",
      full_name: "netanyaj/ticket-triage",
      created_at: "2026-10-09T10:00:00Z",
      analysis: {
        analysis,
        behaviour: [
          { title: "Send to the right team", description: "", tests: ["billing tickets go to Billing"], agent: null },
          { title: "Sort tickets by urgency", description: "", tests: ["outage is P1", "SSO login failure is P1"], agent: null },
          { title: "Triager agent (CrewAI)", description: "", tests: [], agent: "triager" },
        ],
        behaviourError: null,
      },
    });
    db.tables.items.push(
      { id: "a", blueprint_id: "bp", key: "team", title: "Send to the right team", description: null, grp: "features", framework: null, status: "proposed" },
      { id: "b", blueprint_id: "bp", key: "urgency", title: "Sort tickets by their urgency", description: null, grp: "features", framework: null, status: "proposed" },
      { id: "c", blueprint_id: "bp", key: "agent", title: "Triager agent (CrewAI)", description: "Suggests a priority", grp: "agents", framework: "lyzr", status: "proposed" },
      { id: "d", blueprint_id: "bp", key: "new", title: "Post P1 tickets to Slack", description: null, grp: "integrations", framework: null, status: "proposed" },
    );
    const { applyRepoProofs } = await import("@/server/import");
    const works = await applyRepoProofs(db as never, { projectId: "p1", blueprintId: "bp" });
    expect([...works]).toEqual(["team"]);
    const item = (id: string) => db.tables.items.find((i) => i.id === id)!;
    expect(item("a")).toMatchObject({ status: "built", status_detail: "Works today · 1 of your tests", estimate_likely: 0 });
    expect(item("b")).toMatchObject({ status: "proposed", status_detail: 'Your test "SSO login failure is P1" fails today. Build fixes it.' });
    expect(item("c")).toMatchObject({ framework: "crewai", status: "proposed" });
    expect(item("d")).toMatchObject({ status: "proposed" });
    expect(db.tables.checks.map((c) => [c.item_id, c.kind, c.written_by])).toEqual([
      ["a", "api_test", "your tests"],
      ["b", "api_test", "your tests"],
    ]);
    expect(db.tables.proofs.map((p) => [p.item_id, p.result, p.assertions_passed, p.assertions_total, p.summary])).toEqual([
      ["a", "pass", 1, 1, "1 of your tests prove it"],
      ["b", "fail", 1, 2, '1 of 2 of your tests pass; "SSO login failure is P1" is marked as failing in your code'],
    ]);
  });

  it("does nothing for a project that wasn't imported", async () => {
    const { applyRepoProofs } = await import("@/server/import");
    expect([...(await applyRepoProofs(db as never, { projectId: "none", blueprintId: "bp" }))]).toEqual([]);
  });
});
