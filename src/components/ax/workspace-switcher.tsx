"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Role } from "@/lib/db";
import { createWorkspace } from "@/server/actions/members";
import { Button } from "./button";

export type WorkspaceOption = { workspaceId: string; label: string; role: Role };

/** New workspace: a name, then an empty workspace you own (opened from the account menu). */
export function NewWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const id = useId();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name") ?? "");
    start(async () => {
      setError(undefined);
      const r = await createWorkspace({ name });
      if (!r.ok) return setError(r.message);
      onOpenChange(false);
      router.push("/home");
      router.refresh();
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[420px]">
        <DialogTitle className="text-sub font-semibold">New workspace</DialogTitle>
        <DialogDescription className="text-ink-2">An empty workspace you own, with governance off and the Free plan. Invite people from its Settings.</DialogDescription>
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label htmlFor={id} className="text-small font-semibold">
            Name
          </label>
          <input id={id} name="name" maxLength={40} autoComplete="off" placeholder="Marketing" className="min-h-[38px] rounded-full border border-line-ctl bg-surface px-4" />
          {error && (
            <p role="alert" className="text-small font-semibold text-failed">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" className="self-start" disabledReason={pending ? "Making it…" : undefined}>
            Make the workspace
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
