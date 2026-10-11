"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { Button, TextLink } from "@/components/ax/button";
import { EmptyState } from "@/components/ax/empty-state";
import { Icon } from "@/components/ax/icon";
import { ListRow, Tray } from "@/components/ax/list-row";
import { SimTag } from "@/components/ax/pill";
import { Segmented } from "@/components/ax/segmented";
import { StatusWord } from "@/components/ax/status-mark";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { relativeTime } from "@/lib/project-status";
import { deleteProject, deleteProjectForever, duplicateProject, recentlyDeleted, restoreProject } from "@/server/actions/projects";
import type { ProjectRow } from "@/server/queries";

type Row = ProjectRow & { canDelete: boolean; href: string };
type Filter = "all" | "needs" | "live" | "drafts";

function RowMenu({ p, canStart, onDelete, onError }: { p: Row; canStart: boolean; onDelete: () => void; onError: (m: string) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const item = "flex min-h-10 items-center gap-2.5 rounded-tile px-2.5";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Actions for ${p.name}`}
        className="grid size-8 place-items-center rounded-full hover:bg-selected"
        disabled={pending}
      >
        <Icon name="more" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-card border border-line bg-surface p-1.5 shadow-pop">
        <DropdownMenuItem className={item} onSelect={() => router.push(`/p/${p.id}`)}>
          Open
        </DropdownMenuItem>
        <DropdownMenuItem
          className={item}
          disabled={!canStart || Boolean(p.legacy)}
          title={p.legacy ? "Architect 1.0 apps can't be duplicated. Move it to 2.0 first." : canStart ? undefined : "Viewers can't duplicate projects."}
          onSelect={() =>
            start(async () => {
              const r = await duplicateProject({ projectId: p.id });
              if (!r.ok) onError(r.message);
            })
          }
        >
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem className={item} disabled={Boolean(p.legacy)} title={p.legacy ? "Its code is in its repo on GitHub." : undefined} onSelect={() => router.push(`/p/${p.id}?download=1`)}>
          <span className="flex-1">Download code</span>
          <SimTag title="Architect's code is simulated in this prototype; a repo project downloads from GitHub." />
        </DropdownMenuItem>
        <DropdownMenuItem
          className={item}
          disabled={!p.launchable}
          title={p.launchable ? undefined : "Share opens once the app is built."}
          onSelect={() => router.push(`/p/${p.id}/launch`)}
        >
          <span className="flex-1">Share</span>
          <SimTag />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className={`${item} text-failed`}
          disabled={!p.canDelete}
          title={p.canDelete ? undefined : "Only the project's owner, an Owner or an Admin can delete it."}
          onSelect={onDelete}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProjectsList({ projects, creditsUsed, canStart, canSeeDeleted }: { projects: Row[]; creditsUsed: number; canStart: boolean; canSeeDeleted: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const searchId = useId();

  const counts = {
    all: projects.length,
    needs: projects.filter((p) => p.summary.needsYou).length,
    live: projects.filter((p) => p.summary.filter === "live").length,
    drafts: projects.filter((p) => p.summary.filter === "draft").length,
  };
  const q = query.trim().toLowerCase();
  const shown = projects.filter(
    (p) =>
      (filter === "all" ||
        (filter === "needs" && p.summary.needsYou) ||
        (filter === "live" && p.summary.filter === "live") ||
        (filter === "drafts" && p.summary.filter === "draft")) &&
      (!q || p.name.toLowerCase().includes(q) || p.tools.some((t) => t.toLowerCase().includes(q))),
  );

  if (projects.length === 0) {
    return (
      <div className="flex flex-1 items-start justify-center pt-24">
        <EmptyState
          icon="newProject"
          title="No projects yet"
          primary={
            <Button variant="primary" href="/home" disabledReason={canStart ? undefined : "Viewers can't start projects."}>
              Write your first plan
            </Button>
          }
          alternative={
            <Button href="/import" disabledReason={canStart ? undefined : "Viewers can't import repos."}>
              Import a repo
            </Button>
          }
          help={<TextLink href="/home">Not sure? Start from a template</TextLink>}
        >
          Describe something you do every week. Architect writes a plan with its cost, and nothing is built until you say so.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-[22px] px-8 pt-10 pb-12 max-sm:px-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-[200px] flex-1 flex-col gap-1">
          <h1 className="text-title font-[650]">Projects</h1>
          <span className="text-ink-2 tabular-nums">
            {projects.length} {projects.length === 1 ? "project" : "projects"} · {creditsUsed.toLocaleString("en-US")} credits used this month
          </span>
        </div>
        <label htmlFor={searchId} className="sr-only">
          Find a project
        </label>
        <input
          id={searchId}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a project"
          className="min-h-[38px] w-[220px] rounded-full border border-line-ctl bg-surface px-4 placeholder:text-ink-3 max-sm:w-full"
        />
        <Button variant="primary" icon="plus" href="/home" disabledReason={canStart ? undefined : "Viewers can't start projects."}>
          New project
        </Button>
      </div>

      <Segmented
        mode="filter"
        label="Show"
        value={filter}
        onChange={setFilter}
        className="self-start"
        options={[
          { value: "all", label: "All", count: counts.all },
          { value: "needs", label: "Needs you", count: counts.needs },
          { value: "live", label: "Live", count: counts.live },
          { value: "drafts", label: "Drafts", count: counts.drafts },
        ]}
      />

      {error && (
        <p role="alert" className="text-small font-semibold text-failed">
          {error}
        </p>
      )}

      {shown.length ? (
        <Tray label="Projects">
          {shown.map((p) => (
            <ListRow
              key={p.id}
              icon={p.icon}
              name={p.name}
              href={p.href}
              meta={
                <span className="tabular-nums">
                  {p.ownerName} · {relativeTime(p.updatedAt)} · {p.creditsUsed.toLocaleString("en-US")} credits
                </span>
              }
              tools={p.tools}
              status={
                <span className="inline-block w-[210px]">
                  <StatusWord status={p.summary.next.status === "todo" ? "blocked" : p.summary.next.status} className={p.summary.next.status === "todo" ? "text-ink-2" : undefined}>
                    {p.summary.next.text}
                  </StatusWord>
                </span>
              }
              trailing={
                <span className="flex items-center gap-2">
                  {/* F9: an Architect 1.0 app moves to 2.0 through Import, with its repo chosen. */}
                  {p.legacy && !p.legacy.movedTo && (
                    <Button size="sm" href={`/import?repo=${encodeURIComponent(p.legacy.repo)}&from=${p.id}`} disabledReason={canStart ? undefined : "Viewers can't move apps."}>
                      Move to 2.0
                    </Button>
                  )}
                  <RowMenu p={p} canStart={canStart} onDelete={() => setDeleting(p)} onError={setError} />
                </span>
              }
            />
          ))}
        </Tray>
      ) : (
        <p className="rounded-pane border border-line bg-tray px-4 py-8 text-center text-ink-2">
          No projects match. <TextLink onClick={() => { setFilter("all"); setQuery(""); }}>Show all projects</TextLink>
        </p>
      )}

      {canSeeDeleted && <RecentlyDeleted count={projects.length} />}

      <Dialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[440px]" showCloseButton={false}>
          <DialogTitle className="text-sub font-semibold">Delete {deleting?.name}?</DialogTitle>
          <DialogDescription className="text-ink-2">
            It moves to Recently deleted, below, for 30 days, where it can be restored{deleting?.summary.filter === "live" ? ". Live goes offline first" : ""}. After that it&apos;s gone for good.
          </DialogDescription>
          <DialogFooter className="mt-2 gap-2">
            <Button variant="quiet" onClick={() => setDeleting(null)}>
              Keep it
            </Button>
            <Button
              variant="primary"
              disabledReason={pending ? "Deleting…" : undefined}
              onClick={() =>
                start(async () => {
                  const r = await deleteProject({ projectId: deleting!.id });
                  if (!r.ok) setError(r.message);
                  setDeleting(null);
                })
              }
            >
              {pending ? "Deleting…" : "Delete project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Recently deleted (M5.5 review): 30 days to restore; deleting permanently is the Owner's. Opening it purges what's older. */
function RecentlyDeleted({ count }: { count: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // When the project list changes (one deleted from it, or restored), an open list reloads.
  const [seen, setSeen] = useState(count);
  const [rows, setRows] = useState<{ id: string; name: string; deletedAt: string; deletedBy: string | null; canDeleteForever: boolean }[] | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const load = () =>
    start(async () => {
      const r = await recentlyDeleted();
      if (!r.ok) return setError(r.message);
      setLoadedAt(Date.now());
      setRows(r.projects);
    });
  const act = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      setError(undefined);
      const r = await fn();
      if (!r.ok) return setError(r.message);
      setConfirm(null);
      const again = await recentlyDeleted();
      if (again.ok) {
        setLoadedAt(Date.now());
        setRows(again.projects);
      }
      router.refresh();
    });
  if (seen !== count) {
    setSeen(count);
    if (open) setRows(null);
  }
  // Reloads after the list changed under it (rows cleared above).
  useEffect(() => {
    if (open && rows === null) load();
  }, [open, rows]);
  const daysLeft = (iso: string, now: number) => Math.max(0, 30 - Math.floor((now - new Date(iso).getTime()) / 86_400_000));
  return (
    <section aria-label="Recently deleted" className="flex flex-col gap-2">
      <TextLink
        className="self-start"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setRows(null);
        }}
      >
        {open ? "Hide recently deleted" : "Recently deleted"}
      </TextLink>
      {open &&
        (rows === null ? (
          <p className="text-small text-ink-2">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-small text-ink-2">Nothing deleted in the last 30 days.</p>
        ) : (
          <ul aria-label="Recently deleted projects" className="flex flex-col gap-1.5 rounded-pane border border-line bg-tray p-1.5">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface px-4 py-3">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-semibold">{r.name}</span>
                  <span className="text-small text-ink-2">
                    Deleted {relativeTime(r.deletedAt)}
                    {r.deletedBy ? ` by ${r.deletedBy}` : ""} · {daysLeft(r.deletedAt, loadedAt)} days left to restore
                  </span>
                </span>
                <Button size="sm" disabledReason={pending ? "Working…" : undefined} onClick={() => act(() => restoreProject({ projectId: r.id }))}>
                  Restore
                </Button>
                {r.canDeleteForever &&
                  (confirm === r.id ? (
                    <span className="flex items-center gap-2">
                      <span className="text-small">Delete for good? It can&apos;t be undone.</span>
                      <Button size="sm" variant="quiet" onClick={() => setConfirm(null)}>
                        Keep it
                      </Button>
                      <Button size="sm" disabledReason={pending ? "Deleting…" : undefined} onClick={() => act(() => deleteProjectForever({ projectId: r.id }))}>
                        Delete permanently
                      </Button>
                    </span>
                  ) : (
                    <Button size="sm" variant="quiet" onClick={() => setConfirm(r.id)}>
                      Delete permanently…
                    </Button>
                  ))}
              </li>
            ))}
          </ul>
        ))}
      {error && (
        <p role="alert" className="text-small font-semibold text-failed">
          {error}
        </p>
      )}
    </section>
  );
}
