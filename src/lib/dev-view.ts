/**
 * Developer view (screen 8), simulated: the code Architect writes for each part, the changes compared with main
 * grouped by part, the terminal session and the activity, all derived from the plan and its run. Pure functions;
 * an imported repo's real files come from the server instead (src/server/actions/dev.ts).
 */
import { apiKeyEnvName } from "./api-keys";
import { providerName } from "./providers";
import type { RunEvent } from "./sim/replay";

export type DevPart = {
  key: string;
  title: string;
  description: string | null;
  provedWhen: string;
  grp: string;
  status: string;
  provider: string | null;
  position: number;
  /** A part an imported repo already does (proved by its tests): Architect didn't write code for it. */
  untouched?: boolean;
  /** Its check is running again after a code edit (not a build). */
  rechecking?: boolean;
};
export type DevFile = { path: string; content: string };
export type DiffLine = { kind: "add" | "del" | "same"; oldNo: number | null; newNo: number | null; text: string };
export type ChangedFile = { path: string; added: number; removed: number; lines: DiffLine[] };
export type ChangeGroup = { key: string; title: string; label: string; files: ChangedFile[] };

/** Parts Architect has written code for (anything the build reached). Parts that work today in an imported repo didn't change. */
const WRITTEN = new Set(["building", "built", "sample_data", "failed", "paused", "needs_connection", "needs_approval"]);

export function slugOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";
}

const snake = (key: string) => key.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").toLowerCase() || "part";
const pascal = (key: string) => key.split(/[^a-z0-9]+/i).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join("") || "Part";
const quote = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** A stable number from a string (PR numbers, commit hashes). */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
export const shortSha = (s: string) => hash(s).toString(16).padStart(8, "0").slice(0, 7);

/** The branch Architect works on, and its pull request into main (Simulated, BL-11). */
export function branchInfo(input: { projectId: string; name: string; version: number; repo: string | null; runStatus: string | null; parts: DevPart[] }) {
  const branch = input.repo ? `architect/${slugOf(input.name)}-v${input.version}` : `architect/plan-v${input.version}`;
  const written = input.parts.some((p) => WRITTEN.has(p.status) && !p.untouched);
  const pr = 10 + (hash(input.projectId) % 90);
  const status: "none" | "running" | "passing" | "failing" = !written
    ? "none"
    : input.runStatus === "running" || input.runStatus === "queued"
      ? "running"
      : input.parts.some((p) => p.status === "failed" || p.status === "paused")
        ? "failing"
        : "passing";
  return { branch, base: "main", pr: status === "none" ? null : pr, status };
}

/** The files Architect writes for a part, by kind: a screen, a table, a connection, an agent, plus its check. */
export function partFiles(part: DevPart): DevFile[] {
  const check: DevFile = {
    path: `checks/${part.key}.yaml`,
    content: [`part: ${part.title}`, `check: "${quote(part.provedWhen)}"`, `kind: ${part.grp === "agents" ? "eval" : part.grp === "features" ? "ui_test" : part.grp === "quality" ? "http" : "api_test"}`, "written_by: checker", "locked: true", ""].join("\n"),
  };
  const when = part.provedWhen.replace(/^done when\s+/i, "");
  const about = [part.description, `Done when ${when.charAt(0).toLowerCase()}${when.slice(1)}`].filter(Boolean) as string[];
  switch (part.grp) {
    case "features":
      return [
        {
          path: `app/${part.key}/page.tsx`,
          content: [
            ...about.map((l) => `// ${l}`),
            `import { load${pascal(part.key)} } from "@/server/${part.key}";`,
            "",
            "export default async function Page() {",
            `  const rows = await load${pascal(part.key)}();`,
            "  return (",
            "    <main>",
            `      <h1>${part.title}</h1>`,
            "      <List rows={rows} />",
            "    </main>",
            "  );",
            "}",
            "",
          ].join("\n"),
        },
        check,
      ];
    case "data":
      return [
        {
          path: `db/${part.key}.sql`,
          content: [...about.map((l) => `-- ${l}`), `create table ${snake(part.key)} (`, "  id uuid primary key default gen_random_uuid(),", "  data jsonb not null default '{}',", "  created_at timestamptz not null default now()", ");", ""].join("\n"),
        },
        check,
      ];
    case "integrations":
      return [
        {
          path: `integrations/${part.key}.py`,
          content: [
            `"""${part.title}. ${about.join(" ")}"""`,
            "from lyzr.connectors import connector",
            "",
            `${snake(part.key)} = connector("${part.provider ?? "http"}")`,
            "",
            "",
            `def run(payload: dict) -> dict:`,
            `    return ${snake(part.key)}.call(payload)`,
            "",
          ].join("\n"),
        },
        check,
      ];
    case "agents":
      return [
        {
          path: `agents/${part.key}.py`,
          content: [
            "from lyzr import Agent",
            "",
            `${snake(part.key)} = Agent(`,
            `    name="${quote(part.title)}",`,
            `    instructions="""${about.join(" ")}""",`,
            '    model="gateway:default",',
            ")",
            "",
            "",
            `def run(message: str) -> str:`,
            `    return ${snake(part.key)}.run(message)`,
            "",
          ].join("\n"),
        },
        check,
      ];
    default:
      return [check];
  }
}

