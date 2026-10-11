"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ax/button";
import { Icon } from "@/components/ax/icon";
import { SimTag } from "@/components/ax/pill";
import { Segmented } from "@/components/ax/segmented";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { suggestPart, withEdits } from "@/lib/code-edits";
import {
  activityFeed,
  branchInfo,
  changesByPart,
  envKeys,
  generatedTree,
  slugOf,
  terminalSession,
  type ChangedFile,
  type DevPart,
  type TerminalLine,
} from "@/lib/dev-view";
import { canBuild } from "@/lib/permissions";
import { zipFiles } from "@/lib/zip";
import type { LiveRun } from "@/lib/sim/replay";
import { useUi } from "@/lib/ui-store";
import { cn } from "@/lib/utils";
import { loadRepoFile, loadRepoView, saveCodeEdit, type RepoView } from "@/server/actions/dev";
import { openPullRequestNow } from "@/server/actions/pull-requests";
import { runCommand } from "@/server/actions/terminal";
import type { ProjectWorkspace, WorkspaceItem } from "@/server/project";

/* Developer view (screen 8). Simulated from the plan and its run, except an imported repo's files, which are real. */

const ENV_PATH = "Environment/Keys and passwords";

const toParts = (items: WorkspaceItem[]): DevPart[] =>
  items.map((i) => ({
    key: i.key,
    title: i.title,
    description: i.description,
    provedWhen: i.provedWhen,
    grp: i.grp,
    status: i.status,
    provider: i.provider,
    position: i.position,
    untouched: Boolean(i.statusDetail?.startsWith("Works today")),
    rechecking: Boolean(i.statusDetail?.startsWith("Re-running its check")),
  }));

/** Events the run has played so far: a running build replays on the clock; a finished one shows them all. */
function playedEvents(project: ProjectWorkspace, live: LiveRun) {
  const run = project.run;
  if (!run) return [];
  if (run.status !== "running") return run.events;
  const ids = new Set(live.activity.map((a) => a.id));
  const last = Math.max(-1, ...run.events.filter((e) => ids.has(e.id)).map((e) => e.atMs));
  return run.events.filter((e) => e.atMs <= Math.max(last, 0));
}

function fixesOf(project: ProjectWorkspace): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of project.run?.events ?? []) if (e.type === "item.fixing" && e.itemKey) out[e.itemKey] = Math.max(out[e.itemKey] ?? 0, Number(e.payload.attempt ?? 1));
  return out;
}

/** The branch and its pull request, in the stage header (Simulated). */
export function PrStatus({ project, items }: { project: ProjectWorkspace; items: WorkspaceItem[] }) {
  const derived = branchInfo({ projectId: project.id, name: project.name, version: project.plan?.version ?? 1, repo: project.repo, runStatus: project.run?.status ?? null, parts: toParts(items) });
  // A repo project's own pull request, when there is one (B-4).
  const pr = project.pullRequests[0];
  const info = pr ? { branch: pr.branch, base: pr.base, pr: pr.number, status: pr.status === "merged" ? ("merged" as const) : pr.checks } : derived;
  const words =
    info.pr === null
      ? "No pull request yet"
      : `PR #${info.pr} · ${info.status === "merged" ? "merged" : info.status === "running" ? "checks running" : info.status === "failing" ? "checks failing" : "checks passing"}`;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span
        className="inline-flex min-h-[34px] items-center gap-2 rounded-full border border-line-ctl bg-surface px-3 text-small font-semibold"
        title={`Architect works on ${info.branch} and opens a pull request into ${info.base}${project.repo ? ` on ${project.repo}` : ""}.`}
      >
        <Icon name="branch" size="sm" />
        <code className="font-mono font-normal">{info.branch}</code>
        <span className="text-ink-3">→ {info.base}</span>
        <span aria-hidden="true">·</span>
        <span className={cn(info.status === "failing" && "text-failed", info.status === "running" && "text-building")}>{words}</span>
      </span>
      {project.repo && canBuild(project.role) && <OpenPrButton project={project} openPr={pr?.status === "open" ? pr.number : null} />}
      <SimTag title="Branches and pull requests are simulated in this prototype." />
    </span>
  );
}

