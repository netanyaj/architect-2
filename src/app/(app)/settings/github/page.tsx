import type { Metadata } from "next";
import { canManageMembers } from "@/lib/permissions";
import { GitHubProblem, listRepos } from "@/server/github";
import { importPageData } from "@/server/import";
import { getAppContext } from "@/server/workspace";
import { GitHubSection, type GitHubInstallRow } from "../github-section";

export const metadata: Metadata = { title: "GitHub · Settings · Architect" };

/** Settings › GitHub (BL-11): each connected installation and the repos it can read, from GitHub itself. */
export default async function GitHubSettingsPage() {
  const ctx = await getAppContext();
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
  return <GitHubSection installs={installs} installUrl={github.installUrl} canConnect={github.canAct} canDisconnect={canManageMembers(ctx.role)} />;
}
