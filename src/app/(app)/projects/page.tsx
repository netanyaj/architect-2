import type { Metadata } from "next";
import { canBuild, canManageMembers } from "@/lib/permissions";
import { creditsUsedThisPeriod, listProjects } from "@/server/queries";
import { projectHref } from "@/lib/dev-preference";
import { userOpenInDev } from "@/server/theme";
import { getAppContext } from "@/server/workspace";
import { ProjectsList } from "./projects-list";

export const metadata: Metadata = { title: "Projects · Architect" };

export default async function ProjectsPage() {
  const ctx = await getAppContext();
  const [projects, used, pref] = await Promise.all([listProjects(ctx), creditsUsedThisPeriod(ctx), userOpenInDev()]);
  return (
    <ProjectsList
      projects={projects.map((p) => ({
        ...p,
        // Owners and Admins; a Builder their own project unless it's Live (the server checks it isn't shared).
        canDelete: canManageMembers(ctx.role) || (ctx.role === "builder" && p.ownerId === ctx.user.id && p.summary.filter !== "live"),
        href: projectHref(p.id, { repo: p.repo, pref, canBuild: canBuild(ctx.role) }),
      }))}
      creditsUsed={used}
      canStart={canBuild(ctx.role)}
      canSeeDeleted={canBuild(ctx.role)}
    />
  );
}