/** Open PR (Simulated): one open pull request at a time, from the branch into main. */
function OpenPrButton({ project, openPr }: { project: ProjectWorkspace; openPr: number | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <>
      <Button
        size="sm"
        disabledReason={openPr ? `PR #${openPr} is already open.` : pending ? "Opening…" : undefined}
        onClick={() =>
          start(async () => {
            setError(undefined);
            const r = await openPullRequestNow({ projectId: project.id });
            if (!r.ok) return setError(r.message);
            router.refresh();
          })
        }
      >
        Open PR
      </Button>
      {error && (
        <span role="alert" className="text-small font-semibold text-failed">
          {error}
        </span>
      )}
    </>
  );
}

function CodeLines({ text }: { text: string }) {
  const lines = text.replace(/\n$/, "").split("\n");
  return (
    <pre className="m-0 flex-1 overflow-auto py-3 font-mono text-[12.5px] leading-[1.75]" aria-label="File contents, read-only">
      {lines.map((l, i) => (
        <div key={i} className="flex whitespace-pre">
          <b className="inline-block w-11 flex-none pr-3 text-right font-normal text-ink-3 select-none">{i + 1}</b>
          <span>{l}</span>
        </div>
      ))}
    </pre>
  );
}

function Diff({ file }: { file: ChangedFile }) {
  return (
    <pre className="m-0 flex-1 overflow-auto py-3 font-mono text-[12.5px] leading-[1.75]" aria-label={`Changes to ${file.path}`}>
      {file.lines.map((l, i) => (
        <div key={i} className={cn("flex whitespace-pre", l.kind === "add" && "bg-works-bg", l.kind === "del" && "bg-failed-bg")}>
          <b className="inline-block w-11 flex-none pr-3 text-right font-normal text-ink-3 select-none">{l.newNo ?? l.oldNo}</b>
          <i className={cn("w-[18px] flex-none not-italic select-none", l.kind === "add" ? "text-works" : l.kind === "del" ? "text-failed" : "text-ink-3")}>{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</i>
          <span>{l.text}</span>
        </div>
      ))}
    </pre>
  );
}

function FileRow({ path, on, onClick, meta, indent = 0, label }: { path: string; on: boolean; onClick: () => void; meta?: React.ReactNode; indent?: number; label?: string }) {
  return (
    <button
      type="button"
      aria-current={on ? "true" : undefined}
      onClick={onClick}
      className={cn("flex min-h-8 w-full items-center gap-2 rounded-[9px] px-2.5 text-left font-mono text-[12.5px] text-ink hover:bg-selected", on && "bg-selected")}
      style={{ paddingLeft: 10 + indent * 14 }}
    >
      <span className="min-w-0 flex-1 truncate">{label ?? path}</span>
      {meta}
    </button>
  );
}

function Counts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="flex-none tabular-nums">
      {added > 0 && <span className="text-works">+{added}</span>} {removed > 0 && <span className="text-failed">−{removed}</span>}
    </span>
  );
}

function KeysTable({ keys }: { keys: ReturnType<typeof envKeys> }) {
  const cell = (set: boolean) => (set ? <span className="text-works">Set</span> : <span className="text-ink-2">Not set</span>);
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-auto p-4">
      <p className="text-small text-ink-2">
        Listed by name only. Values are never shown here, and each version has its own. <SimTag />
      </p>
      {keys.length ? (
        <table className="w-full text-left text-small">
          <thead className="text-ink-2">
            <tr>
              <th className="py-1.5 font-semibold">Name</th>
              <th className="py-1.5 font-semibold">Test version</th>
              <th className="py-1.5 font-semibold">Team version</th>
              <th className="py-1.5 font-semibold">Live</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.name} className="border-t border-line align-top">
                <td className="py-2">
                  <code className="font-mono">{k.name}</code>
                  <span className="block text-ink-2">{k.why}</span>
                </td>
                <td className="py-2">{cell(k.test)}</td>
                <td className="py-2">{cell(k.team)}</td>
                <td className="py-2">{cell(k.live)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-ink-2">This app doesn&apos;t need any keys or passwords yet.</p>
      )}
    </div>
  );
}