/** A new project's starting files on main (the default stack, B-8). */
export function scaffold(name: string): DevFile[] {
  return [
    { path: "README.md", content: `# ${name}\n\nBuilt with Architect. Stack: Next.js + Python (Lyzr SDK) + Postgres + sign-in.\n` },
    { path: "package.json", content: JSON.stringify({ name: slugOf(name), private: true, scripts: { dev: "next dev", build: "next build", test: "architect check" }, dependencies: { next: "16", react: "19" } }, null, 2) + "\n" },
    { path: "requirements.txt", content: "lyzr>=1.0\n" },
    { path: "app/layout.tsx", content: 'export default function Layout({ children }: { children: React.ReactNode }) {\n  return <html lang="en"><body>{children}</body></html>;\n}\n' },
  ];
}

/** plan.yaml: the plan's parts, as Architect keeps it in the repo. */
export function planYaml(version: number, parts: DevPart[]): DevFile {
  return { path: "plan.yaml", content: [`version: ${version}`, "parts:", ...parts.flatMap((p) => [`  - key: ${p.key}`, `    title: "${quote(p.title)}"`, `    check: "${quote(p.provedWhen)}"`])].join("\n") + "\n" };
}

function added(file: DevFile): ChangedFile {
  const lines = file.content.replace(/\n$/, "").split("\n");
  return { path: file.path, added: lines.length, removed: 0, lines: lines.map((text, i) => ({ kind: "add", oldNo: null, newNo: i + 1, text })) };
}

/**
 * Every file changed on Architect's branch compared with main, grouped by the part that changed it. Parts the build
 * hasn't reached have no changes. A part that needed fixes says so ("fix 2 of 3").
 */
export function changesByPart(input: { name: string; parts: DevPart[]; version: number; fixes: Record<string, number>; imported: boolean }): ChangeGroup[] {
  const groups: ChangeGroup[] = [];
  const written = [...input.parts].filter((p) => WRITTEN.has(p.status) && !p.untouched).sort((a, b) => a.position - b.position);
  for (const p of written) {
    const fixes = input.fixes[p.key] ?? 0;
    const label = p.rechecking ? "check running again" : p.status === "building" ? (fixes ? `fixing ${fixes} of 3` : "being built") : fixes ? `new · fixed ${fixes} of 3` : "new";
    groups.push({ key: p.key, title: p.title, label, files: partFiles(p).map(added) });
  }
  if (written.length) {
    const project: ChangedFile[] = [added(planYaml(input.version, input.parts.filter((p) => p.status !== "dropped")))];
    if (!input.imported) project.push(...scaffold(input.name).filter((f) => f.path !== "README.md").map(added));
    groups.push({ key: "project", title: "Project", label: input.imported ? "changed" : "new", files: project });
  }
  return groups;
}

