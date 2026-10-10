"use server";

import { canBuild } from "@/lib/permissions";
import { listLyzrAgents, lyzrConfigured, type StudioAgent } from "../lyzr";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";

/* Attach agent (BL-2): the Lyzr Studio agents a new project can use instead of building its own. Real when a Lyzr
   key is set (Studio's agent list, the prototype's shared Studio account); otherwise a sample list, tagged Simulated. */

const SAMPLE_AGENTS: StudioAgent[] = [
  { id: "sample-research", name: "Research agent", description: "Looks up a company and its people on the web, and summarises what it finds." },
  { id: "sample-support", name: "Support triage agent", description: "Labels a ticket's urgency and team, and drafts a reply for simple ones." },
  { id: "sample-sql", name: "Data analyst", description: "Answers questions about a table by writing and running SQL." },
];

export async function studioAgents(): Promise<ActionResult<{ agents: StudioAgent[]; simulated: boolean; note?: string }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't start projects." };
  if (!lyzrConfigured().perAgent) return { ok: true, agents: SAMPLE_AGENTS, simulated: true, note: "Lyzr Studio isn't connected here, so these are sample agents." };
  try {
    return { ok: true, agents: await listLyzrAgents(), simulated: false };
  } catch {
    return { ok: true, agents: SAMPLE_AGENTS, simulated: true, note: "Lyzr Studio didn't answer, so these are sample agents. Try again later for yours." };
  }
}
