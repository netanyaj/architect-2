import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { HelpHost } from "@/components/ax/help-host";
import { HelpLauncher } from "@/components/ax/help-launcher";
import { ToastHost } from "@/components/ax/toast";
import { canBuild } from "@/lib/permissions";
import { createServerDb } from "@/server/db";
import { getHelpContext, getNavData } from "@/server/queries";
import { track } from "@/server/analytics";
import { getProjectWorkspace, viewingAs } from "@/server/project";
import { getAppContext } from "@/server/workspace";
import { LegacyProject } from "./legacy-project";
import { SwitchWorkspaceCard } from "./switch-workspace-card";
import { Workspace } from "./workspace";
import { CommandPalette } from "@/components/ax/command-palette";

const UUID = /^[0-9a-f-]{36}$/i;

/** Only the name: the page loads the project itself (loading it twice made every project page slower). */
export async function generateMetadata({ params }: PageProps<"/p/[id]">): Promise<Metadata> {
  const { id } = await params;
  if (!UUID.test(id)) return { title: "Project · Architect" };
  const db = await createServerDb();
  const { data } = await db.from("projects").select("name").eq("id", id).maybeSingle();
  return { title: data ? `${data.name} · Architect` : "Project · Architect" };
}

export default async function ProjectPage({ params, searchParams }: PageProps<"/p/[id]">) {
  const { id } = await params;
  const { as } = await searchParams;
  const ctx = await getAppContext();
  // An Architect 1.0 app (F9) has no plan: it keeps running as it is until someone moves it to 2.0.
  if (UUID.test(id)) {
    const db = await createServerDb();
    const { data: legacy } = await db.from("projects").select("id, name, workspace_id, legacy_repo, moved_to, updated_at").eq("id", id).not("legacy_repo", "is", null).maybeSingle();
    if (legacy) {
      const { data: moved } = legacy.moved_to ? await db.from("projects").select("id, name").eq("id", legacy.moved_to).maybeSingle() : { data: null };
      return <LegacyProject name={legacy.name} id={legacy.id} repo={legacy.legacy_repo!} movedTo={moved} canMove={canBuild(ctx.role) && legacy.workspace_id === ctx.workspace.id} />;
    }
  }
  const [nav, help] = await Promise.all([getNavData(ctx), getHelpContext(ctx)]);
  const project = await getProjectWorkspace(id, ctx, nav.credits.left, { catchUp: true });
  if (!project) notFound();
  if (project.otherWorkspace) return <SwitchWorkspaceCard name={project.name} workspace={project.otherWorkspace} />;
  const shown = viewingAs(project, as);
  if (shown.viewingAs) after(() => track("view_as_role", { user: ctx.user, workspaceId: ctx.workspace.id, projectId: project.id, detail: shown.viewingAs!.role }));
  return (
    <>
      <Workspace project={shown} />
      <HelpHost context={help} />
      <HelpLauncher projectId={project.id} />
      <ToastHost />
      <CommandPalette />
    </>
  );
}
