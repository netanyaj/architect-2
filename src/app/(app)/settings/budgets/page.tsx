import type { Metadata } from "next";
import Link from "next/link";
import { canManageMembers } from "@/lib/permissions";
import { listProjects } from "@/server/queries";
import { getAppContext } from "@/server/workspace";
import { BudgetsSection } from "../budgets-section";

export const metadata: Metadata = { title: "Budgets · Settings · Architect" };

/**
 * Settings › Budgets. Budgets live in one place: with governance on, Governance › Budgets has the monthly cap and every
 * project's budget, so this page only points there; with governance off, the per-project editor is here.
 */
export default async function BudgetsSettingsPage() {
  const ctx = await getAppContext();
  const manage = canManageMembers(ctx.role);
  if (ctx.workspace.governanceEnabled) {
    return (
      <section aria-labelledby="budgets" className="flex flex-col gap-3">
        <h2 id="budgets" className="text-heading font-[650]">
          Budgets
        </h2>
        <p className="rounded-card border border-line p-4">
          {manage ? (
            <>
              Owners and Admins set budgets in{" "}
              <Link href="/governance?section=budgets" className="font-semibold underline decoration-line-ctl underline-offset-[3px] hover:decoration-ink">
                Governance › Budgets
              </Link>
              .
            </>
          ) : (
            "Owners and Admins set budgets in Governance › Budgets."
          )}
        </p>
      </section>
    );
  }
  const projects = await listProjects(ctx);
  return <BudgetsSection canEdit={manage} projects={projects.map((p) => ({ id: p.id, name: p.name, budget: p.budgetCredits, spent: p.creditsUsed }))} />;
}
