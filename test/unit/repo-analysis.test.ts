import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeRepo, checkBehaviour, filesToRead, matchBehaviour, READ_CAPS, repoPlanRequest, type RepoEntry } from "@/lib/repo-analysis";

// A copy of github.com/netanyaj/ticket-triage (the repo the GitHub App is installed on).
const DIR = join(__dirname, "../fixtures/repos/ticket-triage");
const tree = JSON.parse(readFileSync(join(DIR, "tree.json"), "utf8")) as RepoEntry[];
const read = (paths: string[]) => Object.fromEntries(paths.map((p) => [p, readFileSync(join(DIR, "files", p), "utf8")]));

describe("filesToRead", () => {
  it("reads the manifests, README, tests and likely source files of ticket-triage, not data or styles", () => {
    const { read: picked } = filesToRead(tree);
    // Manifests first, then the README.
    expect(new Set(picked.slice(0, 4))).toEqual(new Set(["package.json", ".env.example", "agents/requirements.txt", "README.md"]));
    expect(picked).toContain("tests/triage.test.js");
    expect(picked).toContain("agents/triage_agent.py");
    expect(picked).toContain("server/index.js");
    expect(picked).not.toContain("data/tickets.json");
    expect(picked).not.toContain("client/src/styles.css");
  });

  it("keeps within the caps: no file over 64 KB, at most 40 files and 512 KB, nothing in node_modules", () => {
    const big: RepoEntry[] = [
      ...Array.from({ length: 80 }, (_, i) => ({ path: `src/file${i}.ts`, size: 20_000 })),
      { path: "package.json", size: 900 },
      { path: "src/huge.js", size: 500_000 },
      { path: "node_modules/x/index.js", size: 10 },
    ];
    const { read: picked, skippedLarge } = filesToRead(big);
    expect(picked.length).toBeLessThanOrEqual(READ_CAPS.maxFiles);
    expect(picked).not.toContain("src/huge.js");
    expect(picked.some((p) => p.startsWith("node_modules/"))).toBe(false);
    expect(skippedLarge).toBe(1);
    expect(picked.reduce((n, p) => n + big.find((e) => e.path === p)!.size, 0)).toBeLessThanOrEqual(READ_CAPS.maxTotalBytes);
  });
});

describe("analyzeRepo on ticket-triage", () => {
  const { read: picked } = filesToRead(tree);
  const a = analyzeRepo({ paths: tree.map((e) => e.path), files: read(picked) });

  it("finds the stack and that it runs as it is", () => {
    expect(a.languages).toEqual(["Node.js", "Python"]);
    expect(a.stack).toBe("Node.js (Express), React 18 (Vite) and Python (CrewAI)");
    expect(a.evidence).toEqual(expect.arrayContaining(["package.json", "agents/requirements.txt"]));
    expect(a.runnable).toEqual({ ok: true });
  });

  it("finds how it starts and how it's tested", () => {
    expect(a.install).toEqual(["npm install", "pip install -r agents/requirements.txt"]);
    expect(a.run).toEqual(["npm run dev"]);
    expect(a.testCommand).toBe("npm test");
  });

  it("finds the keys it needs; PORT is a setting, OPENAI_API_KEY can come from Lyzr, a webhook secret is set by a person", () => {
    expect(a.keys).toEqual([
      { name: "OPENAI_API_KEY", service: null, lyzrInstead: true },
      { name: "SLACK_WEBHOOK_URL", service: "slack", lyzrInstead: false },
      { name: "ZENDESK_WEBHOOK_SECRET", service: null, lyzrInstead: false },
    ]);
    expect(a.settings).toEqual(["PORT"]);
  });

  it("finds its 3 tests, and the one the code marks as failing", () => {
    expect(a.tests).toEqual([
      { file: "tests/triage.test.js", name: "outage is P1", knownFailing: false },
      { file: "tests/triage.test.js", name: "billing tickets go to Billing", knownFailing: false },
      { file: "tests/triage.test.js", name: "SSO login failure is P1", knownFailing: true },
    ]);
  });

  it("finds the CrewAI agent with its role, the API routes, and the README's summary and known issues", () => {
    expect(a.agents).toEqual([{ name: "triager", framework: "crewai", file: "agents/triage_agent.py", role: "Support Triage Lead" }]);
    expect(a.routes).toEqual(["GET /api/tickets", "POST /api/tickets/:id/triage"]);
    expect(a.readme).toMatch(/^A small support-ticket triage tool\./);
    expect(a.knownIssues).toEqual(['The "Only P1" filter in the UI shows all tickets (bug).', "The CrewAI agent in agents/ is not connected to the API."]);
  });
});

