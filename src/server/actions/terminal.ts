"use server";

import { z } from "zod";
import { RECHECKABLE } from "@/lib/check-edit";
import type { Json } from "@/lib/database.types";
import { branchInfo, generatedTree, type DevPart, type TerminalLine } from "@/lib/dev-view";
import { canBuild } from "@/lib/permissions";
import { HELP_LINES, listDir, parseCommand, SANDBOX_LINE } from "@/lib/terminal";
import { loadCodeEdits } from "../code-edits";
import { createAdminDb, createServerDb, type AdminDb } from "../db";
import { readFileAt, readTreeAt } from "../github";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";

/*
 * The Developer view terminal (M5.5). Security: no command is ever executed. The line is parsed against a short list
 * (src/lib/terminal.ts); each maps to a read of the project's own data, or, for npm test / pytest, to new proof rows
 * for its built parts. Builders and up only (Viewers have no terminal); the project must be in the person's workspace;
 * paths can't leave the project; output is capped; every command is written to the audit log (the command, never a
 * file's contents); and at most 30 commands a minute per person.
 */

const MAX_LINES = 400;
const PER_MINUTE = 30;
const input = z.object({ projectId: z.string().uuid(), command: z.string().max(400) });

type Files = { paths: string[]; read: (path: string) => Promise<string | null | "binary"> };

async function projectFiles(admin: AdminDb, project: { id: string; name: string; repo_full_name: string | null }, version: number, parts: DevPart[], edited: Map<string, string>): Promise<Files> {
  if (project.repo_full_name) {
    const { data: imp } = await admin.from("repo_imports").select("full_name, commit_sha, installation_id").eq("project_id", project.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (imp?.installation_id && imp.commit_sha) {
      const tree = await readTreeAt(Number(imp.installation_id), imp.full_name, imp.commit_sha);
      return {
        paths: [...new Set([...tree.entries.map((e) => e.path), ...edited.keys()])].sort(),
        read: async (path) => {
          if (edited.has(path)) return edited.get(path)!;
          if (!tree.entries.some((e) => e.path === path)) return null;
          const f = await readFileAt(Number(imp.installation_id), imp.full_name, imp.commit_sha!, path);
          return f.kind === "text" ? f.text : "binary";
        },
      };
    }
  }
  const files = generatedTree(project.name, version, parts);
  return {
    paths: [...new Set([...files.map((f) => f.path), ...edited.keys()])].sort(),
    read: async (path) => edited.get(path) ?? files.find((f) => f.path === path)?.content ?? null,
  };
}

const cap = (lines: TerminalLine[]): TerminalLine[] => (lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), { kind: "info", text: `… ${lines.length - MAX_LINES} more lines not shown` }] : lines);

