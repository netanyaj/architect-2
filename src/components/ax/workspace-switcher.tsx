"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Role } from "@/lib/db";
import { ROLE_INFO } from "@/lib/permissions";
import { createWorkspace, switchWorkspace } from "@/server/actions/members";
import { Button } from "./button";
import { Icon } from "./icon";

export type WorkspaceOption = { workspaceId: string; label: string; role: Role };

const item = "flex min-h-10 items-center gap-2.5 rounded-tile px-2.5";

/**
 * The workspace menu (M5.5 review, like Notion): the workspace's name under the logo opens your workspaces (with a
 * check on the current one), Settings, Members, Governance (Owners and Admins, with governance on) and New workspace.
 */
export function WorkspaceMenu({ current, options, governance }: { current: string; options: WorkspaceOption[]; governance: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [creating, setCreating] = useState(false);
  const active = options.find((o) => o.workspaceId === current);
  const admin = active && (active.role === "owner" || active.role === "admin");
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Workspace: ${active?.label ?? "current workspace"}. Switch or manage`}
          disabled={pending}
          className="mx-1.5 mb-2 flex min-h-11 items-center gap-2 rounded-tile bg-surface px-2.5 py-1.5 text-left hover:bg-selected"
        >
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate font-semibold">{active?.label ?? "Workspace"}</span>
            {active && <span className="text-small text-ink-2">{ROLE_INFO[active.role].label}</span>}
          </span>
          <Icon name="chevronDown" size="sm" className="text-ink-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[264px] rounded-card border border-line bg-surface p-1.5 shadow-pop">
          <DropdownMenuLabel className="px-2.5 text-small font-[650] text-ink-3">Workspaces</DropdownMenuLabel>
          {options.map((o) => (
            <DropdownMenuItem
              key={o.workspaceId}
              className={item}
              onSelect={() =>
                o.workspaceId !== current &&
                start(async () => {
                  const r = await switchWorkspace(o.workspaceId);
                  if (r.ok) router.push("/home");
                })
              }
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold">{o.label}</span>
                <span className="text-small text-ink-2">{ROLE_INFO[o.role].label}</span>
              </span>
              {o.workspaceId === current && <Icon name="check" size="sm" aria-label="Current" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator className="my-1 h-px bg-line" />
          <DropdownMenuItem className={item} onSelect={() => router.push("/settings")}>
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem className={item} onSelect={() => router.push("/settings#people")}>
            Members
          </DropdownMenuItem>
          {admin && governance && (
            <DropdownMenuItem className={item} onSelect={() => router.push("/governance")}>
              Governance
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator className="my-1 h-px bg-line" />
          <DropdownMenuItem className={item} onSelect={() => setCreating(true)}>
            <Icon name="plus" size="sm" /> New workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function NewWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
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