/** Every file in a new project's tree: the starting files, plan.yaml, and each part's files once the build reached it. */
export function generatedTree(name: string, version: number, parts: DevPart[]): DevFile[] {
  const files = [...scaffold(name), planYaml(version, parts.filter((p) => p.status !== "dropped"))];
  for (const p of parts.filter((x) => WRITTEN.has(x.status))) files.push(...partFiles(p));
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export type TerminalLine = { kind: "cmd" | "ok" | "fail" | "info"; text: string };

/** A built event's assertions: the simulator writes [passed, total]; older events have one number (all passed). */
export function assertionCounts(raw: unknown): { passed: number; total: number } {
  if (Array.isArray(raw) && raw.length === 2) return { passed: Number(raw[0]) || 0, total: Number(raw[1]) || 0 };
  const n = Number(raw ?? 1);
  return Number.isFinite(n) && n > 0 ? { passed: n, total: n } : { passed: 1, total: 1 };
}

/** The terminal: the run's commands and results, replayed from its events up to now. */
export function terminalSession(input: { events: RunEvent[]; titles: Record<string, string>; branch: string; testCommand: string | null }): TerminalLine[] {
  const out: TerminalLine[] = [];
  const t = (k: string | null) => (k ? (input.titles[k] ?? k) : "");
  for (const e of input.events) {
    const p = e.payload;
    switch (e.type) {
      case "run.started":
        out.push({ kind: "cmd", text: `git switch -c ${input.branch}` }, { kind: "info", text: `${p.total_items ?? "?"} parts to build` });
        break;
      case "check.written":
        out.push({ kind: "cmd", text: `architect check --write "${t(e.itemKey)}"` }, { kind: "info", text: `wrote checks/${e.itemKey}.yaml · locked` });
        break;
      case "item.building":
        out.push({ kind: "cmd", text: `architect build "${t(e.itemKey)}"` });
        break;
      case "item.fixing":
        out.push({ kind: "cmd", text: `architect fix "${t(e.itemKey)}" --try ${p.attempt ?? 1}` });
        break;
      case "log.line":
        if (p.verb === "Edited" || p.verb === "Read") out.push({ kind: "info", text: `${String(p.verb).toLowerCase()} ${p.object}` });
        else if (p.verb === "Waiting") out.push({ kind: "info", text: `waiting for ${p.object}` });
        break;
      case "item.failed":
        out.push({ kind: "cmd", text: `${input.testCommand ?? "architect check"} "${t(e.itemKey)}"` }, { kind: "fail", text: `× ${p.reason ?? "check failed"}${p.measured ? ` (got ${p.measured})` : ""}` });
        break;
      case "item.built":
        out.push({ kind: "cmd", text: `${input.testCommand ?? "architect check"} "${t(e.itemKey)}"` }, { kind: "ok", text: `✓ ${assertionCounts(p.assertions).passed} of ${assertionCounts(p.assertions).total} assertions passed` });
        break;
      case "item.sample_data":
        out.push({ kind: "info", text: `${t(e.itemKey)}: works with sample data (no real source connected)` });
        break;
      case "item.paused":
        out.push({ kind: "fail", text: `${t(e.itemKey)} is blocked after 3 fixes` });
        break;
      case "run.paused_budget":
        out.push({ kind: "info", text: `paused at the budget: ${p.used ?? "?"} of ${p.budget ?? "?"} credits used` });
        break;
      case "run.done":
        out.push({ kind: "cmd", text: `git push origin ${input.branch}` }, { kind: "ok", text: `✓ ${p.proven ?? "?"} of ${p.total ?? "?"} parts work` });
        break;
    }
  }
  return out;
}

export type ActivityEntry = { id: string; atMs: number; who: string; kind: "checker" | "architect" | "coding_agent" | "github"; itemKey: string | null; lines: TerminalLine[] };

/**
 * Activity: the checker, the Architect agent, coding agents via MCP and GitHub commits, from the run's events.
 * The coding agent's runs and the commits are Simulated.
 */
export function activityFeed(input: { events: RunEvent[]; titles: Record<string, string>; codingAgent: string; branch: string }): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  const t = (k: string | null) => (k ? (input.titles[k] ?? k) : "");
  for (const e of input.events) {
    const p = e.payload;
    const id = String(e.id);
    if (e.type === "check.written") out.push({ id, atMs: e.atMs, who: "Checker", kind: "checker", itemKey: e.itemKey, lines: [{ kind: "info", text: `Wrote the check for ${t(e.itemKey)}: ${p.description ?? ""}` }] });
    else if (e.type === "item.failed") out.push({ id, atMs: e.atMs, who: "Checker", kind: "checker", itemKey: e.itemKey, lines: [{ kind: "fail", text: `Failed ${p.reason ?? "its check"}${p.measured ? ` (got ${p.measured})` : ""}` }] });
    else if (e.type === "item.building" || e.type === "item.fixing") {
      out.push({ id, atMs: e.atMs, who: e.actorLabel ?? (e.type === "item.fixing" ? `Architect agent · fix ${p.attempt ?? 1} of 3` : "Architect agent"), kind: "architect", itemKey: e.itemKey, lines: [{ kind: "info", text: e.type === "item.fixing" ? `Fixing ${t(e.itemKey)}` : `Building ${t(e.itemKey)}` }] });
    } else if (e.type === "log.line" && (p.verb === "Edited" || p.verb === "Read")) {
      const last = out[out.length - 1];
      const line: TerminalLine = { kind: "info", text: `${p.verb} ${p.object}` };
      if (last?.kind === "architect" && last.itemKey === e.itemKey) last.lines.push(line);
      else out.push({ id, atMs: e.atMs, who: e.actorLabel ?? "Architect agent", kind: "architect", itemKey: e.itemKey, lines: [line] });
    } else if (e.type === "item.built") {
      const a = assertionCounts(p.assertions);
      out.push({ id, atMs: e.atMs, who: "Checker", kind: "checker", itemKey: e.itemKey, lines: [{ kind: "ok", text: `Passed ${a.passed} of ${a.total}` }] });
      // A coding agent connected over MCP re-runs the part's tests (F4), and the part is committed to the branch.
      out.push({ id: `${id}-mcp`, atMs: e.atMs, who: `${input.codingAgent} · via MCP`, kind: "coding_agent", itemKey: e.itemKey, lines: [{ kind: "info", text: `run_tests("${t(e.itemKey)}")` }, { kind: "ok", text: `Passed ${a.passed} of ${a.total}` }] });
      out.push({ id: `${id}-git`, atMs: e.atMs, who: "GitHub", kind: "github", itemKey: e.itemKey, lines: [{ kind: "info", text: `${shortSha(`${e.id}${e.itemKey}`)} "Add ${t(e.itemKey)}" → ${input.branch}` }] });
    }
  }
  return out;
}

