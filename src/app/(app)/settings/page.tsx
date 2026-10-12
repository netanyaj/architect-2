import type { Metadata } from "next";
import { canManageMembers } from "@/lib/permissions";
import { getNavData } from "@/server/queries";
import { getAppContext } from "@/server/workspace";
import { PlanSection } from "./plan-section";

export const metadata: Metadata = { title: "General · Settings · Architect" };

/** Settings › General: the workspace's name, its plan and its credits. */
export default async function GeneralSettingsPage() {
  const ctx = await getAppContext();
  const nav = await getNavData(ctx);
  return (
    <>
      <section aria-labelledby="general" className="flex flex-col gap-3">
        <h2 id="general" className="text-heading font-[650]">
          General
        </h2>
        <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-y-1.5 rounded-card border border-line p-4">
          <dt className="text-ink-2">Workspace</dt>
          <dd className="truncate font-semibold">{ctx.workspace.name}</dd>
          <dt className="text-ink-2">Kind</dt>
          <dd>{ctx.workspace.kind === "personal" ? "Personal: just you" : "Team workspace"}</dd>
        </dl>
      </section>
      <PlanSection plan={ctx.workspace.plan} canEdit={canManageMembers(ctx.role)} credits={{ left: nav.credits.left, total: nav.credits.total }} />
    </>
  );
}
