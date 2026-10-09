import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/ax/icon";
import { canBuild, canManageMembers } from "@/lib/permissions";
import { createServerDb } from "@/server/db";
import { getAppContext } from "@/server/workspace";
import { CodingAgents, type TokenRow } from "./coding-agents";

export const metadata: Metadata = { title: "Project settings · Architect" };

/** Project settings: Coding agents (F4), the project tokens a coding agent would use with Architect's MCP server. */
export default async function ProjectSettingsPage({ params }: PageProps<"/p/[id]/settings">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getAppContext();
  const db = await createServerDb();
  const { data: project } = await db.from("projects").select("id, name, workspace_id").eq("id", id).maybeSingle();
  if (!project || project.workspace_id !== ctx.workspace.id) notFound();
  const { data: tokens } = await db
    .from("project_tokens")
    .select("id, name, scopes, last4, status, created_at, revoked_at")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false });
  const rows: TokenRow[] = (tokens ?? []).map((t) => ({ id: t.id, name: t.name, scopes: t.scopes, last4: t.last4, status: t.status as TokenRow["status"], createdAt: t.created_at }));
  return (
    <div className="min-h-dvh bg-canvas p-2.5">
      <header className="flex min-h-[66px] items-center gap-3 px-1 py-2">
        <Link href={`/p/${project.id}`} aria-label={`Back to ${project.name}`} className="grid size-[38px] place-items-center rounded-full hover:bg-selected">
          <Icon name="chevronLeft" size="sm" />
        </Link>
        <h1 className="text-sub font-semibold">{project.name} · Project settings</h1>
      </header>
      <main className="rounded-pane border border-line bg-surface shadow-pane">
        <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8 px-8 pt-10 pb-12 max-sm:px-4">
          <CodingAgents
            projectId={project.id}
            tokens={rows}
            governance={ctx.workspace.governanceEnabled}
            canCreate={canBuild(ctx.role)}
            canApprove={canManageMembers(ctx.role)}
          />
        </div>
      </main>
    </div>
  );
}
