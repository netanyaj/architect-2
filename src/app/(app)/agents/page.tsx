import type { Metadata } from "next";
import { Button } from "@/components/ax/button";
import { EmptyState } from "@/components/ax/empty-state";
import { ListRow, Tray } from "@/components/ax/list-row";
import { createServerDb } from "@/server/db";
import { getAppContext } from "@/server/workspace";
import { AgentGlyph } from "@/components/ax/AgentGlyph";
import { EmptyMosaic } from "@/components/ax/MosaicThumb";
import { agentRole } from "@/lib/brand";
import { SimTag } from "@/components/ax/pill";
import { parseSchedule, scheduleWords } from "@/lib/schedule";

export const metadata: Metadata = { title: "Agents · Architect" };

const FRAMEWORK: Record<string, string> = { lyzr: "Lyzr", crewai: "CrewAI", langgraph: "LangGraph" };

/** Every agent in the workspace, across projects. Editing an agent happens inside its project (M4). */
export default async function AgentsPage() {
  const ctx = await getAppContext();
  const db = await createServerDb();
  const { data: agents } = await db
    .from("agents")
    .select("id, name, description, framework, model, tools, project_id, schedule, projects(name)")
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
          {agents.map((a) => {
            // A saved schedule (round 7, Simulated); one read from the plan shows in the project.
            const schedule = parseSchedule(a.schedule);
            const meta = `${FRAMEWORK[a.framework] ?? a.framework} · ${a.model}${a.projects?.name ? ` · in ${a.projects.name}` : ""}`;
            return (
              <ListRow
                key={a.id}
                icon="agent"
                picture={<AgentGlyph role={agentRole(a.name, a.description ?? "")} size={34} />}
                name={a.name}
                meta={
                  schedule && schedule !== "off" ? (
                    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                      {meta} · {scheduleWords(schedule)}
                      <SimTag title="Nothing runs on the clock in this prototype. Real schedules would run in the cell's orchestrator." />
                    </span>
                  ) : (
                    meta
                  )
                }
                tools={a.tools}
                href={a.project_id ? `/p/${a.project_id}?view=agents` : undefined}
              />
            );
          })}
        </Tray>
      ) : (
        <EmptyState icon="agent" picture={<EmptyMosaic seed="agents" />} title="No agents yet" primary={<Button variant="primary" href="/home">Describe an app</Button>}>
          Agents appear here when a plan includes one, like a brief writer or a ticket sorter. Nothing is built until you click Build.
        </EmptyState>
      )}
    </div>
  );
}
