"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ax/button";
import type { IconName } from "@/components/ax/icon";
import { ListRow, Tray } from "@/components/ax/list-row";
import { relativeTime } from "@/lib/project-status";
import { deleteProjectForever, restoreProject } from "@/server/actions/projects";

export type TrashRow = { id: string; name: string; icon: IconName; deletedAt: string; deletedBy: string | null };

const daysLeft = (iso: string, now: number) => Math.max(0, 30 - Math.floor((now - new Date(iso).getTime()) / 86_400_000));

/** The Trash list: rows like Projects, with who deleted each one, when and the days left; Restore; Delete permanently. */
export function TrashList({ rows, canRestore, canDeleteForever, now }: { rows: TrashRow[]; canRestore: boolean; canDeleteForever: boolean; now: number }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [, start] = useTransition();
  const act = (id: string, fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      setError(undefined);
      setBusy(id);
      const r = await fn();
      setBusy(null);
      if (!r.ok) return setError(r.message);
      setConfirm(null);
      router.refresh();
    });

  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-[22px] px-8 pt-8 pb-12 max-sm:px-4">
      <nav aria-label="Breadcrumb" className="text-small text-ink-2">
        <ol className="flex items-center gap-1.5">
          <li>
            <Link href="/projects" className="font-semibold text-ink underline decoration-line-ctl underline-offset-[3px] hover:decoration-ink">
              Projects
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">Trash</li>
        </ol>
      </nav>
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-[650]">Trash</h1>
        <p className="text-ink-2">Projects stay here for 30 days, then they&apos;re deleted for good.</p>
      </div>

      {error && (
        <p role="alert" className="text-small font-semibold text-failed">
          {error}
        </p>
      )}

      {!canRestore ? (
        <p className="rounded-pane border border-line bg-tray px-4 py-8 text-center text-ink-2">Viewers don&apos;t delete or restore projects, so there&apos;s nothing here for you.</p>
      ) : rows.length === 0 ? (
        <p className="rounded-pane border border-line bg-tray px-4 py-8 text-center text-ink-2">Trash is empty. Deleted projects wait here for 30 days.</p>
      ) : (
        <Tray label="Deleted projects">
          {rows.map((r) => {
            const left = daysLeft(r.deletedAt, now);
            return (
              <ListRow
                key={r.id}
                icon={r.icon}
                name={r.name}
                meta={
                  <span className="tabular-nums">
                    Deleted {relativeTime(r.deletedAt)}
                    {r.deletedBy ? ` by ${r.deletedBy}` : ""} · {left} {left === 1 ? "day" : "days"} left
                  </span>
                }
                trailing={
                  <span className="flex flex-wrap items-center justify-end gap-2">
                    {confirm === r.id ? (
                      <>
                        <span className="text-small">Delete for good? It can&apos;t be undone.</span>
                        <Button size="sm" variant="quiet" onClick={() => setConfirm(null)}>
                          Keep it
                        </Button>
                        <Button size="sm" disabledReason={busy === r.id ? "Deleting…" : undefined} onClick={() => act(r.id, () => deleteProjectForever({ projectId: r.id }))}>
                          Delete permanently
                        </Button>
                      </>
                    ) : (
                      <>
                        {canDeleteForever && (
                          <Button size="sm" variant="quiet" onClick={() => setConfirm(r.id)}>
                            Delete permanently…
                          </Button>
                        )}
                        <Button size="sm" disabledReason={busy === r.id ? "Restoring…" : undefined} onClick={() => act(r.id, () => restoreProject({ projectId: r.id }))}>
                          Restore
                        </Button>
                      </>
                    )}
                  </span>
                }
              />
            );
          })}
        </Tray>
      )}
    </div>
  );
}