type TreeNode = { name: string; path: string; children: TreeNode[]; file: boolean };
function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [], file: false };
  for (const p of paths) {
    let node = root;
    p.split("/").forEach((part, i, all) => {
      const path = all.slice(0, i + 1).join("/");
      let next = node.children.find((c) => c.name === part);
      if (!next) {
        next = { name: part, path, children: [], file: i === all.length - 1 };
        node.children.push(next);
      }
      node = next;
    });
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => Number(a.file) - Number(b.file) || a.name.localeCompare(b.name));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

function Tree({ nodes, selected, onSelect, depth = 0, marks }: { nodes: TreeNode[]; selected: string | null; onSelect: (p: string) => void; depth?: number; marks: Set<string> }) {
  return (
    <ul className="flex flex-col">
      {nodes.map((n) =>
        n.file ? (
          <li key={n.path}>
            <FileRow path={n.path} label={n.name} indent={depth} on={selected === n.path} onClick={() => onSelect(n.path)} meta={marks.has(n.path) ? <span className="text-small text-works">new</span> : undefined} />
          </li>
        ) : (
          <li key={n.path}>
            <details open={depth === 0 && nodes.length < 12}>
              <summary className="flex min-h-8 cursor-pointer items-center gap-1.5 rounded-[9px] px-2.5 font-mono text-[12.5px] text-ink-2 hover:bg-selected" style={{ paddingLeft: 10 + depth * 14 }}>
                {n.name}/
              </summary>
              <Tree nodes={n.children} selected={selected} onSelect={onSelect} depth={depth + 1} marks={marks} />
            </details>
          </li>
        ),
      )}
    </ul>
  );
}

