"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icon";
import { AccountMenu } from "./account-menu";
import { ResourcesMenu } from "./resources-menu";
import type { WorkspaceOption } from "./workspace-switcher";
import type { WorkspacePlan } from "@/lib/plans";

type NavItem = { href: string; label: string; icon: IconName; count?: number };

export type SideNavProps = {
  workspaceName: string;
  currentWorkspaceId: string;
  workspaces: WorkspaceOption[];
  userName: string;
  userEmail: string;
  theme: "system" | "light" | "dark";
  canBuild: boolean;
  plan: WorkspacePlan;
  memberCount: number;
  trashCount: number;
  governance: boolean;
  isAdmin: boolean;
  projectCount?: number;
  approvalsWaiting?: number;
  credits: { left: number; total: number; resetsOn: string };
};

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-10 w-full items-center gap-[11px] rounded-card border border-transparent px-3 text-body font-[550] text-ink-2 no-underline hover:bg-selected hover:text-ink",
        active && "border-line bg-surface font-[650] text-ink shadow-[0_1px_2px_rgba(0,0,0,.05)] hover:bg-surface",
      )}
    >
      <Icon name={item.icon} />
      {item.label}
      {item.count !== undefined && item.count > 0 && (
        <span className="ml-auto rounded-full border border-line bg-surface px-2 text-small leading-5 text-ink-2 tabular-nums">
          {item.count}
        </span>
      )}
    </Link>
  );
}

export function CreditsCard({ left, total, resetsOn }: SideNavProps["credits"]) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3.5">
      <div className="flex items-center justify-between">
        <span className="font-semibold">Credits</span>
        <span className="text-small font-semibold tabular-nums">
          {left.toLocaleString("en-US")} / {total.toLocaleString("en-US")}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-selected"
        role="meter"
        aria-label="Credits left"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={left}
      >
        <i className="block h-full bg-ink" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between text-small text-ink-2">
        <span>Resets {resetsOn}</span>
        <Link href="/usage" className="min-h-6 font-semibold text-ink underline decoration-line-ctl underline-offset-[3px]">
          Plans
        </Link>
      </div>
    </div>
  );
}

/** The tray side nav for pages outside a project. */
export function SideNav(props: SideNavProps) {
  const pathname = usePathname();
  // On phones the nav folds into a bar with a Menu button, so the page starts on the first screen.
  const [menuOpen, setMenuOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMenuOpen(false);
  }
  const main: NavItem[] = [
    { href: "/home", label: "Home", icon: "home" },
    { href: "/projects", label: "Projects", icon: "projects", count: props.projectCount },
    { href: "/agents", label: "Agents", icon: "agent" },
    { href: "/connections", label: "Connections", icon: "connections" },
    { href: "/marketplace", label: "Marketplace", icon: "marketplace" },
    { href: "/usage", label: "Usage", icon: "usage" },
  ];
  const admin: NavItem[] = [
    { href: "/governance/approvals", label: "Approvals", icon: "approvals", count: props.approvalsWaiting },
    { href: "/governance", label: "Governance", icon: "governance" },
  ];
  const isActive = (href: string) =>
    href === "/governance" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      aria-label="Workspace"
      className="flex flex-col gap-0.5 rounded-pane border border-line bg-tray px-3 py-3.5 md:sticky md:top-2.5 md:h-[calc(100dvh-20px)] md:w-[248px] md:flex-none"
    >
      <div className="flex items-center gap-2.5 px-1.5 pt-0.5 pb-3 text-sub font-bold max-md:pb-0">
        <span className="grid size-[30px] flex-none place-items-center rounded-[9px] bg-primary text-body font-bold text-on-primary" aria-hidden="true">
          A
        </span>
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="flex items-center gap-1.5">
            Architect
            <span className="rounded-full border border-line-ctl px-1.5 text-small font-semibold leading-5 text-ink-2" title="Architect 2.0: the build you're in">
              2.0
            </span>
          </span>
          {/* The workspace's name, as plain text: switching and managing it is the account chip's job. */}
          <span className="truncate text-small font-[550] text-ink-2">{props.workspaceName}</span>
        </span>
        <span className="flex-1" />
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls="side-nav-items"
          onClick={() => setMenuOpen(!menuOpen)}
          className="min-h-8 rounded-full border border-line-ctl bg-surface px-3 text-body font-[550] md:hidden"
        >
          {menuOpen ? "Close" : "Menu"}
        </button>
      </div>
      <div id="side-nav-items" className={cn("flex flex-1 flex-col gap-0.5", !menuOpen && "max-md:hidden")}>
      {main.map((item) => (
        <NavLink key={item.href} item={item} active={isActive(item.href)} />
      ))}
      {props.isAdmin && (
        <>
          <div className="px-3 pt-3.5 pb-1 text-small font-[650] text-ink-3">Admin</div>
          {admin.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item.href)} />
          ))}
        </>
      )}
      <div className="flex-1" />
      <CreditsCard {...props.credits} />
      {/* Two controls side by side (Notion's pattern): the account chip, and Resources. */}
      <div className="flex items-center gap-1 pt-1">
        <AccountMenu
          name={props.userName}
          email={props.userEmail}
          current={props.currentWorkspaceId}
          options={props.workspaces}
          plan={props.plan}
          memberCount={props.memberCount}
          governance={props.governance}
        />
        <ResourcesMenu theme={props.theme} trashCount={props.trashCount} canSeeTrash={props.canBuild} />
      </div>
      </div>
    </nav>
  );
}
