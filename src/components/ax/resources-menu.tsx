"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { RELEASE_NOTES } from "@/lib/release-notes";
import { applyTheme } from "@/lib/theme-choice";
import { setTheme } from "@/server/actions/projects";
import { Icon, type IconName } from "./icon";

const item = "flex min-h-10 items-center gap-2.5 rounded-tile px-2.5";
type ThemeChoice = "system" | "light" | "dark";
const NEXT_THEME: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };
const THEME_ICON: Record<ThemeChoice, IconName> = { system: "system", light: "sun", dark: "moon" };
const THEME_WORD: Record<ThemeChoice, string> = { system: "System", light: "Light", dark: "Dark" };

export const RESOURCES = {
  docs: "https://docs.lyzr.ai",
  discord: "https://discord.gg/5uQCeQzCR6",
};

/**
 * Resources (M5.8), the icon button beside the account chip: Documentation, Join Discord, Keyboard shortcuts, Trash
 * (with its count), the three latest release notes and View all, and a footer with Theme (System → Light → Dark).
 * Getting help (ask, Contact support) is the Help button's job, not this menu's.
 */
export function ResourcesMenu({ theme, trashCount, canSeeTrash }: { theme: ThemeChoice; trashCount: number; canSeeTrash: boolean }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [shownTheme, setShownTheme] = useState(theme);
  const [shortcuts, setShortcuts] = useState(false);
  const cycleTheme = () => {
    const t = NEXT_THEME[shownTheme];
    setShownTheme(t);
    applyTheme(t);
    start(async () => {
      await setTheme(t);
      router.refresh();
    });
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="Resources" title="Resources" className="relative grid size-11 flex-none place-items-center rounded-card hover:bg-selected">
          <Icon name="book" />
          {trashCount > 0 && <span className="absolute top-2 right-2 size-1.5 rounded-full bg-ink-2" aria-hidden="true" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" collisionPadding={12} className="w-[284px] rounded-card border border-line bg-surface p-1.5 shadow-pop">
          <DropdownMenuItem className={item} onSelect={() => window.open(RESOURCES.docs, "_blank", "noopener")}>
            <Icon name="book" size="sm" className="text-ink-2" />
            <span className="flex-1">Documentation</span>
            <Icon name="external" size="sm" className="text-ink-3" />
          </DropdownMenuItem>
          <DropdownMenuItem className={item} onSelect={() => window.open(RESOURCES.discord, "_blank", "noopener")}>
            <Icon name="discord" size="sm" className="text-ink-2" />
            <span className="flex-1">Join Discord</span>
            <Icon name="external" size="sm" className="text-ink-3" />
          </DropdownMenuItem>
          <DropdownMenuItem className={item} onSelect={() => setShortcuts(true)}>
            <Icon name="keyboard" size="sm" className="text-ink-2" />
            Keyboard shortcuts
          </DropdownMenuItem>
          <DropdownMenuItem
            className={item}
            disabled={!canSeeTrash}
            title={canSeeTrash ? undefined : "Viewers don't delete or restore projects."}
            onSelect={() => router.push("/trash")}
          >
            <Icon name="trash" size="sm" className="text-ink-2" />
            <span className="flex-1">Trash</span>
            {trashCount > 0 && <span className="rounded-full border border-line px-2 text-small leading-5 text-ink-2 tabular-nums">{trashCount}</span>}
          </DropdownMenuItem>
          <DropdownMenuSeparator className="my-1 h-px bg-line" />
          <DropdownMenuLabel className="px-2.5 py-1 text-small font-[650] text-ink-3">What&apos;s new</DropdownMenuLabel>
          {RELEASE_NOTES.slice(0, 3).map((n) => (
            <DropdownMenuItem key={n.title} className="flex min-h-9 flex-col items-start gap-0 rounded-tile px-2.5 py-1" onSelect={() => router.push("/whats-new")}>
              <span className="line-clamp-1">{n.title}</span>
              <span className="text-small text-ink-2">{n.date}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem className={`${item} font-semibold`} onSelect={() => router.push("/whats-new")}>
            View all
            <Icon name="arrowRight" size="sm" className="ml-auto text-ink-3" />
          </DropdownMenuItem>
          <DropdownMenuSeparator className="my-1 h-px bg-line" />
          <div className="flex items-center gap-2 px-2.5 py-0.5">
            <span className="flex-1 text-small text-ink-3">Architect 2.0</span>
            <DropdownMenuItem
              aria-label={`Theme: ${THEME_WORD[shownTheme]}. Switch to ${THEME_WORD[NEXT_THEME[shownTheme]]}`}
              title={`Theme: ${THEME_WORD[shownTheme]}`}
              className="grid size-8 place-items-center rounded-full border border-line-ctl p-0"
              // Cycling the theme keeps the menu open, so the change is visible straight away.
              onSelect={(e) => {
                e.preventDefault();
                cycleTheme();
              }}
            >
              <Icon name={THEME_ICON[shownTheme]} size="sm" />
            </DropdownMenuItem>
          </div>
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
