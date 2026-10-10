import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { modelAvailability } from "@/lib/gateway";
import { canManageMembers } from "@/lib/permissions";
import { knownApps } from "@/lib/policies";
import { createAdminDb } from "@/server/db";
import { loadPolicies } from "@/server/policy";
import { getAppContext } from "@/server/workspace";
import { GovernanceView, type Section } from "./governance-view";

export const metadata: Metadata = { title: "Governance · Architect" };

const SECTIONS: Section[] = ["location", "models", "apps"];

/** The organisation's policies (C-1 to C-3), master–detail like screen 11. Owners and Admins, governance on. */
export default async function GovernancePage({ searchParams }: PageProps<"/governance">) {
  const ctx = await getAppContext();
  if (!canManageMembers(ctx.role) || !ctx.workspace.governanceEnabled) notFound();
  const sp = await searchParams;
  const admin = createAdminDb();
  const [{ stored }, { data: used }] = await Promise.all([
    loadPolicies(admin, ctx.workspace.id),
    admin.from("items").select("provider, projects!inner(workspace_id)").eq("projects.workspace_id", ctx.workspace.id).not("provider", "is", null),
  ]);
  const section = SECTIONS.includes(sp.section as Section) ? (sp.section as Section) : "location";
  return (
    <GovernanceView
      workspaceName={ctx.workspace.name}
      initialSection={section}
      location={stored.location}
      models={stored.models}
      apps={stored.apps}
      availability={modelAvailability()}
      known={knownApps((used ?? []).map((i) => i.provider as string))}
    />
  );
}