/** Code (screen 8): Changes grouped by part, or All files, beside a read-only view of the file. */
export function CodeView({ project, items, live }: { project: ProjectWorkspace; items: WorkspaceItem[]; live: LiveRun }) {
  const parts = useMemo(() => toParts(items), [items]);
  const version = project.plan?.version ?? 1;
  const baseGroups = useMemo(() => changesByPart({ name: project.name, parts, version, fixes: fixesOf(project), imported: Boolean(project.repo) }), [project, parts, version]);
  // Edits saved in Developer view lay over Architect's changes, under the part each belongs to.
  const groups = useMemo(() => withEdits(baseGroups, project.codeEdits.files), [baseGroups, project.codeEdits.files]);
  const editedContent = useMemo(() => new Map(project.codeEdits.files.map((f) => [f.path, f.content])), [project.codeEdits.files]);
  const canEdit = canBuild(project.role);
  const [editing, setEditing] = useState<{ path: string; before: string; text: string } | null>(null);
  const [saving, setSaving] = useState<{ path: string; before: string; text: string } | null>(null);
  const [notice, setNotice] = useState<string>();
  const changeCount = groups.reduce((n, g) => n + g.files.length, 0);
  const [mode, setMode] = useState<"changes" | "files">(changeCount || !project.repo ? "changes" : "files");
  const [selected, setSelected] = useState<string | null>(null);
  const [repo, setRepo] = useState<RepoView | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [file, setFile] = useState<{ path: string; text?: string; note?: string } | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  useEffect(() => {
    if (!project.repo) return;
    let stale = false;
    loadRepoView({ projectId: project.id })
      .then((r) => {
        if (stale) return;
        if (r.ok) setRepo(r.view);
        else setRepoError(r.message);
      })
      .catch(() => !stale && setRepoError("GitHub didn't answer. Try again in a minute."));
    return () => {
      stale = true;
    };
  }, [project.id, project.repo]);

  // A new project's files are all Architect's; an imported repo's are real, plus what Architect changed.
  const generated = useMemo(
    () =>
      project.repo
        ? new Map(groups.flatMap((g) => g.files).map((f) => [f.path, f.lines.map((l) => l.text).join("\n")]))
        : new Map(generatedTree(project.name, version, parts).map((f) => [f.path, f.content])),
    [project.repo, project.name, parts, version, groups],
  );
  // Parts an imported repo already does weren't rewritten; what Architect added shows as new.
  const changedPaths = new Set(groups.flatMap((g) => g.files.map((f) => f.path)));
  const allPaths = [...new Set([...(repo?.entries.map((e) => e.path) ?? []), ...generated.keys(), ...(project.repo ? [...changedPaths] : [])])];
  const keys = envKeys({ parts, repoKeys: repo?.keys ?? (project.repo ? [] : null), connected: project.connected, envLive: { staging: false, production: project.status === "live" } });

  const changeFile = groups.flatMap((g) => g.files).find((f) => f.path === selected) ?? null;
  const first = groups[0]?.files[0]?.path ?? null;
  const current = mode === "changes" ? (selected && changedPaths.has(selected) ? selected : first) : selected;

  const open = (path: string) => {
    setSelected(path);
    setEditing(null);
    setNotice(undefined);
    if (mode === "files" && editedContent.has(path)) return setFile({ path, text: editedContent.get(path)! });
    if (mode === "changes" || path === ENV_PATH) return;
    const own = generated.get(path);
    if (own !== undefined && !repo?.entries.some((e) => e.path === path)) return setFile({ path, text: own });
    if (!repo) return setFile({ path, note: "Loading…" });
    setLoadingFile(true);
    setFile({ path });
    void loadRepoFile({ projectId: project.id, path }).then((r) => {
      setLoadingFile(false);
      if (!r.ok) return setFile({ path, note: r.message });
      if (r.file.kind === "text") setFile({ path, text: r.file.text });
      else setFile({ path, note: r.file.kind === "binary" ? "A binary file. It isn't shown here." : `A large file (${Math.round(r.file.size / 1024)} KB). It isn't shown here.` });
    });
  };

  const shownChange = mode === "changes" ? (changeFile && changeFile.path === current ? changeFile : groups.flatMap((g) => g.files).find((f) => f.path === current)) : null;
  // The file as it is now, for Edit: the viewer's text, or the new side of its change.
  const currentText =
    current && current !== ENV_PATH
      ? (editedContent.get(current) ??
        (mode === "files" ? file?.text : shownChange ? shownChange.lines.filter((l) => l.kind !== "del").map((l) => l.text).join("\n") : undefined))
      : undefined;
  const activeParts = items.filter((i) => i.status !== "dropped");

  return (
    <div className="flex min-h-0 flex-1 gap-0 px-3 pb-3 max-lg:flex-col">
      <aside aria-label="Files" className="flex w-[270px] flex-none flex-col gap-2 overflow-auto rounded-l-card border border-line bg-surface p-2.5 max-lg:w-full max-lg:rounded-card">
        <Segmented
          label="Code"
          value={mode}
          onChange={(m) => {
            setMode(m);
            setSelected(null);
            setFile(null);
          }}
          className="self-start"
          options={[
            { value: "changes", label: "Changes", count: changeCount },
            { value: "files", label: "All files" },
          ]}
        />
        {mode === "changes" ? (
          groups.length ? (
            groups.map((g) => (
              <section key={g.key} aria-label={`${g.title} · ${g.label}`}>
                <h3 className="px-2 pt-2 pb-1 text-small font-[650]">
                  {g.title} · <span className="font-normal text-ink-2">{g.label}</span>
                </h3>
                {g.files.map((f) => (
                  <FileRow key={f.path} path={f.path} on={current === f.path} onClick={() => open(f.path)} meta={<Counts added={f.added} removed={f.removed} />} />
                ))}
              </section>
            ))
          ) : (
            <p className="p-2 text-small text-ink-2">
              {project.repo ? "No changes yet. Your repo's files are under All files; Architect's work for each part shows here once you click Build." : "No changes yet. Click Build and every part's code shows here, grouped by part."}
            </p>
          )
        ) : (
          <>
            <FileRow path={ENV_PATH} label="Environment · Keys and passwords" on={current === ENV_PATH} onClick={() => open(ENV_PATH)} meta={<span className="text-small text-ink-2">{keys.length}</span>} />
            {project.repo && !repo && !repoError && (
              <p role="status" className="p-2 text-small text-ink-2">
                Reading {project.repo} from GitHub…
              </p>
            )}
            {repoError && (
              <p role="alert" className="p-2 text-small font-semibold text-failed">
                {repoError}
              </p>
            )}
            {repo && (
              <p className="px-2 text-small text-ink-2">
                {repo.repo} · {repo.branch} at <code className="font-mono">{repo.commit.slice(0, 7)}</code> · real files
              </p>
            )}
            <Tree nodes={buildTree(allPaths)} selected={current} onSelect={open} marks={project.repo ? changedPaths : new Set()} />
          </>
        )}
      </aside>
      <section aria-label="Viewer" className="flex min-w-0 flex-1 flex-col rounded-r-card border border-l-0 border-line bg-surface max-lg:rounded-card max-lg:border-l">
        <div className="flex min-h-11 items-center gap-2 border-b border-line px-4">
          <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{current === ENV_PATH ? "Keys and passwords" : (current ?? "Choose a file")}</code>
          {shownChange && <Counts added={shownChange.added} removed={shownChange.removed} />}
          {current && current !== ENV_PATH && (
            <span className="text-small text-ink-2">
              {editedContent.has(current) ? "Edited here" : mode === "files" && repo?.entries.some((e) => e.path === current) ? "From GitHub" : "Architect's code"}
            </span>
          )}
          {current && current !== ENV_PATH && currentText !== undefined && !editing && (
            <Button
              size="sm"
              disabledReason={!canEdit ? "Viewers can read the code but can't change it." : !activeParts.length ? "Write the plan first: an edit belongs to one of its parts." : undefined}
              onClick={() => (setEditing({ path: current, before: currentText, text: currentText }), setNotice(undefined))}
            >
              Edit
            </Button>
          )}
          {current && current !== ENV_PATH && !(mode === "files" && repo?.entries.some((e) => e.path === current)) && <SimTag title="Architect's code is simulated in this prototype." />}
        </div>
        {notice && (
          <p role="status" className="border-b border-line px-4 py-2 text-small font-semibold">
            {notice}
          </p>
        )}
        {editing && editing.path === current ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* The actions sit above the text, so nothing below can cover them. */}
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
              <Button variant="primary" size="sm" disabledReason={editing.text === editing.before ? "Change something first." : undefined} onClick={() => setSaving(editing)}>
                Save edit…
              </Button>
              <Button size="sm" variant="quiet" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <span className="text-small text-ink-2">Saving asks which part this belongs to, and runs that part&apos;s check again.</span>
            </div>
            <label htmlFor="code-edit" className="sr-only">
              Edit {editing.path}
            </label>
            <textarea
              id="code-edit"
              value={editing.text}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
              spellCheck={false}
              className="min-h-[280px] flex-1 resize-none border-0 bg-surface px-4 py-3 font-mono text-[12.5px] leading-[1.75] text-ink"
            />
          </div>
        ) : current === ENV_PATH ? (
          <KeysTable keys={keys} />
        ) : mode === "changes" ? (
          shownChange ? <Diff file={shownChange} /> : <p className="p-4 text-ink-2">Choose a file to see what changed.</p>
        ) : file?.text !== undefined ? (
          <CodeLines text={file.text} />
        ) : (
          <p className="p-4 text-ink-2" role={loadingFile ? "status" : undefined}>
            {loadingFile ? "Reading the file from GitHub…" : (file?.note ?? "Choose a file on the left.")}
          </p>
        )}
        {!editing && <TerminalStrip project={project} items={items} live={live} />}
      </section>
      {saving && (
        <EditPartDialog
          projectId={project.id}
          repo={project.repo}
          edit={saving}
          parts={activeParts.map((i) => ({ key: i.key, title: i.title, status: i.status }))}
          suggested={suggestPart(saving.path, baseGroups, activeParts)}
          onClose={() => setSaving(null)}
          onSaved={(note) => {
            setSaving(null);
            setEditing(null);
            setNotice(note);
          }}
        />
      )}
    </div>
  );
}

