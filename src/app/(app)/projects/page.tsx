import type { Metadata } from "next";
import { canBuild, canManageMembers } from "@/lib/permissions";
import { creditsUsedThisPeriod, listProjects } from "@/server/queries";
import { getAppContext } from "@/server/workspace";
import { ProjectsList } from "./projects-list";

export const metadata: Metadata = { title: "Projects · Architect" };

export default async function ProjectsPage() {
  const ctx = await getAppContext();
  const [projects, used] = await Promise.all([listProjects(ctx), creditsUsedThisPeriod(ctx)]);
  return (
    <ProjectsList
      projects={projects.map((p) => ({
        ...p,
        // Owners and Admins can delete anything; a Builder can delete their own.
        canDelete: canManageMembers(ctx.role) || (ctx.role === "builder" && p.ownerId === ctx.user.id),
      }))}
      creditsUsed={used}
      canStart={canBuild(ctx.role)}
    />
  );
}
