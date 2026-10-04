import type { Metadata } from "next";
import { Button } from "@/components/ax/button";
import { EmptyState } from "@/components/ax/empty-state";
import { ListRow, Tray } from "@/components/ax/list-row";
import { createServerDb } from "@/server/db";
import { getAppContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Agents · Architect" };

const FRAMEWORK: Record<string, string> = { lyzr: "Lyzr", crewai: "CrewAI", langgraph: "LangGraph" };

/** Every agent in the workspace, across projects. Editing an agent happens inside its project (M4). */
export default async function AgentsPage() {
  const ctx = await getAppContext();
  const db = await createServerDb();
  const { data: agents } = await db
    .from("agents")
    .select("id, name, framework, model, tools, project_id, projects(name)")
    .eq("workspace_id", ctx.workspace.id)
    .order("name");

  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-[22px] px-8 pt-10 pb-12 max-sm:px-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-[650]">Agents</h1>
        <p className="text-ink-2">The AI agents inside your apps, in one list.</p>
      </div>
      {agents?.length ? (
        <Tray label="Agents">
          {agents.map((a) => (
            <ListRow
              key={a.id}
              icon="agent"
              name={a.name}
              meta={`${FRAMEWORK[a.framework] ?? a.framework} · ${a.model}${a.projects?.name ? ` · in ${a.projects.name}` : ""}`}
              tools={a.tools}
              href={a.project_id ? `/p/${a.project_id}?view=agents` : undefined}
            />
          ))}
        </Tray>
      ) : (
        <EmptyState icon="agent" title="No agents yet" primary={<Button variant="primary" href="/home">Describe an app</Button>}>
          Agents appear here when a plan includes one, like a brief writer or a ticket sorter. Nothing is built until you click Build.
        </EmptyState>
      )}
    </div>
  );
}
