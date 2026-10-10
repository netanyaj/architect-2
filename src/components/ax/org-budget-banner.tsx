"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { BUDGET_STOPPED } from "@/lib/policies";
import { requestCapRaise } from "@/server/actions/policies";
import { Button } from "./button";
import { SimTag } from "./pill";
import { StageBanner } from "./stage-banner";

export type OrgBudgetView = { cap: number | null; spent: number; level: "none" | "ok" | "alert" | "stopped"; percent: number; raiseWaiting?: boolean };

/**
 * The organisation's monthly cap (C-7), where builders work: a line from 80%, and at 100% paid actions stop with the
 * fix as the primary: Raise the cap (Owners and Admins) or Ask to raise the cap (an approval request).
 */
export function OrgBudgetBanner({ budget, isAdmin, canBuild }: { budget: OrgBudgetView; isAdmin: boolean; canBuild: boolean }) {
  const router = useRouter();
  const id = useId();
  const [asking, setAsking] = useState(false);
  const [cap, setCap] = useState(String(budget.cap ? Math.ceil((budget.cap * 1.5) / 100) * 100 : 0));
  const [why, setWhy] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);
  if (budget.level !== "alert" && budget.level !== "stopped") return null;
  const used = `${Math.round(budget.spent).toLocaleString("en-GB")} of ${budget.cap!.toLocaleString("en-GB")} credits`;
  if (budget.level === "alert") {
    return (
      <p role="status" className="mb-2 flex flex-wrap items-center gap-2 rounded-card border-[1.5px] border-attention bg-surface px-4 py-2.5 text-small font-semibold text-attention">
        Your organisation has used {budget.percent}% of its monthly cap ({used}). Paid actions stop at 100%. <SimTag title="Budgets are enforced on the simulated spend." />
      </p>
    );
  }
  return (
    <StageBanner
      kind="paused"
      title="Paid actions are stopped"
      className="mb-2"
      actions={
        isAdmin ? (
          <Button variant="primary" href="/governance?section=budgets">
            Raise the cap
          </Button>
        ) : budget.raiseWaiting || sent ? (
          <span className="text-small font-semibold">Your request to raise the cap is waiting for an Owner or Admin.</span>
        ) : asking ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                setError(undefined);
                const r = await requestCapRaise({ cap: Number(cap), why });
                if (!r.ok) return setError(r.message);
                setSent(true);
                router.refresh();
              });
            }}
          >
            <label htmlFor={`${id}-cap`} className="flex flex-col gap-1 text-small font-semibold text-ink-2">
              New monthly cap (credits)
              <input id={`${id}-cap`} type="number" min={1} value={cap} onChange={(e) => setCap(e.target.value)} className="min-h-[38px] w-36 rounded-[12px] border border-line-ctl bg-surface px-3 text-body font-normal text-ink" />
            </label>
            <label htmlFor={`${id}-why`} className="flex min-w-0 flex-1 flex-col gap-1 text-small font-semibold text-ink-2">
              Why (optional)
              <input id={`${id}-why`} value={why} maxLength={300} onChange={(e) => setWhy(e.target.value)} className="min-h-[38px] rounded-[12px] border border-line-ctl bg-surface px-3 text-body font-normal text-ink" />
            </label>
            <Button type="submit" variant="primary" disabledReason={pending ? "Sending…" : undefined}>
              Send the request
            </Button>
            {error && (
              <p role="alert" className="w-full text-small font-semibold text-failed">
                {error}
              </p>
            )}
          </form>
        ) : (
          <Button variant="primary" disabledReason={canBuild ? undefined : "Viewers can't ask for a higher cap."} onClick={() => setAsking(true)}>
            Ask to raise the cap
          </Button>
        )
      }
    >
      {BUDGET_STOPPED} This month: {used}. What&apos;s built keeps working.
    </StageBanner>
  );
}
