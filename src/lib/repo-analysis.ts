/**
 * Static analysis of an imported repo (B-2): what it's built with, how it starts, the keys it needs, its tests and
 * the agents in its code. Pure functions over file paths and contents, so they run in tests without GitHub.
 * The server reads the files (src/server/github.ts) within the caps below; the gateway then turns this into the
 * repo's current behaviour as plan parts.
 */

/** Read limits: how many files, how big each may be, and how much in total. */
export const READ_CAPS = { maxFiles: 40, maxFileBytes: 64 * 1024, maxTotalBytes: 512 * 1024, maxTestFiles: 12, maxSourceFiles: 16, maxTreeEntries: 5000 } as const;

export type RepoEntry = { path: string; size: number };

export type FoundTest = { file: string; name: string; knownFailing: boolean };
export type FoundAgent = { name: string; framework: "crewai" | "langgraph" | "lyzr"; file: string; role: string | null };
export type FoundKey = { name: string; service: string | null; /** A model provider's key: Lyzr Studio can provide the model instead. */ lyzrInstead: boolean };

export type RepoAnalysis = {
  languages: string[];
  frameworks: string[];
  /** "Node.js (Express), React 18 (Vite) and Python (CrewAI)". */
  stack: string;
  /** The files the stack was read from. */
  evidence: string[];
  /** Node and Python run as they are (B-3); anything else needs Configure or Port. */
  runnable: { ok: true } | { ok: false; language: string; reason: string };
  run: string[];
  install: string[];
  testCommand: string | null;
  keys: FoundKey[];
  /** Settings from .env.example that aren't secrets (PORT, NODE_ENV …). */
  settings: string[];
  tests: FoundTest[];
  agents: FoundAgent[];
  routes: string[];
  readme: string | null;
  knownIssues: string[];
  read: { files: number; bytes: number; skippedLarge: number; truncated: boolean };
};

const SUPPORTED = new Set(["Node.js", "Python"]);
const base = (p: string) => p.split("/").pop() ?? p;
const depth = (p: string) => p.split("/").length - 1;

const MANIFESTS = /^(package\.json|requirements[\w.-]*\.txt|pyproject\.toml|Pipfile|setup\.py|Dockerfile|docker-compose\.ya?ml|compose\.ya?ml|Procfile|\.env\.(example|sample|template)|Gemfile|go\.mod|pom\.xml|build\.gradle(\.kts)?|composer\.json|Cargo\.toml|[\w.-]+\.csproj)$/i;
const README = /^readme(\.md|\.markdown|\.txt|\.rst)?$/i;
export const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/.+\.(m?[jt]sx?|py)$|\.(test|spec)\.m?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.py$/;
const SOURCE = /\.(py|m?[jt]sx?)$/;
const SKIP_DIRS = /(^|\/)(node_modules|\.git|dist|build|\.next|vendor|venv|\.venv|__pycache__|coverage)\//;

/** Which files to read, in priority order, within the caps: manifests, README, tests, then likely source files. */
export function filesToRead(entries: RepoEntry[]): { read: string[]; skippedLarge: number } {
  const usable = entries.filter((e) => !SKIP_DIRS.test(e.path));
  const small = usable.filter((e) => e.size <= READ_CAPS.maxFileBytes);
  const skippedLarge = usable.length - small.length;
  const manifests = small.filter((e) => MANIFESTS.test(base(e.path)) && depth(e.path) <= 2).sort((a, b) => depth(a.path) - depth(b.path));
  const readme = small.filter((e) => README.test(base(e.path)) && depth(e.path) === 0);
  const tests = small.filter((e) => TEST_FILE.test(e.path)).slice(0, READ_CAPS.maxTestFiles);
  const score = (p: string) => (/agent|crew|graph|lyzr/i.test(p) ? 0 : /(^|\/)(server|app|main|index|api|src)(\/|\.)/.test(p) ? 1 : 2);
  const sources = small
    .filter((e) => SOURCE.test(e.path) && !TEST_FILE.test(e.path) && depth(e.path) <= 3)
    .sort((a, b) => score(a.path) - score(b.path) || depth(a.path) - depth(b.path))
    .slice(0, READ_CAPS.maxSourceFiles);
  const ordered: RepoEntry[] = [];
  for (const e of [...manifests, ...readme, ...tests, ...sources]) if (!ordered.includes(e)) ordered.push(e);
  const read: string[] = [];
  let bytes = 0;
  for (const e of ordered) {
    if (read.length >= READ_CAPS.maxFiles || bytes + e.size > READ_CAPS.maxTotalBytes) break;
    read.push(e.path);
    bytes += e.size;
  }
  return { read, skippedLarge };
}

