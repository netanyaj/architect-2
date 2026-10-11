import type { Metadata } from "next";
import { buttonClasses } from "@/components/ax/button";
import type { Role } from "@/lib/db";
import { assignableRolesFor, canChangeMember, canManageMembers, canResetDemo, ROLE_INFO } from "@/lib/permissions";
import { signOut } from "@/server/actions/auth";
import { createAdminDb, createServerDb } from "@/server/db";
import { origin } from "@/server/origin";
import { listProjects } from "@/server/queries";
import { GitHubProblem, listRepos } from "@/server/github";
import { importPageData } from "@/server/import";
import { userTheme } from "@/server/theme";
import { getAppContext } from "@/server/workspace";
import { AppearanceSection } from "./appearance-section";
import { BudgetsSection } from "./budgets-section";
import { DemoDataSection } from "./demo-data-section";
import { GitHubSection, type GitHubInstallRow } from "./github-section";
import { GovernanceSection } from "./governance-section";
import { MembersSection, type MemberRow } from "./members-section";
import { PlanSection } from "./plan-section";

export const metadata: Metadata = { title: "Settings · Architect" };

export default async function SettingsPage() {
  const ctx = await getAppContext();
  const db = await createServerDb();
  const { data: rows } = await db
    .from("members")
    .select("id, user_id, role, status, display_name, email, invited_email, created_at")
    .eq("workspace_id", ctx.workspace.id)
    .order("created_at");

  const manage = canManageMembers(ctx.role);
  const projects = await listProjects(ctx);
  const theme = await userTheme();
  // GitHub (BL-11): each connected installation and the repos it can read, from GitHub itself.
  const github = await importPageData(ctx);
  const installs: GitHubInstallRow[] = await Promise.all(
    github.installations.map(async (i) => {
      try {
        const repos = await listRepos(i.installationId);
        return { ...i, repos: repos.map((r) => ({ fullName: r.fullName, private: r.private, project: github.imported[r.fullName] ?? null })), problem: null };
      } catch (err) {
        return { ...i, repos: null, problem: err instanceof GitHubProblem ? err.message : "GitHub didn't answer. Try again in a minute." };
      }
    }),
  );
  // Invite links are only for people who can manage members; read them with the service role.
  const links = new Map<string, string>();
  if (manage) {
    const { data } = await createAdminDb()
      .from("members")
      .select("id, invite_token")
      .eq("workspace_id", ctx.workspace.id)
      .eq("status", "invited");
    const base = await origin();
    for (const m of data ?? []) if (m.invite_token) links.set(m.id, `${base}/invite/${m.invite_token}`);
  }

  const order: Record<Role, number> = { owner: 0, admin: 1, builder: 2, viewer: 3 };
  const members: MemberRow[] = (rows ?? [])
    .map((m) => {
      const change = canChangeMember({ role: ctx.role, userId: ctx.user.id }, { role: m.role as Role, userId: m.user_id });
      return {
        id: m.id,
        name: m.display_name ?? m.email ?? m.invited_email ?? "Someone",
        email: m.email ?? m.invited_email ?? "",
        role: m.role as Role,
        invited: m.status === "invited",
        isYou: m.user_id === ctx.user.id,
        changeBlockedReason: change.ok ? undefined : change.reason,
        inviteLink: links.get(m.id),
      };
    })
    .sort((a, b) => Number(a.invited) - Number(b.invited) || order[a.role] - order[b.role]);

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8 px-8 pt-10 pb-12 max-sm:px-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-[650]">Settings</h1>
        <p className="text-ink-2">
          {ctx.workspace.name} · you&apos;re {/^[AEIOU]/.test(ROLE_INFO[ctx.role].label) ? "an" : "a"} {ROLE_INFO[ctx.role].label}.{" "}
          {ROLE_INFO[ctx.role].can}
        </p>
      </div>

      <MembersSection
        workspaceName={ctx.workspace.name}
        members={members}
        canManage={manage}
        assignable={assignableRolesFor(ctx.role)}
      />

      <BudgetsSection
        canEdit={manage}
        projects={projects.map((p) => ({ id: p.id, name: p.name, budget: p.budgetCredits, spent: p.creditsUsed }))}
      />

      <PlanSection plan={ctx.workspace.plan} canEdit={manage} />

      <GovernanceSection on={ctx.workspace.governanceEnabled} canEdit={manage} />

      <GitHubSection installs={installs} installUrl={github.installUrl} canConnect={github.canAct} canDisconnect={manage} />

      <AppearanceSection theme={theme} />

      <section aria-labelledby="account" className="flex flex-col gap-3">
        <h2 id="account" className="text-heading font-[650]">
          Your account
        </h2>
        <div className="flex flex-wrap items-center gap-4 rounded-card border border-line p-4">
          <dl className="grid flex-1 grid-cols-[100px_minmax(0,1fr)] gap-y-1.5">
            <dt className="text-ink-2">Name</dt>
            <dd>{ctx.name}</dd>
            <dt className="text-ink-2">Email</dt>
            <dd className="truncate">{ctx.user.email}</dd>
          </dl>
          <form action={signOut}>
            <button type="submit" className={buttonClasses({})}>
              Sign out
            </button>
          </form>
        </div>
      </section>

      {canResetDemo(ctx.role) && ctx.workspace.kind !== "personal" && <DemoDataSection workspaceName={ctx.workspace.name} />}
    </div>
  );
}
