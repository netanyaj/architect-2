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
        // Deleting a project is for Owners and Admins only (M5.5), always after a confirmation.
        canDelete: canManageMembers(ctx.role),
        href: projectHref(p.id, { repo: p.repo, pref, canBuild: canBuild(ctx.role) }),
      }))}
      creditsUsed={used}
      canStart={canBuild(ctx.role)}
    />
  );
}