function languagesOf(paths: string[]): string[] {
  const has = (re: RegExp) => paths.some((p) => re.test(p));
  const langs: string[] = [];
  if (has(/(^|\/)package\.json$/) || has(/\.m?[jt]sx?$/)) langs.push("Node.js");
  if (has(/(^|\/)(requirements[\w.-]*\.txt|pyproject\.toml|Pipfile|setup\.py)$/) || has(/\.py$/)) langs.push("Python");
  if (has(/(^|\/)Gemfile$/) || has(/\.rb$/)) langs.push("Ruby");
  if (has(/(^|\/)go\.mod$/) || has(/\.go$/)) langs.push("Go");
  if (has(/(^|\/)(pom\.xml|build\.gradle(\.kts)?)$/) || has(/\.(java|kt)$/)) langs.push("Java");
  if (has(/(^|\/)composer\.json$/) || has(/\.php$/)) langs.push("PHP");
  if (has(/(^|\/)Cargo\.toml$/) || has(/\.rs$/)) langs.push("Rust");
  if (has(/\.(csproj|cs)$/)) langs.push(".NET");
  return langs;
}

type Pkg = { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
function parseJson<T>(text: string | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

const major = (range: string | undefined) => range?.match(/(\d+)/)?.[1] ?? null;

function pythonDeps(files: Record<string, string>): string[] {
  const deps: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    const name = base(path);
    if (/^requirements[\w.-]*\.txt$/i.test(name)) {
      for (const line of text.split("\n")) {
        const m = line.trim().match(/^([A-Za-z0-9_.-]+)/);
        if (m && !line.trim().startsWith("#") && !line.trim().startsWith("-")) deps.push(m[1].toLowerCase());
      }
    } else if (name === "pyproject.toml" || name === "Pipfile") {
      for (const m of text.matchAll(/["']?([A-Za-z0-9_.-]+)\s*(?:[<>=~!]=?|["'])/g)) deps.push(m[1].toLowerCase());
    }
  }
  return deps;
}

const KEY_SERVICES: [RegExp, string | null, boolean][] = [
  [/^(OPENAI|ANTHROPIC|GEMINI|GOOGLE_GENERATIVE_AI|GROQ|MISTRAL|COHERE|OPENROUTER)_/, null, true],
  [/^SLACK_/, "slack", false],
  [/^ZENDESK_/, "zendesk", false],
  [/^HUBSPOT_/, "hubspot", false],
  [/^GITHUB_/, "github", false],
  [/^(GMAIL|GOOGLE_CALENDAR|GOOGLE)_/, "gmail", false],
];
const NOT_SECRETS = /^(PORT|HOST|NODE_ENV|DEBUG|LOG_LEVEL|ENV|APP_ENV|TZ|BASE_URL|PUBLIC_URL)$/;

function testsIn(path: string, text: string): FoundTest[] {
  const lines = text.split("\n");
  const out: FoundTest[] = [];
  const markedAbove = (i: number) => lines.slice(Math.max(0, i - 2), i).some((l) => /(#|\/\/|\/\*).*(known[ -]?fail|fails today|failing|broken|flaky|xfail)/i.test(l) || /@pytest\.mark\.(skip|xfail)/.test(l));
  lines.forEach((line, i) => {
    const js = line.match(/\b(?:test|it)(?:\.(skip|todo|fails))?\(\s*(['"`])(.+?)\2/);
    if (js) out.push({ file: path, name: js[3], knownFailing: Boolean(js[1]) || markedAbove(i) });
    const py = line.match(/^\s*(?:async\s+)?def\s+(test_\w+)\s*\(/);
    if (py) out.push({ file: path, name: py[1], knownFailing: markedAbove(i) });
  });
  return out;
}

function agentsIn(path: string, text: string): FoundAgent[] {
  const out: FoundAgent[] = [];
  if (/\bfrom\s+crewai\b|\bimport\s+crewai\b/.test(text)) {
    for (const m of text.matchAll(/^(\w+)\s*=\s*Agent\(([\s\S]*?)\n\)/gm)) {
      const role = m[2].match(/role\s*=\s*["']([^"']+)["']/)?.[1] ?? null;
      out.push({ name: m[1], framework: "crewai", file: path, role });
    }
    if (!out.length) out.push({ name: base(path).replace(/\.\w+$/, ""), framework: "crewai", file: path, role: null });
  }
  if (/\bfrom\s+langgraph\b|\bimport\s+langgraph\b|@langchain\/langgraph/.test(text)) {
    const graphs = [...text.matchAll(/^(?:const\s+)?(\w+)\s*=\s*(?:new\s+)?StateGraph\(/gm)].map((m) => m[1]);
    for (const g of graphs.length ? graphs : [base(path).replace(/\.\w+$/, "")]) out.push({ name: g, framework: "langgraph", file: path, role: null });
  }
  if (/\bfrom\s+lyzr\w*\b|\bimport\s+lyzr\w*\b|lyzr-agent-api|agent-prod\.studio\.lyzr\.ai/i.test(text)) {
    out.push({ name: base(path).replace(/\.\w+$/, ""), framework: "lyzr", file: path, role: null });
  }
  return out;
}

function routesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(?:app|router)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)/g)) out.push(`${m[1].toUpperCase()} ${m[2]}`);
  for (const m of text.matchAll(/@(?:app|router|bp)\.(get|post|put|patch|delete|route)\(\s*['"]([^'"]+)/g)) out.push(`${m[1] === "route" ? "ANY" : m[1].toUpperCase()} ${m[2]}`);
  return out;
}

function readmeParts(text: string | undefined): { intro: string | null; issues: string[] } {
  if (!text) return { intro: null, issues: [] };
  const lines = text.split("\n");
  const intro: string[] = [];
  for (const line of lines.slice(1)) {
    if (/^#{1,6}\s/.test(line)) {
      if (intro.join(" ").trim()) break;
      continue;
    }
    intro.push(line.trim());
  }
  const issues: string[] = [];
  const at = lines.findIndex((l) => /^#{1,6}\s*(known issues|known bugs|bugs|limitations)/i.test(l));
  if (at >= 0) {
    for (const line of lines.slice(at + 1)) {
      if (/^#{1,6}\s/.test(line)) break;
      const m = line.match(/^\s*[-*]\s+(.+)/);
      if (m) issues.push(m[1].replace(/[*_`]/g, "").trim());
    }
  }
  const clean = intro.join(" ").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
  return { intro: clean ? clean.slice(0, 700) : null, issues: issues.slice(0, 6) };
}

/** Everything static analysis can tell from the tree and the files read. */
export function analyzeRepo(input: { paths: string[]; files: Record<string, string>; skippedLarge?: number; truncated?: boolean }): RepoAnalysis {
  const { paths, files } = input;
  const languages = languagesOf(paths);
  const pkgPaths = Object.keys(files).filter((p) => base(p) === "package.json").sort((a, b) => depth(a) - depth(b));
  const pkgs = pkgPaths.map((p) => ({ path: p, pkg: parseJson<Pkg>(files[p]) })).filter((x): x is { path: string; pkg: Pkg } => x.pkg !== null);
  const deps: Record<string, string> = Object.assign({}, ...pkgs.map((x) => ({ ...x.pkg.devDependencies, ...x.pkg.dependencies })));
  const py = pythonDeps(files);
  const hasPy = (n: string) => py.some((d) => d === n || d.startsWith(`${n}-`) || d.startsWith(`${n}_`));

  const frameworks: string[] = [];
  const nodeServer = ["express", "fastify", "@nestjs/core", "koa", "hono"].find((d) => deps[d]);
  const nodeServerName: Record<string, string> = { express: "Express", fastify: "Fastify", "@nestjs/core": "NestJS", koa: "Koa", hono: "Hono" };
  if (deps.next) frameworks.push(`Next.js ${major(deps.next) ?? ""}`.trim());
  if (nodeServer) frameworks.push(nodeServerName[nodeServer]);
  if (deps.react && !deps.next) frameworks.push(`React ${major(deps.react) ?? ""}`.trim());
  if (deps.vue) frameworks.push(`Vue ${major(deps.vue) ?? ""}`.trim());
  if (deps.svelte) frameworks.push("Svelte");
  if (deps.vite) frameworks.push("Vite");
  const pyFrameworks: string[] = [];
  for (const [dep, name] of [["fastapi", "FastAPI"], ["flask", "Flask"], ["django", "Django"], ["streamlit", "Streamlit"], ["crewai", "CrewAI"], ["langgraph", "LangGraph"], ["lyzr", "Lyzr SDK"]] as const) {
    if (hasPy(dep)) pyFrameworks.push(name);
  }
  frameworks.push(...pyFrameworks);

  // The stack in one line: the server, the screens, the Python side, then anything else.
  const parts: string[] = [];
  if (languages.includes("Node.js")) {
    if (deps.next) parts.push(`Next.js ${major(deps.next) ?? ""}`.trim());
    else {
      if (nodeServer) parts.push(`Node.js (${nodeServerName[nodeServer]})`);
      const ui = deps.react ? `React ${major(deps.react) ?? ""}`.trim() : deps.vue ? "Vue" : deps.svelte ? "Svelte" : null;
      if (ui) parts.push(deps.vite ? `${ui} (Vite)` : ui);
      if (!nodeServer && !ui) parts.push("Node.js");
    }
  }
  if (languages.includes("Python")) parts.push(pyFrameworks.length ? `Python (${pyFrameworks.join(", ")})` : "Python");
  for (const l of languages) if (!SUPPORTED.has(l)) parts.push(l);
  const stack = parts.length <= 1 ? (parts[0] ?? "Unknown") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const evidence = Object.keys(files).filter((p) => MANIFESTS.test(base(p)) && !/^\.env\./.test(base(p)));

  const other = languages.find((l) => !SUPPORTED.has(l));
  const runnable: RepoAnalysis["runnable"] = !languages.length
    ? { ok: false, language: "Unknown", reason: "Architect couldn't tell what this repo is built with: there's no package.json, requirements file or pyproject." }
    : other
      ? { ok: false, language: other, reason: `Architect runs Node and Python as they are. This repo also uses ${other}, which needs moving to a supported stack first.` }
      : { ok: true };

  // How it starts.
  const lock = paths.some((p) => base(p) === "pnpm-lock.yaml") ? "pnpm" : paths.some((p) => base(p) === "yarn.lock") ? "yarn" : "npm";
  const runScript = (s: string) => (lock === "npm" ? (s === "start" || s === "test" ? `npm ${s}` : `npm run ${s}`) : `${lock} ${s}`);
  const install: string[] = [];
  const run: string[] = [];
  let testCommand: string | null = null;
  const rootPkg = pkgs[0];
  if (rootPkg) {
    install.push(`${lock} install`);
    const scripts = rootPkg.pkg.scripts ?? {};
    const dir = depth(rootPkg.path) ? ` --prefix ${rootPkg.path.replace(/\/package\.json$/, "")}` : "";
    const s = scripts.dev ? "dev" : scripts.start ? "start" : null;
    if (s) run.push(`${runScript(s)}${dir}`);
    if (scripts.test && !/no test specified/.test(scripts.test)) testCommand = `${runScript("test")}${dir}`;
  }
  const reqs = Object.keys(files).filter((p) => /^requirements\.txt$/i.test(base(p)));
  for (const r of reqs) install.push(`pip install -r ${r}`);
  if (Object.keys(files).some((p) => base(p) === "pyproject.toml") && !reqs.length) install.push("pip install .");
  const procfile = Object.entries(files).find(([p]) => base(p) === "Procfile")?.[1];
  const web = procfile?.match(/^web:\s*(.+)$/m)?.[1];
  if (web) run.push(web.trim());
  for (const [path, text] of Object.entries(files)) {
    if (!path.endsWith(".py")) continue;
    const appVar = text.match(/^(\w+)\s*=\s*FastAPI\(/m)?.[1];
    if (appVar && !run.some((c) => c.startsWith("uvicorn"))) run.push(`uvicorn ${path.replace(/\.py$/, "").replace(/\//g, ".")}:${appVar}`);
  }
  const dockerCmd = Object.entries(files).find(([p]) => base(p) === "Dockerfile")?.[1]?.match(/^CMD\s+(.+)$/m)?.[1];
  if (!run.length && dockerCmd) run.push(dockerCmd.replace(/^\[|\]$/g, "").replace(/"\s*,\s*"/g, " ").replace(/"/g, ""));
  const pyTests = Object.keys(files).some((p) => TEST_FILE.test(p) && p.endsWith(".py"));
  if (!testCommand && pyTests) testCommand = "pytest";

  // Keys from .env.example.
  const envText = Object.entries(files).find(([p]) => /^\.env\.(example|sample|template)$/.test(base(p)))?.[1] ?? "";
  const keys: FoundKey[] = [];
  const settings: string[] = [];
  for (const m of envText.matchAll(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/gm)) {
    const name = m[1];
    if (NOT_SECRETS.test(name)) {
      settings.push(name);
      continue;
    }
    const hit = KEY_SERVICES.find(([re]) => re.test(name));
    keys.push({ name, service: hit?.[1] ?? null, lyzrInstead: hit?.[2] ?? false });
  }

  const tests: FoundTest[] = [];
  const agents: FoundAgent[] = [];
  const routes: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    if (TEST_FILE.test(path)) tests.push(...testsIn(path, text));
    else if (SOURCE.test(path)) {
      agents.push(...agentsIn(path, text));
      routes.push(...routesIn(text));
    }
  }
  const readmeText = Object.entries(files).find(([p]) => README.test(base(p)) && depth(p) === 0)?.[1];
  const { intro, issues } = readmeParts(readmeText);

  return {
    languages,
    frameworks,
    stack,
    evidence,
    runnable,
    run,
    install,
    testCommand,
    keys,
    settings,
    tests,
    agents,
    routes: Array.from(new Set(routes)).slice(0, 20),
    readme: intro,
    knownIssues: issues,
    read: { files: Object.keys(files).length, bytes: Object.values(files).reduce((n, t) => n + t.length, 0), skippedLarge: input.skippedLarge ?? 0, truncated: input.truncated ?? false },
  };
}

/**
 * A part of today's behaviour, with the tests (by name) that prove it and, for an AI agent in the code, its name.
 * Labelled by the model, checked by the server.
 */
export type BehaviourPart = { title: string; description: string; tests: string[]; agent?: string | null };

const FRAMEWORK_NAME = { crewai: "CrewAI", langgraph: "LangGraph", lyzr: "Lyzr" } as const;
const humanize = (s: string) => s.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/**
 * Keeps only test names and agents the analysis found, drops empty or duplicate parts, caps the list, and gives
 * every agent in the code a part of its own (the server adds one if the model left it out).
 */
export function checkBehaviour(parts: BehaviourPart[], tests: FoundTest[], agents: FoundAgent[] = []): BehaviourPart[] {
  const names = new Set(tests.map((t) => t.name));
  const agentNames = new Set(agents.map((a) => a.name));
  const agentsUsed = new Set<string>();
  const seen = new Set<string>();
  const used = new Set<string>();
  const out: BehaviourPart[] = [];
  for (const p of parts) {
    const title = p.title.trim().replace(/\s+/g, " ").slice(0, 80);
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    // A test proves one part: the first part that claims it.
    const own = Array.from(new Set(p.tests.map((t) => t.trim()))).filter((t) => names.has(t) && !used.has(t));
    own.forEach((t) => used.add(t));
    const agent = p.agent && agentNames.has(p.agent) && !agentsUsed.has(p.agent) ? p.agent : null;
    if (agent) agentsUsed.add(agent);
    out.push({ title, description: p.description.trim().slice(0, 300), tests: own, agent });
    if (out.length === 8) break;
  }
  for (const a of agents) {
    if (agentsUsed.has(a.name) || out.length >= 10) continue;
    out.push({ title: `${humanize(a.name)} agent (${FRAMEWORK_NAME[a.framework]})`, description: a.role ? `${a.role}, in ${a.file}.` : `An AI agent in ${a.file}.`, tests: [], agent: a.name });
  }
  return out;
}

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2));

/** Which part of today's behaviour a plan part is: the same title, or one sharing most of its words. */
export function matchBehaviour<T extends { title: string }>(planTitle: string, parts: T[]): T | null {
  const exact = parts.find((p) => p.title.toLowerCase() === planTitle.toLowerCase());
  if (exact) return exact;
  const a = words(planTitle);
  let best: { part: T; score: number } | null = null;
  for (const p of parts) {
    const b = words(p.title);
    if (!a.size || !b.size) continue;
    const shared = [...a].filter((w) => b.has(w)).length;
    const score = shared / Math.max(a.size, b.size);
    if (!best || score > best.score) best = { part: p, score };
  }
  return best && best.score >= 0.6 ? best.part : null;
}

/** The request the planner gets for a repo: the analysis in plain words, so every quote comes from it. */
export function repoPlanRequest(input: { repo: string; branch: string; folder: string; analysis: RepoAnalysis; behaviour: BehaviourPart[]; port: boolean }): string {
  const a = input.analysis;
  const where = `${input.repo} (branch ${input.branch}${input.folder !== "/" ? `, folder ${input.folder}` : ""})`;
  const lines = [
    `Plan from repo ${where}. Keep its stack: ${a.stack}.${input.port ? " Port it to the default stack (Next.js + Python with the Lyzr SDK), keeping what it does today." : ""}`,
    a.readme ? `What it does today: ${a.readme}` : "",
    "Today's behaviour, each kept as a part with this exact title:",
    ...input.behaviour.map((b) => {
      const agent = b.agent ? a.agents.find((g) => g.name === b.agent) : undefined;
      const kind = agent ? ` An AI agent in ${FRAMEWORK_NAME[agent.framework]} (${agent.file}); keep it in ${FRAMEWORK_NAME[agent.framework]}.` : "";
      return `- ${b.title}: ${b.description}${kind}${b.tests.length ? ` (proved by your tests: ${b.tests.map((t) => `"${t}"`).join(", ")})` : " (no tests yet)"}`;
    }),
    a.agents.length ? `AI agents in the code: ${a.agents.map((g) => `${g.name}${g.role ? ` (${g.role})` : ""}, ${g.framework === "crewai" ? "CrewAI" : g.framework === "langgraph" ? "LangGraph" : "Lyzr"}, in ${g.file}`).join("; ")}.` : "",
    a.tests.length
      ? `It has ${a.tests.length} tests already, in ${Array.from(new Set(a.tests.map((t) => t.file))).join(", ")}${a.testCommand ? `, run with ${a.testCommand}` : ""}; they are the checks for the parts above.`
      : "It has no tests yet.",
    a.keys.length ? `Keys it needs (settings, not parts): ${a.keys.map((k) => k.name).join(", ")}.` : "",
    a.knownIssues.length ? `Known issues: ${a.knownIssues.join("; ")}.` : "",
  ].filter(Boolean);
  return lines.join("\n").slice(0, 3900);
}