/** Which part an edit belongs to (a suggestion is chosen), then save: that part's check runs again. */
function EditPartDialog({
  projectId,
  repo,
  edit,
  parts,
  suggested,
  onClose,
  onSaved,
}: {
  projectId: string;
  repo: string | null;
  edit: { path: string; before: string; text: string };
  parts: { key: string; title: string; status: string }[];
  suggested: string | null;
  onClose: () => void;
  onSaved: (note: string) => void;
}) {
  const router = useRouter();
  const [partKey, setPartKey] = useState(suggested ?? parts[0]?.key ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const part = parts.find((p) => p.key === partKey);
  const ordered = [...parts].sort((a, b) => Number(b.key === suggested) - Number(a.key === suggested));
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-auto rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[480px]" showCloseButton={false}>
        <div className="flex items-center gap-2">
          <DialogTitle className="flex-1 text-sub font-semibold">Which part does this edit belong to?</DialogTitle>
          <SimTag title="Edits are simulated: nothing is written to a repo, and the check run is simulated." />
        </div>
        <DialogDescription className="text-ink-2">
          <code className="font-mono text-small">{edit.path}</code>. Its check runs again, and only a passing check marks the part Works{repo ? `. The edit goes on the pull request into ${repo}` : ""}.
        </DialogDescription>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="sr-only">Part</legend>
          {ordered.map((p) => (
            <label key={p.key} className={cn("flex items-center gap-2.5 rounded-card border border-line px-3 py-2", partKey === p.key && "border-2 border-ink px-[11px] py-[7px]")}>
              <input type="radio" name="edit-part" className="size-4 accent-[var(--ink)]" checked={partKey === p.key} onChange={() => setPartKey(p.key)} />
              <span className="flex-1">{p.title}</span>
              {p.key === suggested && <span className="text-small font-semibold text-ink-2">Suggested</span>}
            </label>
          ))}
        </fieldset>
        {error && (
          <p role="alert" className="text-small font-semibold text-failed">
            {error}
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button variant="quiet" disabledReason={pending ? "Saving…" : undefined} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabledReason={pending ? "Saving…" : partKey ? undefined : "Pick a part first."}
            onClick={() =>
              start(async () => {
                setError(undefined);
                const r = await saveCodeEdit({ projectId, path: edit.path, partKey, before: edit.before, content: edit.text });
                if (!r.ok) return setError(r.message);
                onSaved(
                  `Saved. ${r.rechecks ? `${part?.title}'s check is running again.` : `${part?.title} gets its check when it's built.`}${r.prNumber ? ` The edit is on PR #${r.prNumber}.` : ""}`,
                );
                router.refresh();
              })
            }
          >
            Save to {part?.title ?? "the part"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TermLines({ lines }: { lines: TerminalLine[] }) {
  return (
    <>
      {lines.map((l, i) => (
        <div key={i} className={cn("whitespace-pre-wrap", l.kind === "ok" && "text-works", l.kind === "fail" && "text-failed", l.kind === "info" && "text-ink-2")}>
          {l.kind === "cmd" ? `$ ${l.text}` : l.text}
        </div>
      ))}
    </>
  );
}

function useTerminal(project: ProjectWorkspace, items: WorkspaceItem[], live: LiveRun) {
  const parts = toParts(items);
  const info = branchInfo({ projectId: project.id, name: project.name, version: project.plan?.version ?? 1, repo: project.repo, runStatus: project.run?.status ?? null, parts });
  const titles = Object.fromEntries(items.map((i) => [i.key, i.title]));
  return terminalSession({ events: playedEvents(project, live), titles, branch: info.branch, testCommand: null });
}

/** The last few terminal lines under the code (screen 8). */
function TerminalStrip({ project, items, live }: { project: ProjectWorkspace; items: WorkspaceItem[]; live: LiveRun }) {
  const lines = useTerminal(project, items, live).slice(-4);
  // No terminal for Viewers (M5.5).
  if (!lines.length || !canBuild(project.role)) return null;
  return (
    <div aria-label="Terminal, latest" className="border-t border-line bg-tray px-4 py-2.5 font-mono text-[12.5px] leading-[1.7]">
      <TermLines lines={lines} />
    </div>
  );
}

/**
 * Terminal: the build's commands, replayed as it runs (simulated), and below them your own commands. A few map to the
 * project's real data (npm test and pytest re-run the checks; git status and git diff show the edits; ls and cat read
 * the files); anything else says it runs in the sandbox in Architect 2.0. Nothing runs in a shell. Builders and up.
 */
export function TerminalView({ project, items, live }: { project: ProjectWorkspace; items: WorkspaceItem[]; live: LiveRun }) {
  const replay = useTerminal(project, items, live);
  const router = useRouter();
  const [mine, setMine] = useState<TerminalLine[]>([]);
  const [cleared, setCleared] = useState(false);
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  // Commands run one after another without blocking the input (a refresh after a check re-run mustn't hold it).
  const [running, setRunning] = useState(0);
  const inputId = useId();
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [mine.length]);
  const run = async (line: string) => {
      setRunning((n) => n + 1);
      setCommand("");
      setHistory((h) => [line, ...h].slice(0, 20));
      setMine((m) => [...m, { kind: "cmd", text: line }]);
      try {
        const r = await runCommand({ projectId: project.id, command: line });
        if (!r.ok) return setMine((m) => [...m, { kind: "fail", text: r.message }]);
        if (r.clear) {
          setCleared(true);
          return setMine([]);
        }
        setMine((m) => [...m, ...r.lines]);
        // A re-run of the checks writes proofs: let the rest of the page catch up.
        if (/^(npm (run )?test|pytest)$/.test(line)) router.refresh();
      } catch {
        setMine((m) => [...m, { kind: "fail", text: "The command didn't reach Architect. Try again." }]);
      } finally {
        setRunning((n) => n - 1);
      }
    };
  const lines = [...(cleared ? [] : replay), ...mine];
  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
      <div className="flex items-center gap-2 pb-2 text-small text-ink-2">
        The build&apos;s commands, replayed as it runs, then yours. Try <code className="font-mono">npm test</code>, <code className="font-mono">git status</code> or <code className="font-mono">ls</code>; type <code className="font-mono">help</code> for the list. <SimTag title="The build's commands are replayed. Your commands map to the project's data; nothing runs in a shell." />
      </div>
      <div ref={log} role="log" aria-label="Terminal" className="min-h-0 flex-1 overflow-auto rounded-t-card border border-line bg-tray p-4 font-mono text-[12.5px] leading-[1.7]">
        {lines.length ? <TermLines lines={lines} /> : <span className="text-ink-2">{project.run?.startedAt ? "No commands were recorded for this build." : "Nothing has run yet. The session starts when you click Build."}</span>}
      </div>
      <form
        className="flex items-center gap-2 rounded-b-card border border-t-0 border-line bg-surface px-3 py-2 font-mono text-[12.5px]"
        onSubmit={(e) => {
          e.preventDefault();
          if (command.trim()) void run(command.trim());
        }}
      >
        <label htmlFor={inputId} className="text-ink-2">
          $<span className="sr-only"> Command</span>
        </label>
        <input
          id={inputId}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" && history.length) {
              e.preventDefault();
              setCommand(history[0]);
            }
          }}
          maxLength={200}
          autoComplete="off"
          spellCheck={false}
          placeholder={running ? "Running…" : "Type a command"}
          className="min-h-8 flex-1 bg-transparent outline-none"
        />
      </form>
    </div>
  );
}