describe("other stacks", () => {
  it("a Ruby app can be analysed but not run as it is: it says why", () => {
    const a = analyzeRepo({ paths: ["Gemfile", "app/models/invoice.rb", "config.ru"], files: { Gemfile: 'gem "rails"' } });
    expect(a.languages).toEqual(["Ruby"]);
    expect(a.runnable).toEqual({ ok: false, language: "Ruby", reason: "Architect runs Node and Python as they are. This repo also uses Ruby, which needs moving to a supported stack first." });
  });

  it("FastAPI with pytest and a LangGraph agent", () => {
    const a = analyzeRepo({
      paths: ["pyproject.toml", "app/main.py", "app/graph.py", "tests/test_api.py"],
      files: {
        "pyproject.toml": '[project]\ndependencies = ["fastapi>=0.110", "langgraph>=0.2"]',
        "app/main.py": "from fastapi import FastAPI\napp = FastAPI()\n@app.get('/health')\ndef health(): return {}",
        "app/graph.py": "from langgraph.graph import StateGraph\nflow = StateGraph(dict)\n",
        "tests/test_api.py": "def test_health():\n    pass\n\n@pytest.mark.xfail\ndef test_slow():\n    pass\n",
      },
    });
    expect(a.stack).toBe("Python (FastAPI, LangGraph)");
    expect(a.run).toEqual(["uvicorn app.main:app"]);
    expect(a.install).toEqual(["pip install ."]);
    expect(a.testCommand).toBe("pytest");
    expect(a.agents).toEqual([{ name: "flow", framework: "langgraph", file: "app/graph.py", role: null }]);
    expect(a.tests.map((t) => [t.name, t.knownFailing])).toEqual([
      ["test_health", false],
      ["test_slow", true],
    ]);
    expect(a.routes).toEqual(["GET /health"]);
  });

  it("an empty folder says it can't tell the stack", () => {
    expect(analyzeRepo({ paths: [], files: {} }).runnable).toMatchObject({ ok: false, language: "Unknown" });
  });
});

describe("today's behaviour (model labels, server decides)", () => {
  const tests = [
    { file: "t.js", name: "outage is P1", knownFailing: false },
    { file: "t.js", name: "billing tickets go to Billing", knownFailing: false },
  ];
  it("keeps only tests that exist, gives each test to one part, and drops duplicate titles", () => {
    expect(
      checkBehaviour(
        [
          { title: "Sort tickets by urgency", description: "P1 to P3", tests: ["outage is P1", "made-up test"] },
          { title: "sort tickets by urgency", description: "dup", tests: [] },
          { title: "Send to the right team", description: "Billing, Identity, Product", tests: ["billing tickets go to Billing", "outage is P1"] },
        ],
        tests,
      ),
    ).toEqual([
      { title: "Sort tickets by urgency", description: "P1 to P3", tests: ["outage is P1"], agent: null },
      { title: "Send to the right team", description: "Billing, Identity, Product", tests: ["billing tickets go to Billing"], agent: null },
    ]);
  });

  it("an agent the model names must be in the code; an agent it leaves out gets a part of its own", () => {
    const agents = [
      { name: "triager", framework: "crewai" as const, file: "agents/triage_agent.py", role: "Support Triage Lead" },
      { name: "router", framework: "langgraph" as const, file: "agents/router.py", role: null },
    ];
    const out = checkBehaviour(
      [
        { title: "Triage with AI", description: "Suggests priority", tests: [], agent: "triager" },
        { title: "Made-up agent", description: "x", tests: [], agent: "ghost" },
      ],
      tests,
      agents,
    );
    expect(out.map((p) => [p.title, p.agent])).toEqual([
      ["Triage with AI", "triager"],
      ["Made-up agent", null],
      ["Router agent (LangGraph)", "router"],
    ]);
    expect(out[2].description).toBe("An AI agent in agents/router.py.");
  });

  it("matches a plan part to today's behaviour by title, or by most of its words", () => {
    const parts = [{ title: "Sort tickets by urgency" }, { title: "Send to the right team" }];
    expect(matchBehaviour("Sort tickets by urgency", parts)?.title).toBe("Sort tickets by urgency");
    expect(matchBehaviour("Sort tickets by their urgency", parts)?.title).toBe("Sort tickets by urgency");
    expect(matchBehaviour("Post P1 tickets to Slack", parts)).toBeNull();
  });

  it("the planner's request carries the analysis, so every quote can come from it", () => {
    const { read: picked } = filesToRead(tree);
    const analysis = analyzeRepo({ paths: tree.map((e) => e.path), files: read(picked) });
    const req = repoPlanRequest({ repo: "netanyaj/ticket-triage", branch: "main", folder: "/", analysis, behaviour: [{ title: "Sort tickets by urgency", description: "P1 to P3 from keywords", tests: ["outage is P1"] }], port: false });
    expect(req).toContain("Plan from repo netanyaj/ticket-triage (branch main). Keep its stack: Node.js (Express), React 18 (Vite) and Python (CrewAI).");
    expect(req).toContain('- Sort tickets by urgency: P1 to P3 from keywords (proved by your tests: "outage is P1")');
    expect(req).toContain("AI agents in the code: triager (Support Triage Lead), CrewAI, in agents/triage_agent.py.");
    const withAgent = repoPlanRequest({ repo: "r/x", branch: "main", folder: "/", analysis, behaviour: [{ title: "Triage with AI", description: "Suggests a priority.", tests: [], agent: "triager" }], port: false });
    expect(withAgent).toContain("- Triage with AI: Suggests a priority. An AI agent in CrewAI (agents/triage_agent.py); keep it in CrewAI. (no tests yet)");
    expect(req).toContain("It has 3 tests already, in tests/triage.test.js, run with npm test; they are the checks for the parts above.");
    expect(req).toContain("Keys it needs (settings, not parts): OPENAI_API_KEY, SLACK_WEBHOOK_URL, ZENDESK_WEBHOOK_SECRET.");
    expect(req.length).toBeLessThanOrEqual(3900);
  });
});
