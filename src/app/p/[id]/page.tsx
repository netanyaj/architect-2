import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getNavData } from "@/server/queries";
import { getProjectWorkspace } from "@/server/project";
import { getAppContext } from "@/server/workspace";
import { SwitchWorkspaceCard } from "./switch-workspace-card";
import { Workspace } from "./workspace";

export async function generateMetadata({ params }: PageProps<"/p/[id]">): Promise<Metadata> {
  const { id } = await params;
  const ctx = await getAppContext();
  const project = await getProjectWorkspace(id, ctx, 0);
  return { title: project ? `${project.name} · Architect` : "Project · Architect" };
}

export default async function ProjectPage({ params }: PageProps<"/p/[id]">) {
  const { id } = await params;
  const ctx = await getAppContext();
  const nav = await getNavData(ctx);
  const project = await getProjectWorkspace(id, ctx, nav.credits.left);
  if (!project) notFound();
  if (project.otherWorkspace) return <SwitchWorkspaceCard name={project.name} workspace={project.otherWorkspace} />;
  return <Workspace project={project} />;
}
