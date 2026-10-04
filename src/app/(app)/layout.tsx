import { SideNav } from "@/components/ax/side-nav";
import { createServerDb } from "@/server/db";
import { getNavData } from "@/server/queries";
import { getAppContext } from "@/server/workspace";

/** Pages outside a project: the tray side nav plus the white main surface. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Home also works signed out (so a typed prompt survives sign-in); every other page is guarded by the proxy.
  const db = await createServerDb();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return <>{children}</>;

  const ctx = await getAppContext();
  const nav = await getNavData(ctx);
  const isAdmin = ctx.role === "owner" || ctx.role === "admin";

  return (
    <div className="flex min-h-dvh gap-2.5 bg-canvas p-2.5 max-md:flex-col">
      <SideNav
        workspaceName={ctx.workspace.name}
        currentWorkspaceId={ctx.workspace.id}
        workspaces={ctx.memberships.map((m) => ({ workspaceId: m.workspaceId, label: m.label, role: m.role }))}
        userName={ctx.name}
        isAdmin={isAdmin && ctx.workspace.governanceEnabled}
        projectCount={nav.projectCount}
        approvalsWaiting={nav.approvalsWaiting}
        credits={nav.credits}
      />
      <main className="flex min-w-0 flex-1 flex-col rounded-pane border border-line bg-surface shadow-pane">{children}</main>
    </div>
  );
}
