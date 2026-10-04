import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { HelpHost } from "@/components/ax/help-host";
import { getProjectWorkspace } from "@/server/project";
import { getHelpContext, getNavData } from "@/server/queries";
import { getAppContext } from "@/server/workspace";
import { SwitchWorkspaceCard } from "../switch-workspace-card";
import { Workspace } from "../workspace";

export const metadata: Metadata = { title: "Launch · Architect" };

/** Launch (screen 4): the workspace with the Launch stage in place of the app. */
export default async function LaunchPage({ params }: PageProps<"/p/[id]/launch">) {
  const { id } = await params;
  const ctx = await getAppContext();
  const [nav, help] = await Promise.all([getNavData(ctx), getHelpContext(ctx)]);
  const project = await getProjectWorkspace(id, ctx, nav.credits.left, { catchUp: true, launch: true });
  if (!project) notFound();
  if (project.otherWorkspace) return <SwitchWorkspaceCard name={project.name} workspace={project.otherWorkspace} />;
  // Launch opens once the build has finished; before that the workspace shows where it is.
  if (!project.plan?.agreedAt || project.run?.status === "running") redirect(`/p/${project.id}`);
  return (
    <>
      <Workspace project={project} page="launch" />
      <HelpHost context={help} />
    </>
  );
}
