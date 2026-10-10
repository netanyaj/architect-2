import { describe, expect, it } from "vitest";
import { activityFeed, branchInfo, changesByPart, envKeys, generatedTree, partFiles, shortSha, terminalSession, type DevPart } from "@/lib/dev-view";
import type { RunEvent } from "@/lib/sim/replay";

const part = (p: Partial<DevPart> & Pick<DevPart, "key" | "title" | "grp">, position: number): DevPart => ({
  description: null,
  provedWhen: `Done when ${p.title.toLowerCase()} works`,
  status: "built",
  provider: null,
  position,
  ...p,
});

const parts: DevPart[] = [
  part({ key: "calendar-events", title: "Calendar sync", grp: "integrations", provider: "google_calendar" }, 1),
  part({ key: "talking-points", title: "Talking points", grp: "agents", description: "Three talking points" }, 2),
  part({ key: "brief-page", title: "Brief page", grp: "features", status: "agreed" }, 3),
  part({ key: "old", title: "Old part", grp: "data", status: "dropped" }, 4),
];

describe("partFiles", () => {
  it("writes each kind of part where it belongs, with its check", () => {
    expect(partFiles(parts[1]).map((f) => f.path)).toEqual(["agents/talking-points.py", "checks/talking-points.yaml"]);
    expect(partFiles(parts[0]).map((f) => f.path)).toEqual(["integrations/calendar-events.py", "checks/calendar-events.yaml"]);
    expect(partFiles(parts[2]).map((f) => f.path)).toEqual(["app/brief-page/page.tsx", "checks/brief-page.yaml"]);
    expect(partFiles(parts[1])[0].content).toContain('name="Talking points"');
    expect(partFiles(parts[1])[1].content).toContain('check: "Done when talking points works"');
  });
});

describe("changesByPart", () => {
  it("groups the files of every part the build reached, then the project's own files; nothing before Build", () => {
    const groups = changesByPart({ name: "Meeting Prep", parts, version: 1, fixes: { "talking-points": 2 }, imported: false });
    expect(groups.map((g) => [g.title, g.label])).toEqual([
      ["Calendar sync", "new"],
      ["Talking points", "new · fixed 2 of 3"],
      ["Project", "new"],
    ]);
    const py = groups[1].files[0];
    expect(py).toMatchObject({ path: "agents/talking-points.py", removed: 0 });
    expect(py.lines.every((l) => l.kind === "add")).toBe(true);
    expect(py.added).toBe(py.lines.length);
    expect(groups[2].files.map((f) => f.path)).toContain("plan.yaml");
    expect(changesByPart({ name: "x", parts: parts.map((p) => ({ ...p, status: "agreed" })), version: 1, fixes: {}, imported: false })).toEqual([]);
  });

  it("an imported repo: parts that worked already aren't changes", () => {
    const imported = parts.map((p) => (p.key === "calendar-events" ? { ...p, untouched: true } : p));
    const groups = changesByPart({ name: "x", parts: imported, version: 1, fixes: {}, imported: true });
    expect(groups.map((g) => [g.title, g.label])).toEqual([
      ["Talking points", "new"],
      ["Project", "changed"],
    ]);
    expect(groups[1].files.map((f) => f.path)).toEqual(["plan.yaml"]);
  });
});

describe("generatedTree and branchInfo", () => {
  it("a new project's tree: starting files, plan.yaml and the built parts' files", () => {
    const paths = generatedTree("Meeting Prep", 1, parts).map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(["README.md", "package.json", "requirements.txt", "plan.yaml", "agents/talking-points.py"]));
    expect(paths).not.toContain("app/brief-page/page.tsx");
  });

  it("the branch, and a pull request once there's code", () => {
    const built = branchInfo({ projectId: "p1", name: "Meeting Prep", version: 2, repo: null, runStatus: "done", parts });
    expect(built).toMatchObject({ branch: "architect/plan-v2", base: "main", status: "passing" });
    expect(built.pr).toBeGreaterThanOrEqual(10);
    expect(branchInfo({ projectId: "p1", name: "ticket-triage", version: 1, repo: "acme/ticket-triage", runStatus: null, parts: parts.map((p) => ({ ...p, status: "agreed" })) })).toMatchObject({ branch: "architect/ticket-triage-v1", pr: null, status: "none" });
    expect(branchInfo({ projectId: "p1", name: "x", version: 1, repo: null, runStatus: "running", parts }).status).toBe("running");
    expect(branchInfo({ projectId: "p1", name: "x", version: 1, repo: null, runStatus: "done", parts: [...parts, part({ key: "b", title: "B", grp: "agents", status: "paused" }, 5)] }).status).toBe("failing");
  });
});

