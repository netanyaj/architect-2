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
  // Launch opens once there's an agreed plan (no Launch before a build). During a build its checklist says what
  // isn't built yet; sharing and going live wait for it (M5.5 review: the Launch button is navigation).
  if (!project.plan?.agreedAt) redirect(`/p/${project.id}`);
  return (
    <>
      <Workspace project={project} page="launch" />
      <HelpHost context={help} />
    </>
  );
}
