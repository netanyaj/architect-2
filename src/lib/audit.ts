/**
 * The audit log (C-6) in plain words: what happened, who did it (a person, Architect's own agent, or a person's coding
 * agent), which project, filters and CSV. Every run, change, approval and policy change writes a row. No I/O.
 */
import { toCsv } from "./app-data";

export type AuditRow = { id: number; created_at: string; actor: string; action: string; target: string | null; details: Record<string, unknown> };
export type AuditBy = "person" | "architect" | "coding_agent";
export type AuditEntry = { id: number; at: string; actor: string; by: AuditBy; action: string; what: string; target: string; project: string | null; details: string };

const WHAT: Record<string, string> = {
  "approval.approved": "Approved a request",
  "approval.rejected": "Rejected a request",
  "rule.created": "Made an allow-rule",
  "rule.removed": "Removed an allow-rule",
  "policy.changed": "Changed a policy",
  "governance.on": "Turned governance on",
  "governance.off": "Turned governance off",
  "deploy.live": "Went live",
  "deploy.team": "Shared with the team",
  "deploy.failed": "A deploy failed",
  "deploy.offline": "Took Live offline",
  "key.set": "Set a key",
  "key.requested": "Asked to set a key for Live",
  "token.created": "Made a coding-agent token",
  "token.approved": "Approved a coding-agent token",
  "token.revoked": "Revoked a coding-agent token",
  "pr.merged": "Merged a pull request",
  "connection.connected": "Connected an app",
  "run.settled": "Finished a build run",
  "repo.imported": "Imported a repo",
  "agent.saved": "Saved an agent's settings",
  "budget.raise_requested": "Asked to raise the monthly cap",
  "part.set_aside": "Set a part aside",
  "part.retried": "Tried a part once more",
  "project.deleted": "Deleted a project",
  "project.duplicated": "Duplicated a project",
  "project.ownership_offered": "Offered a project to someone",
  "project.ownership_accepted": "Took over a project",
  "member.invited": "Invited someone",
  "member.joined": "Joined the workspace",
  "member.removed": "Removed someone",
  "member.role_changed": "Changed someone's role",
  "workspace.seeded": "Demo data was set up",
};

export function auditWhat(action: string): string {
  return WHAT[action] ?? action.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Architect's own agent writes as "system"; a coding agent's actions come through the MCP server (`via: "mcp"`). */
export function auditBy(row: Pick<AuditRow, "actor" | "action" | "details">): AuditBy {
  if (row.actor === "system") return "architect";
  if (row.details?.via === "mcp" || row.action.startsWith("coding_agent.")) return "coding_agent";
  return "person";
}

/** The project a row is about: its target names it ("ticket-triage", "ticket-triage: PR #12") or its details do. */
export function auditProject(row: Pick<AuditRow, "target" | "details">, projects: string[]): string | null {
  const t = row.target ?? "";
  const named = typeof row.details?.project === "string" ? row.details.project : null;
  return projects.find((p) => named === p || t === p || t.startsWith(`${p}:`) || t.startsWith(`${p} `)) ?? null;
}

function detailsText(d: Record<string, unknown>): string {
  return Object.entries(d)
    .filter(([k, v]) => k !== "simulated" && v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

export function auditEntries(rows: AuditRow[], projects: string[]): AuditEntry[] {
  return rows.map((r) => ({
    id: r.id,
    at: r.created_at,
    actor: r.actor === "system" ? "Architect" : r.actor,
    by: auditBy(r),
    action: r.action,
    what: auditWhat(r.action),
    target: r.target ?? "",
    project: auditProject(r, projects),
    details: detailsText(r.details ?? {}),
  }));
}

export type AuditFilter = { project?: string; person?: string; by?: AuditBy | "all"; query?: string };

export function filterAudit(entries: AuditEntry[], f: AuditFilter): AuditEntry[] {
  const words = (f.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter(
    (e) =>
      (!f.project || e.project === f.project) &&
      (!f.person || e.actor === f.person) &&
      (!f.by || f.by === "all" || e.by === f.by) &&
      words.every((w) => `${e.what} ${e.action} ${e.target} ${e.details} ${e.actor}`.toLowerCase().includes(w)),
  );
}

const BY_LABEL: Record<AuditBy, string> = { person: "Person", architect: "Architect", coding_agent: "Coding agent" };

export function auditCsv(entries: AuditEntry[]): string {
  return toCsv(
    [
      { key: "at", label: "When (UTC)" },
      { key: "actor", label: "Who" },
      { key: "by", label: "Kind" },
      { key: "what", label: "What" },
      { key: "action", label: "Action" },
      { key: "target", label: "On" },
      { key: "project", label: "Project" },
      { key: "details", label: "Details" },
    ],
    entries.map((e) => ({ at: e.at, actor: e.actor, by: BY_LABEL[e.by], what: e.what, action: e.action, target: e.target, project: e.project ?? "", details: e.details })),
  );
}

export { BY_LABEL };