const ev = (id: number, type: string, itemKey: string | null, payload: Record<string, unknown> = {}): RunEvent => ({ id, type, itemKey, atMs: id * 100, actorLabel: null, payload });
const events = [
  ev(1, "run.started", null, { total_items: 2 }),
  ev(2, "check.written", "talking-points", { description: "Three points" }),
  ev(3, "item.building", "talking-points"),
  ev(4, "item.failed", "talking-points", { reason: "200 words or fewer", measured: "236" }),
  ev(5, "item.fixing", "talking-points", { attempt: 1 }),
  ev(6, "log.line", "talking-points", { verb: "Edited", object: "agents/talking-points.py · +4 −1" }),
  ev(7, "item.built", "talking-points", { assertions: 3 }),
  ev(8, "run.done", null, { proven: 2, total: 2 }),
];
const titles = { "talking-points": "Talking points" };

describe("terminalSession", () => {
  it("replays the run's commands and results", () => {
    const lines = terminalSession({ events, titles, branch: "architect/plan-v1", testCommand: null }).map((l) => `${l.kind}: ${l.text}`);
    expect(lines).toEqual([
      "cmd: git switch -c architect/plan-v1",
      "info: 2 parts to build",
      'cmd: architect check --write "Talking points"',
      "info: wrote checks/talking-points.yaml · locked",
      'cmd: architect build "Talking points"',
      'cmd: architect check "Talking points"',
      "fail: × 200 words or fewer (got 236)",
      'cmd: architect fix "Talking points" --try 1',
      "info: edited agents/talking-points.py · +4 −1",
      'cmd: architect check "Talking points"',
      "ok: ✓ 3 of 3 assertions passed",
      "cmd: git push origin architect/plan-v1",
      "ok: ✓ 2 of 2 parts work",
    ]);
  });
});

describe("activityFeed", () => {
  it("the checker, the Architect agent, a coding agent via MCP and GitHub", () => {
    const feed = activityFeed({ events, titles, codingAgent: "Claude Code (Sam)", branch: "architect/plan-v1" });
    expect(feed.map((f) => [f.who, f.lines.map((l) => l.text).join(" | ")])).toEqual([
      ["Checker", "Wrote the check for Talking points: Three points"],
      ["Architect agent", "Building Talking points"],
      ["Checker", "Failed 200 words or fewer (got 236)"],
      ["Architect agent · fix 1 of 3", "Fixing Talking points | Edited agents/talking-points.py · +4 −1"],
      ["Checker", "Passed 3 of 3"],
      ["Claude Code (Sam) · via MCP", 'run_tests("Talking points") | Passed 3 of 3'],
      ["GitHub", `${shortSha("7talking-points")} "Add Talking points" → architect/plan-v1`],
    ]);
  });
});

describe("envKeys", () => {
  it("a new project's keys from its parts, set per version where it's connected and deployed", () => {
    const keys = envKeys({ parts: [...parts, part({ key: "s", title: "Slack", grp: "integrations", provider: "slack" }, 6)], repoKeys: null, connected: ["slack"], envLive: { staging: false, production: true } });
    expect(keys.map((k) => [k.name, k.test, k.team, k.live])).toEqual([
      ["GOOGLE_OAUTH_CLIENT_SECRET", false, false, false],
      ["SLACK_BOT_TOKEN", true, false, true],
      ["LYZR_API_KEY", true, false, true],
    ]);
  });

  it("an imported repo's keys from its .env.example; a model key can come from Lyzr", () => {
    const keys = envKeys({ parts: [], repoKeys: [{ name: "OPENAI_API_KEY", service: null, lyzrInstead: true }, { name: "SLACK_WEBHOOK_URL", service: "slack", lyzrInstead: false }], connected: [], envLive: { staging: false, production: false } });
    expect(keys).toEqual([
      { name: "OPENAI_API_KEY", why: "Model key: Lyzr can provide it", test: true, team: false, live: false, service: null },
      { name: "SLACK_WEBHOOK_URL", why: "For Slack", test: false, team: false, live: false, service: "slack" },
    ]);
  });
});
