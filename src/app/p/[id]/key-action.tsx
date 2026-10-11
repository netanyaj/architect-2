"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button, TextLink } from "@/components/ax/button";
import { ArchitectMessage, ChatCard } from "@/components/ax/chat-message";
import { SimTag } from "@/components/ax/pill";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { canBuild } from "@/lib/permissions";
import { isSignInService, providerName, WAITING_FOR_KEY } from "@/lib/providers";
import { addPartKey, skipPartKey } from "@/server/actions/run";
import type { ProjectWorkspace, WorkspaceItem } from "@/server/project";

/**
 * Parts waiting for an API key (M5.8): a service that connects with a key rather than by signing in, not connected yet,
 * and not skipped. One list feeds both Parts › Needs you and the chat's "Action needed" card, so they're the same item:
 * resolving it in one place resolves it in both.
 */
export function partsNeedingKey(items: WorkspaceItem[]): WorkspaceItem[] {
  return items.filter((i) => i.status === "needs_connection" && i.provider && !isSignInService(i.provider) && i.statusDetail !== WAITING_FOR_KEY);
}

/** Add key · Skip, for one part. */
export function KeyAction({ item, project, primary = false }: { item: WorkspaceItem; project: ProjectWorkspace; primary?: boolean }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const name = providerName(item.provider);
  const reason = canBuild(project.role) ? undefined : "Viewers can't add keys.";
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) =>
    start(async () => {
      setError(undefined);
      const r = await fn();
      if (!r.ok) return setError(r.message);
      after?.();
      router.refresh();
    });
  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={primary ? "primary" : "secondary"} disabledReason={reason} onClick={() => setOpen(true)}>
          Add key
        </Button>
        {!reason && (
          <TextLink className="text-small" onClick={() => run(() => skipPartKey({ itemId: item.id }))}>
            Skip
          </TextLink>
        )}
        <SimTag title="The key is checked and thrown away in this prototype; only that it's set is saved" />
      </span>
      {error && (
        <span role="alert" className="text-small font-semibold text-failed">
          {error}
        </span>
      )}
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[440px]" showCloseButton={false}>
          <div className="flex items-center gap-2">
            <DialogTitle className="flex-1 text-sub font-semibold">Add the {name} key</DialogTitle>
            <SimTag title="The key is checked and thrown away in this prototype; only that it's set is saved" />
          </div>
          <DialogDescription className="text-ink-2">
            {item.title} uses {name}. With its key, it works with your real data. The key is saved with your workspace&apos;s Connections.
          </DialogDescription>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => addPartKey({ itemId: item.id, value }),
                () => {
                  setOpen(false);
                  setValue("");
                },
              );
            }}
          >
            <label htmlFor={id} className="text-small font-semibold">
              {name} API key
            </label>
            <input id={id} type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} className="min-h-[38px] rounded-full border border-line-ctl bg-surface px-4 font-mono" />
            {error && (
              <p role="alert" className="text-small font-semibold text-failed">
                {error}
              </p>
            )}
            <DialogFooter className="mt-2 gap-2">
              <Button variant="quiet" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabledReason={pending ? "Saving…" : !value.trim() ? "Paste the key first." : undefined}>
                {pending ? "Saving…" : "Save the key"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </span>
  );
}

/** "Action needed" in chat (M5.8): the same parts as Needs you, with the same Add key · Skip. */
export function ActionNeeded({ project, items }: { project: ProjectWorkspace; items: WorkspaceItem[] }) {
  const parts = partsNeedingKey(items);
  if (parts.length === 0) return null;
  return (
    <ArchitectMessage>
      <p>I need a key to finish {parts.length === 1 ? "one part" : `${parts.length} parts`}. Everything else keeps building, and {parts.length === 1 ? "it uses" : "they use"} sample data until then.</p>
      {parts.map((i) => (
        <ChatCard key={i.id} tone="attention" label={`Action needed: ${i.title}`}>
          <span className="text-small font-[650] text-attention">Action needed</span>
          <p>
            <b>{i.title}</b> needs a {providerName(i.provider)} key.
          </p>
          <KeyAction item={i} project={project} />
        </ChatCard>
      ))}
    </ArchitectMessage>
  );
}
