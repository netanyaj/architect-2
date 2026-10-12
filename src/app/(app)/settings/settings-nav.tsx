"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ax/icon";
import { cn } from "@/lib/utils";
import type { SettingsGroup } from "./settings-menu";

/** The Settings menu: a list on the left on wide screens, a menu at the top on a phone. */
export function SettingsNav({ groups }: { groups: SettingsGroup[] }) {
  const pathname = usePathname();
  const pages = groups.flatMap((g) => g.pages);
  const current = pages.find((p) => p.href === pathname) ?? pages[0];
  return (
    <>
      <nav aria-label="Settings" className="flex flex-col gap-4 max-md:hidden">
        {groups.map((g) => (
          <div key={g.label} className="flex flex-col gap-0.5">
            <span className="px-3 pb-1 text-small font-[650] text-ink-3">{g.label}</span>
            {g.pages.map((p) => (
              <Link
                key={p.href}
                href={p.href}
                aria-current={p.href === current.href ? "page" : undefined}
                className={cn("flex min-h-9 items-center rounded-tile px-3 hover:bg-selected", p.href === current.href && "bg-selected font-semibold")}
              >
                {p.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Settings: ${current.label}. Choose a page`}
            className="flex min-h-10 w-full items-center gap-2 rounded-card border border-line-ctl bg-surface px-3.5 font-semibold"
          >
            <span className="flex-1 text-left">{current.label}</span>
            <Icon name="chevronDown" size="sm" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] rounded-card border border-line bg-surface p-1.5 shadow-pop">
            {groups.map((g) => (
              <div key={g.label}>
                <DropdownMenuLabel className="px-2.5 pt-1.5 pb-0.5 text-small font-[650] text-ink-3">{g.label}</DropdownMenuLabel>
                {g.pages.map((p) => (
                  <DropdownMenuItem key={p.href} asChild className={cn("flex min-h-10 items-center rounded-tile px-2.5", p.href === current.href && "font-semibold")}>
                    <Link href={p.href} aria-current={p.href === current.href ? "page" : undefined}>
                      {p.label}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
