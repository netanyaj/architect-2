"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ROLE_INFO } from "@/lib/permissions";
import { useUi } from "@/lib/ui-store";
import { signOut } from "@/server/actions/auth";
import { switchWorkspace } from "@/server/actions/members";
import { setTheme } from "@/server/actions/projects";
import { Icon } from "./icon";
import type { WorkspaceOption } from "./workspace-switcher";

const item = "flex min-h-10 items-center gap-2.5 rounded-tile px-2.5";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

/** The profile menu at the foot of the nav: who you are, your workspaces, Settings, Theme, Help and Log out. */
export function ProfileMenu({ name, email, theme, current, workspaces }: { name: string; email: string; theme: "light" | "dark"; current: string; workspaces: WorkspaceOption[] }) {
  const router = useRouter();
  const openHelp = useUi((s) => s.openHelp);
  const [pending, start] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Profile: ${name}`} className="flex min-h-12 w-full items-center gap-2.5 rounded-card px-3 py-1.5 text-left hover:bg-selected" disabled={pending}>
        <span className="grid size-[30px] flex-none place-items-center rounded-full bg-surface text-small font-bold" aria-hidden="true">
          {initials(name)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate font-semibold">{name}</span>
          <span className="truncate text-small text-ink-2">{email}</span>
        </span>
        <Icon name="chevronDown" size="sm" className="text-ink-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-[264px] rounded-card border border-line bg-surface p-1.5 shadow-pop">
        <div className="flex flex-col px-2.5 py-1.5">
          <span className="truncate font-semibold">{name}</span>
          <span className="truncate text-small text-ink-2">{email}</span>
        </div>
        <DropdownMenuSeparator className="my-1 h-px bg-line" />
        <DropdownMenuLabel className="px-2.5 text-small font-[650] text-ink-3">Workspaces</DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuItem
            key={w.workspaceId}
            className={item}
            onSelect={() =>
              w.workspaceId !== current &&
              start(async () => {
                const r = await switchWorkspace(w.workspaceId);
                if (r.ok) router.push("/home");
              })
            }
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-semibold">{w.label}</span>
              <span className="text-small text-ink-2">{ROLE_INFO[w.role].label}</span>
            </span>
            {w.workspaceId === current && <Icon name="check" size="sm" aria-label="Current" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator className="my-1 h-px bg-line" />
        <DropdownMenuItem className={item} onSelect={() => router.push("/settings")}>
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem
          className={item}
          onSelect={() =>
            start(async () => {
              const next = theme === "dark" ? "light" : "dark";
              // Shown at once; saved to the account, then the page catches up.
              document.documentElement.setAttribute("data-theme", next);
              await setTheme(next);
              router.refresh();
            })
          }
        >
          <span className="flex-1">Theme</span>
          <span className="text-small text-ink-2">{theme === "dark" ? "Dark · switch to Light" : "Light · switch to Dark"}</span>
        </DropdownMenuItem>
        <DropdownMenuItem className={item} onSelect={() => openHelp()}>
          Help
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-1 h-px bg-line" />
        <DropdownMenuItem className={item} onSelect={() => start(() => signOut())}>
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
