/**
 * Editing files in Developer view, simulated: an edit belongs to one part of the plan, which gets its check run again
 * (the same rule as Architect's agent and people's coding agents: nothing works until its check passes). On a project
 * from a repo, the edit goes on the pull request. Shared by client and server; no I/O.
 */
import type { ChangedFile, ChangeGroup, DiffLine } from "./dev-view";

export type CodeEditView = {
  id: number;
  path: string;
  partKey: string;
  partTitle: string;
  by: string;
  byKind: "person" | "coding_agent";
  at: string;
  added: number;
  removed: number;
  /** The part's check after the edit: running again, or passed. */
  check: "running" | "passed";
  prNumber: number | null;
};

/** The edit card's line: "Code edit to src/brief.ts · re-runs the check for Brief writer". */
export function editLine(e: Pick<CodeEditView, "path" | "partTitle" | "check">): string {
  return `Code edit to ${e.path} · ${e.check === "running" ? "re-runs" : "re-ran"} the check for ${e.partTitle}`;
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);

/**
 * The part an edited file most likely belongs to: the part whose changes include it, else the part sharing the most
 * words with the path ("src/agents/brief_writer.py" → Brief writer), else the first part.
 */
export function suggestPart(path: string, groups: ChangeGroup[], parts: { key: string; title: string }[]): string | null {
  const owner = groups.find((g) => g.files.some((f) => f.path === path) && parts.some((p) => p.key === g.key));
  if (owner) return owner.key;
  const pathWords = new Set(words(path));
  let best: { key: string; score: number } | null = null;
  for (const p of parts) {
    const score = words(`${p.title} ${p.key}`).filter((w) => pathWords.has(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { key: p.key, score };
  }
  return best?.key ?? parts[0]?.key ?? null;
}

/** A line diff: the lines both share at the start and end stay; what's between is removed and added. */
export function lineDiff(path: string, before: string, after: string): ChangedFile {
  const a = before.replace(/\n$/, "").split("\n");
  const b = after.replace(/\n$/, "").split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const lines: DiffLine[] = [];
  for (let i = 0; i < start; i++) lines.push({ kind: "same", oldNo: i + 1, newNo: i + 1, text: a[i] });
  for (let i = start; i < a.length - end; i++) lines.push({ kind: "del", oldNo: i + 1, newNo: null, text: a[i] });
  for (let i = start; i < b.length - end; i++) lines.push({ kind: "add", oldNo: null, newNo: i + 1, text: b[i] });
  for (let i = 0; i < end; i++) lines.push({ kind: "same", oldNo: a.length - end + i + 1, newNo: b.length - end + i + 1, text: a[a.length - end + i] });
  return { path, added: b.length - end - start, removed: a.length - end - start, lines };
}

/** Why an edit can't be saved, or null. */
export function editProblem(path: string, content: string, before: string): string | null {
  if (!path || path.length > 300 || path.includes("..") || path.startsWith("/")) return "That file can't be edited.";
  if (content.length > 200_000 || before.length > 200_000) return "Files over 200 KB can't be edited here.";
  if (content === before) return "Nothing changed in the file yet.";
  return null;
}

/** Changes (Developer view) with the saved edits laid over: an edited file shows its edit under its part. */
export function withEdits(groups: ChangeGroup[], edits: { path: string; partKey: string; partTitle: string; diff: ChangedFile }[]): ChangeGroup[] {
  const out = groups.map((g) => ({ ...g, files: g.files.filter((f) => !edits.some((e) => e.path === f.path)) }));
  for (const e of edits) {
    let g = out.find((x) => x.key === e.partKey);
    if (!g) {
      g = { key: e.partKey, title: e.partTitle, label: "edited", files: [] };
      out.push(g);
    } else if (!g.label.includes("edited")) {
      g.label = `${g.label} · edited`;
    }
    g.files.push(e.diff);
  }
  return out.filter((g) => g.files.length);
}