/** Activity (screen 8): the checker, the Architect agent, coding agents via MCP and GitHub, for this part or all. */
export function DevActivity({ project, items, live }: { project: ProjectWorkspace; items: WorkspaceItem[]; live: LiveRun }) {
  const partKey = useUi((s) => s.partKey);
  const [scope, setScope] = useState<"part" | "all">("all");
  const parts = toParts(items);
  const info = branchInfo({ projectId: project.id, name: project.name, version: project.plan?.version ?? 1, repo: project.repo, runStatus: project.run?.status ?? null, parts });
  const titles = Object.fromEntries(items.map((i) => [i.key, i.title]));
  const agent = `Claude Code (${project.ownerName === "you" ? "you" : project.ownerName})`;
  const feed = activityFeed({ events: playedEvents(project, live), titles, codingAgent: agent, branch: info.branch });
  const shown = scope === "part" && partKey ? feed.filter((f) => f.itemKey === partKey) : feed;
  const start = project.run?.startedAt ? Date.parse(project.run.startedAt) : null;
  const time = (atMs: number) => (start ? new Date(start + atMs).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Segmented
          label="Activity for"
          mode="filter"
          value={scope}
          onChange={setScope}
          options={[
            { value: "part", label: "This part" },
            { value: "all", label: "All" },
          ]}
        />
        <SimTag />
      </div>
      {scope === "part" && !partKey && <p className="text-small text-ink-2">Open a part in the plan to see only its activity.</p>}
      {shown.length === 0 ? (
        <p className="text-ink-2">{project.run?.startedAt ? "No activity was recorded for this build." : "No activity yet. It starts when you click Build."}</p>
      ) : (
        <ol aria-label="Activity" className="flex flex-col gap-3">
          {[...shown].reverse().map((a) => (
            <li key={a.id} className="flex flex-col gap-0.5">
              <span className="text-small font-semibold text-ink-2">
                {a.who}
                {a.itemKey ? ` · ${titles[a.itemKey] ?? a.itemKey}` : ""} · {time(a.atMs)}
              </span>
              <div className={cn("text-small", a.kind !== "checker" && "font-mono text-[12.5px]")}>
                <TermLines lines={a.lines} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * Download code: a project from a repo downloads its repo from GitHub (real); any other project gets a .zip of
 * Architect's code for its plan, with the edits saved in Developer view (simulated, and the README says so).
 */
export function downloadCode(project: ProjectWorkspace, items: WorkspaceItem[]) {
  if (project.repo) {
    window.open(`https://github.com/${project.repo}/archive/HEAD.zip`, "_blank", "noopener");
    return;
  }
  const edited = new Map(project.codeEdits.files.map((f) => [f.path, f.content]));
  const tree = generatedTree(project.name, project.plan?.version ?? 1, toParts(items)).map((f) => ({ path: f.path, content: edited.get(f.path) ?? f.content }));
  for (const [path, content] of edited) if (!tree.some((f) => f.path === path)) tree.push({ path, content });
  const note = `# ${project.name}\n\nDownloaded from Architect. In this prototype the code is simulated: it shows the shape of what Architect writes for each part of the plan, and it doesn't run.\n`;
  const bytes = zipFiles([{ path: "ARCHITECT.md", content: note }, ...tree]);
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugOf(project.name)}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
