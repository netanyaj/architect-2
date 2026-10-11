"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useUi, type Toast } from "@/lib/ui-store";
import { restoreProject } from "@/server/actions/projects";
import { Icon } from "./icon";

const link = "inline-flex min-h-6 items-center font-semibold text-on-primary underline decoration-white/40 underline-offset-[3px] hover:decoration-white";

/**
 * One toast at a time, bottom-centre, for 8 seconds (e.g. "Moved to Trash · Undo · View Trash"). Mounted once per
 * layout; it lives in the UI store, so it survives the move from a project back to Projects.
 */
export function ToastHost() {
  const toast = useUi((s) => s.toast);
  return toast ? <ToastView key={toast.n} toast={toast} /> : null;
}

function ToastView({ toast }: { toast: Toast }) {
  const router = useRouter();
  const { dismissToast, showToast } = useUi();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const t = setTimeout(dismissToast, 8000);
    return () => clearTimeout(t);
  }, [dismissToast]);
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-32px)] -translate-x-1/2 flex-wrap items-center gap-x-3 gap-y-1 rounded-full bg-primary py-2 pr-2 pl-4 text-on-primary shadow-pop"
    >
      <span>{error ?? toast.text}</span>
      {toast.undo && !error && (
        <>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            className={link}
            aria-disabled={pending || undefined}
            onClick={() =>
              !pending &&
              start(async () => {
                const r = await restoreProject({ projectId: toast.undo!.projectId });
                if (!r.ok) return setError(r.message);
                showToast({ text: "Restored." });
                router.refresh();
              })
            }
          >
            {pending ? "Restoring…" : toast.undo.label}
          </button>
        </>
      )}
      {toast.link && (
        <>
          <span aria-hidden="true">·</span>
          <Link href={toast.link.href} className={link} onClick={dismissToast}>
            {toast.link.label}
          </Link>
        </>
      )}
      <button type="button" aria-label="Dismiss" onClick={dismissToast} className="grid size-7 place-items-center rounded-full hover:bg-white/15">
        <Icon name="close" size="sm" />
      </button>
    </div>
  );
}