export type EnvKey = { name: string; why: string; test: boolean; team: boolean; live: boolean; service?: string | null };

const KEY_FOR: Record<string, { name: string; why: string }> = {
  slack: { name: "SLACK_BOT_TOKEN", why: "Slack" },
  gmail: { name: "GOOGLE_OAUTH_CLIENT_SECRET", why: "Gmail" },
  google_calendar: { name: "GOOGLE_OAUTH_CLIENT_SECRET", why: "Google Calendar" },
  hubspot: { name: "HUBSPOT_ACCESS_TOKEN", why: "HubSpot" },
  zendesk: { name: "ZENDESK_API_TOKEN", why: "Zendesk" },
  github: { name: "GITHUB_TOKEN", why: "GitHub" },
};

/**
 * Keys and passwords, by name only, per version (Test version, Team version, Live). Values are never shown.
 * A new project's keys come from its parts; an imported repo's from its .env.example.
 */
export function envKeys(input: {
  parts: DevPart[];
  repoKeys: { name: string; service: string | null; lyzrInstead: boolean }[] | null;
  connected: string[];
  envLive: { staging: boolean; production: boolean };
}): EnvKey[] {
  const keys = new Map<string, EnvKey>();
  const add = (name: string, why: string, ready: boolean, service: string | null = null) => {
    const prev = keys.get(name);
    if (prev) return;
    keys.set(name, { name, why, test: ready, team: ready && input.envLive.staging, live: ready && input.envLive.production, service });
  };
  if (input.repoKeys) {
    for (const k of input.repoKeys) add(k.name, k.lyzrInstead ? "Model key: Lyzr can provide it" : k.service ? `For ${providerName(k.service)}` : "From .env.example", k.lyzrInstead || (k.service !== null && input.connected.includes(k.service)), k.lyzrInstead ? null : k.service);
  }
  const active = input.parts.filter((p) => p.status !== "dropped" && p.status !== "deferred");
  for (const p of active) {
    // A service outside the list is called with an API key from its connection (BL-9): CLEARBIT_API_KEY.
    const k = p.provider ? (KEY_FOR[p.provider] ?? { name: apiKeyEnvName(p.provider), why: providerName(p.provider) }) : undefined;
    if (k) add(k.name, `For ${k.why}`, input.connected.includes(p.provider!), p.provider);
  }
  if (active.some((p) => p.grp === "agents")) add("LYZR_API_KEY", "For the app's agents", true);
  if (active.some((p) => p.grp === "data")) add("DATABASE_URL", "For the app's tables", true);
  return [...keys.values()];
}
