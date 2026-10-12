import type { Metadata } from "next";
import { canManageMembers } from "@/lib/permissions";
import { getAppContext } from "@/server/workspace";
import { GovernanceSection } from "../governance-section";

export const metadata: Metadata = { title: "Governance · Settings · Architect" };

/** Settings › Governance: the switch. The rules themselves are on the Governance pages. */
export default async function GovernanceSettingsPage() {
  const ctx = await getAppContext();
  return <GovernanceSection on={ctx.workspace.governanceEnabled} canEdit={canManageMembers(ctx.role)} />;
}