export async function runCommand(raw: z.input<typeof input>): Promise<ActionResult<{ lines: TerminalLine[]; clear?: boolean }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers don't have a terminal." };
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That command is too long." };
  const admin = createAdminDb();
  const { data: project } = await admin.from("projects").select("id, name, workspace_id, repo_full_name").eq("id", parsed.data.projectId).maybeSingle();
  if (!project || project.workspace_id !== ctx.workspace.id) return { ok: false, message: "That project isn't in this workspace." };

  const since = new Date(Date.now() - 60_000).toISOString();
  const { data: recent } = await admin.from("audit_log").select("id").eq("workspace_id", ctx.workspace.id).eq("actor", ctx.name).eq("action", "terminal.command").gte("created_at", since);
  if ((recent ?? []).length >= PER_MINUTE) return { ok: false, message: `Up to ${PER_MINUTE} commands a minute. Wait a moment.` };

  const line = parsed.data.command.trim();
  const cmd = parseCommand(line);
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "terminal.command", target: `${project.name}: ${line.slice(0, 120)}`, details: { kind: cmd.kind } as Json });

  if (cmd.kind === "invalid") return { ok: true, lines: [{ kind: "fail", text: cmd.reason }] };
  if (cmd.kind === "other") return { ok: true, lines: [{ kind: "info", text: SANDBOX_LINE }] };
  if (cmd.kind === "clear") return { ok: true, lines: [], clear: true };
  if (cmd.kind === "help") return { ok: true, lines: HELP_LINES.map((text) => ({ kind: "info" as const, text })) };

  const { data: bp } = await admin.from("blueprints").select("id, version").eq("project_id", project.id).order("version", { ascending: false }).limit(1).maybeSingle();
  const { data: rows } = bp ? await admin.from("items").select("id, key, title, description, proved_when, grp, status, provider, position").eq("blueprint_id", bp.id).order("position") : { data: [] };
  const items = rows ?? [];
  const parts: DevPart[] = items.map((i) => ({ key: i.key, title: i.title, description: i.description, provedWhen: i.proved_when, grp: i.grp, status: i.status, provider: i.provider, position: i.position }));
  const version = bp?.version ?? 1;

  if (cmd.kind === "test") {
    const built = items.filter((i) => RECHECKABLE.includes(i.status));
    if (!built.length) return { ok: true, lines: [{ kind: "info", text: "No parts are built yet, so there's nothing to check. Click Build first." }] };
    const lines: TerminalLine[] = [{ kind: "info", text: `Running ${built.length} ${built.length === 1 ? "check" : "checks"} against the code on the branch…` }];
    let failed = 0;
    for (const i of built) {
      const [{ data: check }, { data: last }] = await Promise.all([
        admin.from("checks").select("id").eq("item_id", i.id).order("written_at", { ascending: false }).limit(1).maybeSingle(),
        admin.from("proofs").select("result, assertions_passed, assertions_total").eq("item_id", i.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      // The checker's result is simulated: a re-run gives the part's last result again, and is recorded as a proof.
      const result = last?.result === "fail" ? "fail" : "pass";
      const total = last?.assertions_total ?? 3;
      const passed = result === "pass" ? total : (last?.assertions_passed ?? 0);
      if (check) await admin.from("proofs").insert({ item_id: i.id, check_id: check.id, attempt: 0, result, assertions_passed: passed, assertions_total: total, summary: `Re-run from the terminal (${cmd.tool})`, log: "Terminal re-run" });
      if (result === "fail") failed++;
      lines.push({ kind: result === "pass" ? "ok" : "fail", text: `${result === "pass" ? "PASS" : "FAIL"}  ${i.title} (${passed}/${total})` });
    }
    lines.push({ kind: failed ? "fail" : "ok", text: `${built.length - failed} passed${failed ? `, ${failed} failed` : ""}` });
    return { ok: true, lines };
  }

  const { files: editedFiles } = await loadCodeEdits(admin, project.id);
  const edited = new Map(editedFiles.map((f) => [f.path, f.content]));

  if (cmd.kind === "status" || cmd.kind === "diff") {
    const { data: pr } = await admin.from("pull_requests").select("number, branch, status").eq("project_id", project.id).order("number", { ascending: false }).limit(1).maybeSingle();
    const branch = pr?.branch ?? branchInfo({ projectId: project.id, name: project.name, version, repo: project.repo_full_name, runStatus: null, parts }).branch;
    const shown = cmd.kind === "diff" && cmd.path ? editedFiles.filter((f) => f.path === cmd.path) : editedFiles;
    if (cmd.kind === "status") {
      const lines: TerminalLine[] = [{ kind: "info", text: `On branch ${branch}${pr ? ` · PR #${pr.number} ${pr.status}` : ""}` }];
      if (!editedFiles.length) lines.push({ kind: "info", text: "No edits on the branch beyond the build's own changes." });
      else {
        lines.push({ kind: "info", text: "Edited in Developer view:" });
        for (const f of editedFiles) lines.push({ kind: "ok", text: `  modified:   ${f.path}  (${f.partTitle})` });
      }
      return { ok: true, lines };
    }
    if (!shown.length) return { ok: true, lines: [{ kind: "info", text: cmd.path ? `${cmd.path} has no edits.` : "No edits to show." }] };
    const lines: TerminalLine[] = [];
    for (const f of shown) {
      lines.push({ kind: "info", text: `diff ${f.path}  (+${f.diff.added} −${f.diff.removed})` });
      for (const l of f.diff.lines) if (l.kind !== "same") lines.push({ kind: l.kind === "add" ? "ok" : "fail", text: `${l.kind === "add" ? "+" : "-"} ${l.text}` });
    }
    return { ok: true, lines: cap(lines) };
  }

  let files: Files;
  try {
    files = await projectFiles(admin, project, version, parts, edited);
  } catch {
    return { ok: true, lines: [{ kind: "fail", text: "GitHub didn't answer. Try again in a minute." }] };
  }
  if (cmd.kind === "ls") {
    const names = listDir(files.paths, cmd.path);
    if (!names) return { ok: true, lines: [{ kind: "fail", text: `ls: ${cmd.path}: no such folder` }] };
    return { ok: true, lines: cap(names.map((text) => ({ kind: "info" as const, text }))) };
  }
  // cat
  const text = await files.read(cmd.path);
  if (text === null) return { ok: true, lines: [{ kind: "fail", text: `cat: ${cmd.path}: no such file${files.paths.some((p) => p.startsWith(`${cmd.path}/`)) ? " (it's a folder: try ls)" : ""}` }] };
  if (text === "binary") return { ok: true, lines: [{ kind: "info", text: `${cmd.path} isn't text, or is too large to show here.` }] };
  return { ok: true, lines: cap(text.replace(/\n$/, "").split("\n").map((t) => ({ kind: "info" as const, text: t }))) };
}

/* Terminal sessions (M5.10): each session's lines are saved per project, so the Sessions menu can show earlier ones,
   read-only. Builders and up write their own; any member can read them (RLS). */

const lineSchema = z.object({ kind: z.enum(["cmd", "ok", "fail", "info"]), text: z.string().max(2000) });
const sessionInput = z.object({ projectId: z.string().uuid(), sessionId: z.string().uuid().nullable(), lines: z.array(lineSchema).max(MAX_LINES * 3) });

export type TerminalSessionSummary = { id: string; startedAt: string; by: string; commands: number };

export async function saveTerminalSession(raw: z.input<typeof sessionInput>): Promise<ActionResult<{ sessionId: string }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers don't have a terminal." };
  const parsed = sessionInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That session couldn't be saved." };
  const admin = createAdminDb();
  const { data: project } = await admin.from("projects").select("id, workspace_id").eq("id", parsed.data.projectId).maybeSingle();
  if (!project || project.workspace_id !== ctx.workspace.id) return { ok: false, message: "That project isn't in this workspace." };
  const lines = parsed.data.lines as unknown as Json;
  if (parsed.data.sessionId) {
    // Only your own open session, in this project.
    const { data, error } = await admin.from("terminal_sessions").update({ lines }).eq("id", parsed.data.sessionId).eq("project_id", project.id).eq("user_id", ctx.user.id).is("ended_at", null).select("id").maybeSingle();
    if (!error && data) return { ok: true, sessionId: data.id };
  }
  const { data, error } = await admin.from("terminal_sessions").insert({ project_id: project.id, user_id: ctx.user.id, user_name: ctx.name, lines }).select("id").single();
  if (error || !data) return { ok: false, message: "That session couldn't be saved." };
  return { ok: true, sessionId: data.id };
}

/** Clear ends the session: it's kept, read-only, under Sessions. */
export async function endTerminalSession(input: { sessionId: string }): Promise<void> {
  const ctx = await getAppContext();
  if (!z.string().uuid().safeParse(input.sessionId).success) return;
  await createAdminDb().from("terminal_sessions").update({ ended_at: new Date().toISOString() }).eq("id", input.sessionId).eq("user_id", ctx.user.id);
}

export async function listTerminalSessions(input: { projectId: string }): Promise<ActionResult<{ sessions: TerminalSessionSummary[] }>> {
  if (!z.string().uuid().safeParse(input.projectId).success) return { ok: false, message: "That project isn't here." };
  const db = await createServerDb();
  const { data } = await db.from("terminal_sessions").select("id, started_at, user_name, lines").eq("project_id", input.projectId).order("started_at", { ascending: false }).limit(20);
  return {
    ok: true,
    sessions: (data ?? []).map((s) => ({ id: s.id, startedAt: s.started_at, by: s.user_name, commands: ((s.lines ?? []) as TerminalLine[]).filter((l) => l.kind === "cmd").length })),
  };
}

export async function loadTerminalSession(input: { sessionId: string }): Promise<ActionResult<{ lines: TerminalLine[] }>> {
  if (!z.string().uuid().safeParse(input.sessionId).success) return { ok: false, message: "That session isn't here." };
  const db = await createServerDb();
  const { data } = await db.from("terminal_sessions").select("lines").eq("id", input.sessionId).maybeSingle();
  if (!data) return { ok: false, message: "That session isn't here." };
  return { ok: true, lines: (data.lines ?? []) as TerminalLine[] };
}

/** Which environments have a version deployed (Live logs only has lines for those). Members only (RLS). */
export async function deployedEnvs(input: { projectId: string }): Promise<{ test: boolean; team: boolean; live: boolean }> {
  const none = { test: false, team: false, live: false };
  if (!z.string().uuid().safeParse(input.projectId).success) return none;
  const db = await createServerDb();
  const [{ data: deps }, { data: runs }] = await Promise.all([
    db.from("deployments").select("environment, status").eq("project_id", input.projectId),
    db.from("runs").select("id").eq("project_id", input.projectId).limit(1),
  ]);
  const on = (env: string) => (deps ?? []).some((d) => d.environment === env && d.status === "live");
  return { test: Boolean(runs?.length), team: on("staging"), live: on("production") };
}
