import "server-only";

import { lineDiff, type CodeEditView } from "@/lib/code-edits";
import type { ChangedFile } from "@/lib/dev-view";
import type { Json } from "@/lib/database.types";
import { prBranch, prTitle } from "@/lib/pull-requests";
import type { AdminDb } from "./db";

/* Code edits in Developer view, simulated. The edited file is kept as a project file (kind "generated", the part in
   used_by); the edit is a "code.edited" event the chat card, Changes, the part's re-run check and the PR read. A
   coding agent's edit through the MCP server would go through recordCodeEdit the same way (actor "coding_agent"). */

/** How long the part's check takes to run again after an edit (simulated). */
export const RECHECK_MS = 6000;

type EditPayload = {
  path: string;
  part_key: string;
  part_title: string;
  added: number;
  removed: number;
  before: string;
  prior_status: string;
  settle_at: string;
  settled: boolean;
  pr_number: number | null;
  by_kind: "person" | "coding_agent";
};

export async function recordCodeEdit(
  admin: AdminDb,
  input: { projectId: string; projectName: string; repo: string | null; version: number; blueprintId: string; part: { id: string; key: string; title: string; status: string }; path: string; before: string; content: string; actor: { userId: string | null; name: string; kind: "person" | "coding_agent" } },
): Promise<{ prNumber: number | null; rechecks: boolean }> {
  const { projectId, part, path } = input;
  const now = new Date();
  // The edited file: the latest content, and the part it belongs to.
  const { data: existing } = await admin.from("files").select("id").eq("project_id", projectId).eq("kind", "generated").eq("path", path).maybeSingle();
  const file = { project_id: projectId, kind: "generated", path, name: path, mime: "text/plain", extracted_text: input.content, used_by: [part.key], size_bytes: input.content.length };
  if (existing) await admin.from("files").update(file).eq("id", existing.id);
  else await admin.from("files").insert(file);

  // The diff is against the file before its first edit, so later edits show everything that changed.
  const { data: earlier } = await admin.from("events").select("payload").eq("project_id", projectId).eq("type", "code.edited");
  const first = (earlier ?? []).map((e) => e.payload as unknown as EditPayload).find((p) => p.path === path);
  const diff = lineDiff(path, first?.before ?? input.before, input.content);

  // Only a part that works has a check to run again; one not built yet gets its check when it's built.
  const rechecks = ["built", "sample_data", "needs_connection"].includes(part.status);
  if (rechecks) {
    await admin.from("items").update({ status: "building", status_detail: `Re-running its check · code edit by ${input.actor.name}` }).eq("id", part.id);
  }

  // A project from a repo: the edit goes on the open pull request, or a new one (nothing reaches main unmerged).
  let prNumber: number | null = null;
  if (input.repo) {
    const { data: prs } = await admin.from("pull_requests").select("id, number, status, parts").eq("project_id", projectId).order("number", { ascending: false });
    const open = (prs ?? []).find((p) => p.status === "open");
    if (open) {
      const parts = (open.parts ?? []) as { key: string; title: string }[];
      if (!parts.some((p) => p.key === part.key)) await admin.from("pull_requests").update({ parts: [...parts, { key: part.key, title: part.title }] as Json }).eq("id", open.id);
      prNumber = open.number;
    } else {
      prNumber = (prs?.[0]?.number ?? 11) + 1;
      await admin.from("pull_requests").insert({
        project_id: projectId,
        blueprint_id: input.blueprintId,
        number: prNumber,
        branch: `${prBranch(input.projectName, input.version)}-edit-${prNumber}`,
        title: `Code edit: ${prTitle("build", [{ title: part.title }]).replace(/^Build: /, "")}`,
        parts: [{ key: part.key, title: part.title }] as Json,
      });
    }
  }

  const payload: EditPayload = {
    path,
    part_key: part.key,
    part_title: part.title,
    added: diff.added,
    removed: diff.removed,
    before: first?.before ?? input.before,
    prior_status: part.status,
    settle_at: new Date(now.getTime() + RECHECK_MS).toISOString(),
    settled: !rechecks,
    pr_number: prNumber,
    by_kind: input.actor.kind,
  };
  await admin.from("events").insert({
    project_id: projectId,
    item_id: part.id,
    type: "code.edited",
    actor: input.actor.kind === "coding_agent" ? "coding_agent" : "user",
    actor_label: input.actor.name,
    payload: payload as unknown as Json,
  });
  return { prNumber, rechecks };
}

