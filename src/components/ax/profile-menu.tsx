"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { OPEN_IN_DEV, type OpenInDev } from "@/lib/dev-preference";
import { applyTheme } from "@/lib/theme-choice";
import { useUi } from "@/lib/ui-store";
import { cn } from "@/lib/utils";
import { signOut } from "@/server/actions/auth";
import { setOpenInDev, setTheme } from "@/server/actions/projects";
import { Icon } from "./icon";

const item = "flex min-h-10 items-center gap-2.5 rounded-tile px-2.5";
type ThemeChoice = "system" | "light" | "dark";

export const RESOURCES = {
  docs: "https://docs.lyzr.ai",
  discord: "https://discord.gg/5uQCeQzCR6",
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

/** A small inline switch inside a menu (Theme, Developer view default): choosing doesn't close the menu. */
function Inline<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-col gap-1 px-2.5 py-1.5">
      <span className="text-small font-semibold text-ink-2">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex rounded-full border border-line-ctl p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => value !== o.value && onChange(o.value)}
            className={cn("min-h-7 flex-1 rounded-full px-2 text-small font-[600]", value === o.value ? "bg-ink text-surface" : "text-ink-2 hover:text-ink")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The account menu (M5.5 review): from the avatar at the foot of the nav. Who you are; Theme (System, Light, Dark,
 * inline); where projects open (Developer view default); Help and resources (Docs, Join Discord, What's new, Contact
 * support, Keyboard shortcuts); Log out. Workspace things are in the workspace menu under the logo.
 */
export function ProfileMenu({ name, email, theme, openInDev, canBuild }: { name: string; email: string; theme: ThemeChoice; openInDev: OpenInDev; canBuild: boolean }) {
  const router = useRouter();
  const openHelp = useUi((s) => s.openHelp);
  const [, start] = useTransition();
  const [shownTheme, setShownTheme] = useState(theme);
  const [shownDev, setShownDev] = useState(openInDev);
  const [shortcuts, setShortcuts] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger aria-label={`Account: ${name}`} className="flex min-h-12 w-full items-center gap-2.5 rounded-card px-3 py-1.5 text-left hover:bg-selected">
          <span className="grid size-[30px] flex-none place-items-center rounded-full bg-surface text-small font-bold" aria-hidden="true">
            {initials(name)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate font-semibold">{name}</span>
            <span className="truncate text-small text-ink-2">{email}</span>
          </span>
          <Icon name="chevronDown" size="sm" className="text-ink-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-[280px] rounded-card border border-line bg-surface p-1.5 shadow-pop">
          <div className="flex flex-col px-2.5 py-1.5">
            <span className="truncate font-semibold">{name}</span>
            <span className="truncate text-small text-ink-2">{email}</span>
          </div>
          <DropdownMenuSeparator className="my-1 h-px bg-line" />
          <Inline
            label="Theme"
            value={shownTheme}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            onChange={(t) => {
              setShownTheme(t);
              applyTheme(t);
              start(async () => {
                await setTheme(t);
                router.refresh();
              });
            }}
          />
          {canBuild && (
            <Inline
              label="Open projects in Developer view"
              value={shownDev}
              options={OPEN_IN_DEV}
              onChange={(v) => {
                setShownDev(v);
                start(async () => {
                  await setOpenInDev(v);
                  router.refresh();
                });
              }}
            />
          )}
          <DropdownMenuSeparator className="my-1 h-px bg-line" />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={item}>Help and resources</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56 rounded-card border border-line bg-surface p-1.5 shadow-pop">
              <DropdownMenuItem className={item} onSelect={() => window.open(RESOURCES.docs, "_blank", "noopener")}>
                Docs <Icon name="arrowRight" size="sm" className="ml-auto text-ink-3" />
              </DropdownMenuItem>
              <DropdownMenuItem className={item} onSelect={() => window.open(RESOURCES.discord, "_blank", "noopener")}>
                Join Discord <Icon name="arrowRight" size="sm" className="ml-auto text-ink-3" />
              </DropdownMenuItem>
              <DropdownMenuItem className={item} onSelect={() => router.push("/whats-new")}>
                What&apos;s new
              </DropdownMenuItem>
              <DropdownMenuItem className={item} onSelect={() => openHelp()}>
                Contact support
              </DropdownMenuItem>
              <DropdownMenuItem className={item} onSelect={() => setShortcuts(true)}>
                Keyboard shortcuts
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator className="my-1 h-px bg-line" />
          <DropdownMenuItem className={item} onSelect={() => start(() => signOut())}>
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
    </>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Enter", "Send a message, or write the plan"],
  ["Shift + Enter", "A new line in a message"],
  ["Esc", "Close a drawer, menu or dialog"],
  ["↑", "The last command again, in the terminal"],
  ["← →", "Move between stage tabs"],
  ["Tab", "Move between controls"],
];

function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[440px]">
        <DialogTitle className="text-sub font-semibold">Keyboard shortcuts</DialogTitle>
        <DialogDescription className="text-ink-2">The keys Architect understands.</DialogDescription>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          {SHORTCUTS.map(([k, what]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded-tile border border-line-ctl bg-tray px-2 py-0.5 font-mono text-small">{k}</kbd>
              </dt>
              <dd className="text-ink-2">{what}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
