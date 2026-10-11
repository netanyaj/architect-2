import type { SearchIndex } from "@/server/actions/search";

/* ⌘K (M5.10): what to show for a query. Pure, so it's tested without a browser. */

export type PaletteItem = {
  id: string;
  group: "Actions" | "Projects" | "Agents" | "Connections" | "Pages" | "Workspaces";
  label: string;
  hint?: string;
  href?: string;
  /** Switch to this workspace. */
  workspaceId?: string;
  /** Narrows the search instead of opening something (Switch workspace lists the workspaces). */
  fill?: string;
  disabled?: boolean;
  keywords?: string;
};

const PAGES: { label: string; href: string; admin?: boolean; keywords?: string }[] = [
  { label: "Home", href: "/home", keywords: "start prompt" },
  { label: "Projects", href: "/projects", keywords: "apps" },
  { label: "Agents", href: "/agents" },
  { label: "Connections", href: "/connections", keywords: "apps keys lyzr studio" },
  { label: "Marketplace", href: "/marketplace", keywords: "templates" },
  { label: "Usage", href: "/usage", keywords: "credits billing" },
  { label: "Settings", href: "/settings", keywords: "people members plan reset demo" },
  { label: "What's new", href: "/whats-new", keywords: "changelog" },
  { label: "Approvals", href: "/governance/approvals", admin: true, keywords: "requests" },
  { label: "Governance", href: "/governance", admin: true, keywords: "policies rules audit log" },
  { label: "Audit log", href: "/governance?section=audit", admin: true, keywords: "history governance" },
];

const GROUP_ORDER: PaletteItem["group"][] = ["Actions", "Projects", "Agents", "Connections", "Pages", "Workspaces"];
const PER_GROUP = 8;

function matches(item: PaletteItem, words: string[]): boolean {
  const hay = `${item.label} ${item.hint ?? ""} ${item.keywords ?? ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function paletteResults(index: SearchIndex, query: string, opts: { projectId: string | null }): PaletteItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const items: PaletteItem[] = [];
  if (index.canBuild) items.push({ id: "a-new", group: "Actions", label: "New project", hint: "Describe it on Home", href: "/home", keywords: "create start plan" });
  if (index.canBuild) items.push({ id: "a-trash", group: "Actions", label: "Open Trash", href: "/trash", keywords: "deleted restore recently" });
  items.push(
    opts.projectId
      ? { id: "a-viewer", group: "Actions", label: "View as Viewer", hint: "This project, as a Viewer sees it", href: `/p/${opts.projectId}?as=viewer`, keywords: "role preview" }
      : { id: "a-viewer", group: "Actions", label: "View as Viewer", hint: "Open a project first", disabled: true, keywords: "role preview" },
  );
  if (index.workspaces.length > 1) items.push({ id: "a-switch", group: "Actions", label: "Switch workspace", hint: `${index.workspaces.length - 1} more`, keywords: "workspace change", fill: "switch to " });
  for (const p of index.projects) items.push({ id: `p-${p.id}`, group: "Projects", label: p.name, hint: p.status === "draft" ? "Plan" : p.status === "live" ? "Live" : "Built", href: `/p/${p.id}`, keywords: "project app" });
  for (const a of index.agents) items.push({ id: `g-${a.id}`, group: "Agents", label: a.name, hint: a.projectName, href: `/p/${a.projectId}?view=agents`, keywords: "agent" });
  for (const c of index.connections) items.push({ id: `c-${c.provider}`, group: "Connections", label: c.name, hint: c.connected ? "Connected" : "Not connected", href: "/connections", keywords: "connection app" });
  for (const pg of PAGES) if (!pg.admin || index.admin) items.push({ id: `pg-${pg.href}`, group: "Pages", label: pg.label, href: pg.href, keywords: pg.keywords });
  for (const w of index.workspaces) if (!w.current) items.push({ id: `w-${w.id}`, group: "Workspaces", label: `Switch to ${w.label}`, workspaceId: w.id, keywords: "workspace switch" });

  const shown = words.length
    ? items.filter((i) => matches(i, words) && !(i.id === "a-switch"))
    : // Nothing typed: the actions, the 5 latest projects and the pages.
      items.filter((i) => i.group === "Actions" || i.group === "Pages" || (i.group === "Projects" && items.filter((x) => x.group === "Projects").indexOf(i) < 5));
  return GROUP_ORDER.flatMap((g) => shown.filter((i) => i.group === g).slice(0, PER_GROUP));
}