/**
 * Finishes the re-run checks whose time is up, after a code edit or an edited check (A-7): the part works again, with
 * a passing proof against its latest check (simulated).
 */
export async function settleCodeEdits(admin: AdminDb, projectId: string): Promise<void> {
  const { data } = await admin.from("events").select("id, item_id, type, payload").eq("project_id", projectId).in("type", ["code.edited", "check.edited"]);
  const due = (data ?? []).filter((e) => {
    const p = e.payload as unknown as EditPayload;
    return !p.settled && new Date(p.settle_at).getTime() <= Date.now();
  });
  for (const e of due) {
    const p = e.payload as unknown as EditPayload;
    if (e.item_id) {
      const { data: item } = await admin.from("items").select("status, status_detail").eq("id", e.item_id).maybeSingle();
      // Only if nothing else changed the part since (a build, a set-aside).
      if (item?.status === "building" && item.status_detail?.startsWith("Re-running its check")) {
        await admin.from("items").update({ status: p.prior_status, status_detail: null }).eq("id", e.item_id);
        const { data: check } = await admin.from("checks").select("id").eq("item_id", e.item_id).order("written_at", { ascending: false }).limit(1).maybeSingle();
        const converted = Boolean((p as unknown as { converted?: boolean }).converted);
        const summary = converted ? "Passed its check as a Lyzr Studio agent" : e.type === "check.edited" ? "Passed the edited check against the code already built" : `Passed again after a code edit to ${p.path}`;
        const log = converted ? "Converted to Lyzr Studio" : e.type === "check.edited" ? "Edited check" : "After a code edit";
        if (check) await admin.from("proofs").insert({ item_id: e.item_id, check_id: check.id, attempt: 0, result: "pass", assertions_passed: 3, assertions_total: 3, summary, log });
      }
    }
    await admin.from("events").update({ payload: { ...p, settled: true } as unknown as Json }).eq("id", e.id);
  }
}

/** A project's code edits for its pages: the cards, and each edited file's diff for Changes and its content. */
export async function loadCodeEdits(admin: AdminDb, projectId: string): Promise<{ edits: CodeEditView[]; files: { path: string; partKey: string; partTitle: string; content: string; diff: ChangedFile }[] }> {
  const [{ data: events }, { data: files }] = await Promise.all([
    admin.from("events").select("id, actor_label, created_at, payload").eq("project_id", projectId).eq("type", "code.edited").order("created_at"),
    admin.from("files").select("path, extracted_text, used_by").eq("project_id", projectId).eq("kind", "generated"),
  ]);
  const rows = (events ?? []).map((e) => ({ e, p: e.payload as unknown as EditPayload }));
  const edits: CodeEditView[] = rows.map(({ e, p }) => ({
    id: e.id,
    path: p.path,
    partKey: p.part_key,
    partTitle: p.part_title,
    by: e.actor_label ?? "Someone",
    byKind: p.by_kind,
    at: e.created_at,
    added: p.added,
    removed: p.removed,
    check: p.settled ? "passed" : "running",
    prNumber: p.pr_number,
  }));
  const edited = (files ?? []).map((f) => {
    const firstEdit = rows.find(({ p }) => p.path === f.path)?.p;
    const last = [...rows].reverse().find(({ p }) => p.path === f.path)?.p;
    const content = f.extracted_text ?? "";
    return { path: f.path, partKey: last?.part_key ?? f.used_by[0] ?? "", partTitle: last?.part_title ?? "", content, diff: lineDiff(f.path, firstEdit?.before ?? "", content) };
  });
  return { edits, files: edited.filter((f) => f.partKey) };
}
