import { HelpHost } from "@/components/ax/help-host";
import { SideNav } from "@/components/ax/side-nav";
import { OrgBudgetBanner } from "@/components/ax/org-budget-banner";
import { canBuild } from "@/lib/permissions";
import { createAdminDb, createServerDb } from "@/server/db";
import { orgBudget } from "@/server/policy";
import { getHelpContext, getNavData } from "@/server/queries";
import { userTheme } from "@/server/theme";
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
  const admin = createAdminDb();
  const [nav, help, budget] = await Promise.all([getNavData(ctx), getHelpContext(ctx), orgBudget(admin, ctx.workspace.id)]);
  // At 100% of the organisation's cap, say whether someone already asked to raise it (C-7).
  const { data: raise } = budget.level === "stopped" ? await admin.from("approvals").select("id").eq("workspace_id", ctx.workspace.id).eq("kind", "budget").eq("status", "waiting").limit(1) : { data: [] };
  const isAdmin = ctx.role === "owner" || ctx.role === "admin";

  return (
    <div className="flex min-h-dvh gap-2.5 bg-canvas p-2.5 max-md:flex-col">
      <SideNav
        workspaceName={ctx.workspace.name}
        currentWorkspaceId={ctx.workspace.id}
        workspaces={ctx.memberships.map((m) => ({ workspaceId: m.workspaceId, label: m.label, role: m.role }))}
        userName={ctx.name}
        userEmail={ctx.user.email ?? ""}
        theme={await userTheme()}
        isAdmin={isAdmin && ctx.workspace.governanceEnabled}
        projectCount={nav.projectCount}
        approvalsWaiting={nav.approvalsWaiting}
        credits={nav.credits}
      />
      <main className="flex min-w-0 flex-1 flex-col rounded-pane border border-line bg-surface shadow-pane">
        {(budget.level === "alert" || budget.level === "stopped") && (
          <div className="px-6 pt-4 max-sm:px-4">
            <OrgBudgetBanner budget={{ cap: budget.cap, spent: budget.spent, level: budget.level, percent: budget.percent, raiseWaiting: Boolean(raise?.length) }} isAdmin={isAdmin} canBuild={canBuild(ctx.role)} />
          </div>
        )}
        {children}
      </main>
      <HelpHost context={help} />
    </div>
  );
}
