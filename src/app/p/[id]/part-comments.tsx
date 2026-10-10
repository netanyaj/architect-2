"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button, TextLink } from "@/components/ax/button";
import { relativeTime } from "@/lib/project-status";
import { addPartComment } from "@/server/actions/comments";

export type PartComment = { id: string; body: string; author: string; at: string };

/**
 * Comments on a plan part (BL-15): anyone in the workspace, Viewers included. They're for people; nothing in the plan
 * changes because of one. Closed by default, with the count.
 */
export function PartComments({ projectId, itemKey, title, comments }: { projectId: string; itemKey: string; title: string; comments: PartComment[] }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className="flex flex-col gap-1.5">
      <TextLink onClick={() => setOpen((o) => !o)} aria-expanded={open} className="self-start text-small">
        {comments.length ? `Comments (${comments.length})` : "Comment"}
      </TextLink>
      {open && (
        <section aria-label={`Comments on ${title}`} className="flex flex-col gap-2 rounded-card bg-tray p-2.5">
          {comments.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {comments.map((c) => (
                <li key={c.id} className="text-small">
                  <span className="font-semibold">{c.author}</span> <span className="text-ink-2">· {relativeTime(c.at)}</span>
                  <p className="whitespace-pre-wrap">{c.body}</p>
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex flex-col gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                setError(undefined);
                const r = await addPartComment({ projectId, itemKey, body });
                if (!r.ok) return setError(r.message);
                setBody("");
                router.refresh();
              });
            }}
          >
            <label htmlFor={id} className="sr-only">
              Comment on {title}
            </label>
            <textarea id={id} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={2} placeholder="Say what you think of this part. It doesn't change the plan." className="rounded-tile border border-line-ctl bg-surface px-3 py-2 text-body" />
            {error && (
              <p role="alert" className="text-small font-semibold text-failed">
                {error}
              </p>
            )}
            <Button type="submit" size="sm" className="self-start" disabledReason={pending ? "Saving…" : body.trim() ? undefined : "Write a comment first."}>
              Comment
            </Button>
          </form>
        </section>
      )}
    </div>
  );
}
