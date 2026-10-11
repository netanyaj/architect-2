import { slugOf, terminalSession, type TerminalLine } from "./dev-view";
import { hash } from "./brand";

/*
 * The Developer panel (M5.10, doc 26 step 6): Terminal, Console, Build logs and Live logs. Simulated from the plan,
 * its run and its deploys; pure, so the server and the browser draw the same thing.
 */

type RunEvent = Parameters<typeof terminalSession>[0]["events"][number];

export type PanelPart = { key: string; title: string; status: string; statusDetail: string | null; provider: string | null; grp: string };

/** `~/expense-checker (main) $` */
export function promptLine(projectName: string, branch: string): string {
  return `~/${slugOf(projectName)} (${branch}) $`;
}

export const WELCOME = "Architect terminal. Commands read this project's files and re-run its checks; nothing runs in a shell. Type help for the list.";

export type ConsoleLevel = "error" | "warn" | "log";
export type ConsoleEntry = { id: string; level: ConsoleLevel; text: string; source: string; partKey: string | null };

const INACTIVE = new Set(["dropped", "deferred"]);

/**
 * What the preview's console shows: an error for each part whose check is failing or blocked, a warning for each
 * part on sample data or waiting for an app, and a log line for each part that works. Newest problems first.
 */
export function consoleEntries(parts: PanelPart[]): ConsoleEntry[] {
  const shown = parts.filter((p) => !INACTIVE.has(p.status));
  const file = (p: PanelPart) => `${p.grp === "integrations" ? "connections" : p.grp === "agents" ? "agents" : "app"}/${slugOf(p.title)}.ts`;
  const errors = shown
    .filter((p) => p.status === "failed" || p.status === "paused")
    .map((p) => ({ id: `e-${p.key}`, level: "error" as const, text: `${p.title}: ${p.statusDetail ?? "its check failed"}`, source: file(p), partKey: p.key }));
  const warnings = shown
    .filter((p) => p.status === "sample_data" || p.status === "needs_connection" || p.status === "needs_approval")
    .map((p) => ({
      id: `w-${p.key}`,
      level: "warn" as const,
      text: p.status === "needs_approval" ? `${p.title}: waiting for IT to approve ${p.provider ?? "an app"}` : `${p.title}: using sample data until ${p.provider ?? "its app"} is connected`,
      source: file(p),
      partKey: p.key,
    }));
  const logs = shown
    .filter((p) => p.status === "built")
    .map((p) => ({ id: `l-${p.key}`, level: "log" as const, text: `${p.title} ready`, source: file(p), partKey: p.key }));
  return [...errors, ...warnings, ...logs];
}

export function consoleCounts(entries: ConsoleEntry[]): Record<ConsoleLevel | "all", number> {
  return {
    all: entries.length,
    error: entries.filter((e) => e.level === "error").length,
    warn: entries.filter((e) => e.level === "warn").length,
    log: entries.filter((e) => e.level === "log").length,
  };
}

/** The change a "Fix with AI" sends to chat: chat turns it into a change card, and nothing changes until Apply. */
export function fixRequest(entry: ConsoleEntry): string {
  return `Fix this error from the preview's console: ${entry.text} (in ${entry.source}).`;
}

export type BuildLog = { key: string; title: string; status: string; lines: TerminalLine[] };

/** Build logs: the run's lines grouped by part, in build order, from the simulator's events. */
export function buildLogs(input: { events: RunEvent[]; titles: Record<string, string>; parts: PanelPart[] }): BuildLog[] {
  const order: string[] = [];
  for (const e of input.events) if (e.itemKey && !order.includes(e.itemKey)) order.push(e.itemKey);
  return order.map((key) => ({
    key,
    title: input.titles[key] ?? key,
    status: input.parts.find((p) => p.key === key)?.status ?? "agreed",
    lines: terminalSession({ events: input.events.filter((e) => e.itemKey === key), titles: input.titles, branch: "", testCommand: null }),
  }));
}

export type LiveEnv = "test" | "team" | "live";
export const LIVE_ENV_LABEL: Record<LiveEnv, string> = { test: "Test version", team: "Team version", live: "Live" };
export type LiveLine = { at: string; level: "info" | "warn" | "error"; text: string };

/**
 * Runtime logs for one environment: requests to the app's screens and runs of its agents and connections, made up
 * deterministically from the project and its parts (the same project always shows the same lines).
 */
export function liveLogs(input: { projectId: string; env: LiveEnv; deployed: boolean; parts: PanelPart[]; now: Date }): LiveLine[] {
  if (!input.deployed) return [];
  const works = input.parts.filter((p) => p.status === "built" || p.status === "sample_data");
  if (!works.length) return [];
  const lines: LiveLine[] = [];
  const count = input.env === "live" ? 14 : input.env === "team" ? 9 : 6;
  // Gaps of 20–80 s between lines, oldest first, ending just before now.
  const gaps = Array.from({ length: count }, (_, i) => 20_000 + (hash(`${input.projectId}:${input.env}:${i}:gap`) % 60_000));
  let at = input.now.getTime() - gaps.reduce((a, b) => a + b, 0);
  for (let i = 0; i < count; i++) {
    at += gaps[i];
    const p = works[hash(`${input.projectId}:${input.env}:${i}`) % works.length];
    const h = hash(`${input.projectId}:${input.env}:${i}:ms`);
    const ms = 20 + (h % 380);
    const when = new Date(at).toISOString();
    if (p.grp === "agents") lines.push({ at: when, level: "info", text: `agent ${slugOf(p.title)} ran · ${(ms * 9) / 1000}s · ok` });
    else if (p.grp === "integrations")
      lines.push(
        p.status === "sample_data"
          ? { at: when, level: "warn", text: `${p.provider ?? "connection"}: not connected, served sample data` }
          : { at: when, level: "info", text: `${p.provider ?? "connection"} · ${slugOf(p.title)} · 200 · ${ms}ms` },
      );
    else lines.push({ at: when, level: "info", text: `GET /${slugOf(p.title)} 200 ${ms}ms` });
  }
  return lines;
}
