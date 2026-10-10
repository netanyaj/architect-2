import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { modelAvailability } from "@/lib/gateway";
import { canManageMembers } from "@/lib/permissions";
import { knownApps } from "@/lib/policies";
import { createAdminDb } from "@/server/db";
import { loadPolicies, projectFlows } from "@/server/policy";
import { getAppContext } from "@/server/workspace";
import { GovernanceView, type Section } from "./governance-view";

export const metadata: Metadata = { title: "Governance · Architect" };

const SECTIONS: Section[] = ["location", "models", "apps", "egress"];

/** The organisation's policies (C-1 to C-4), master–detail like screen 11. Owners and Admins, governance on. */
export default async function GovernancePage({ searchParams }: PageProps<"/governance">) {
  const ctx = await getAppContext();
  if (!canManageMembers(ctx.role) || !ctx.workspace.governanceEnabled) notFound();
  const sp = await searchParams;
  const admin = createAdminDb();
  const [policies, { data: used }, { data: projects }] = await Promise.all([
    loadPolicies(admin, ctx.workspace.id),
    admin.from("items").select("provider, projects!inner(workspace_id)").eq("projects.workspace_id", ctx.workspace.id).not("provider", "is", null),
    admin.from("projects").select("id, name").eq("workspace_id", ctx.workspace.id).order("updated_at", { ascending: false }),
  ]);
  const { stored } = policies;
  // Every project's data flow (C-4), for the Data and egress section.
  const flows = await Promise.all((projects ?? []).map(async (p) => ({ id: p.id, name: p.name, paths: await projectFlows(admin, p.id, policies) })));
  const section = SECTIONS.includes(sp.section as Section) ? (sp.section as Section) : "location";
  return (
    <GovernanceView
      workspaceName={ctx.workspace.name}
      initialSection={section}
      location={stored.location}
      models={stored.models}
      apps={stored.apps}
      egress={stored.egress}
      flows={flows}
      availability={modelAvailability()}
      known={knownApps((used ?? []).map((i) => i.provider as string))}
    />
  );
}
