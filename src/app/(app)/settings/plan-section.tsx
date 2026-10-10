"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ax/button";
import { SimTag } from "@/components/ax/pill";
import { StatusLine } from "@/components/ax/status-mark";
import { PLANS, type WorkspacePlan } from "@/lib/plans";
import { setWorkspacePlan } from "@/server/actions/launch";

/** Settings › Plan, simulated: four plans, no payment taken. Paid plans can hide "Built with Architect" on live apps. */
export function PlanSection({ plan, canEdit }: { plan: WorkspacePlan; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <section id="plan" aria-labelledby="plan-title" className="flex scroll-mt-6 flex-col gap-3">
      <h2 id="plan-title" className="flex items-center gap-2 text-heading font-[650]">
        Plan <SimTag title="Billing is simulated: switching plans takes no payment." />
      </h2>
      <p className="text-ink-2">Billing is simulated in this prototype: switching takes no payment. The plan decides whether live apps can hide “Built with Architect”.</p>
      <ul aria-label="Plans" className="grid gap-2.5 sm:grid-cols-2">
        {PLANS.map((p) => {
          const current = p.id === plan;
          return (
            <li key={p.id} className={current ? "flex flex-col gap-1.5 rounded-card border-[1.5px] border-ink bg-surface p-4" : "flex flex-col gap-1.5 rounded-card border border-line bg-surface p-4"}>
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{p.label}</span>
                <span className="text-small text-ink-2 tabular-nums">{p.price}</span>
              </span>
              <span className="text-small text-ink-2">{p.credits}</span>
              <span className="text-small text-ink-2">{p.badge}</span>
              {current ? (
                <StatusLine status="works">Your plan</StatusLine>
              ) : (
                <Button
                  size="sm"
                  className="self-start"
                  disabledReason={!canEdit ? "Only Owners and Admins can change the plan." : pending ? "Switching…" : undefined}
                  onClick={() =>
                    start(async () => {
                      setError(undefined);
                      const r = await setWorkspacePlan({ plan: p.id });
                      if (!r.ok) setError(r.message);
                      router.refresh();
                    })
                  }
                >
                  Switch to {p.label}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="text-small font-semibold text-failed">
          {error}
        </p>
      )}
    </section>
  );
}
