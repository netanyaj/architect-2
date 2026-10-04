"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Role } from "@/lib/db";
import { ROLE_INFO } from "@/lib/permissions";
import { switchWorkspace } from "@/server/actions/members";
import { Icon } from "./icon";

export type WorkspaceOption = { workspaceId: string; label: string; role: Role };

/** The brand row's switcher: your own workspace and any you were invited to. */
export function WorkspaceSwitcher({ current, options }: { current: string; options: WorkspaceOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const active = options.find((o) => o.workspaceId === current);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Switch workspace: ${active?.label ?? "current workspace"}`}
        className="grid size-8 place-items-center rounded-full hover:bg-selected"
        disabled={pending}
      >
        <Icon name="switcher" size="sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 rounded-card border border-line bg-surface p-1.5 shadow-pop">
        <DropdownMenuLabel className="px-2.5 text-small font-[650] text-ink-3">Workspaces</DropdownMenuLabel>
        {options.map((o) => (
          <DropdownMenuItem
            key={o.workspaceId}
            onSelect={() =>
              o.workspaceId !== current &&
              start(async () => {
                const r = await switchWorkspace(o.workspaceId);
                if (r.ok) router.push("/home");
              })
            }
            className="flex min-h-10 items-center gap-2.5 rounded-tile px-2.5"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-semibold">{o.label}</span>
              <span className="text-small text-ink-2">{ROLE_INFO[o.role].label}</span>
            </span>
            {o.workspaceId === current && <Icon name="check" size="sm" aria-label="Current" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
