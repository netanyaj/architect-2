"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ax/button";
import { Icon } from "@/components/ax/icon";
import { SimTag, Tag } from "@/components/ax/pill";
import { Segmented } from "@/components/ax/segmented";
import { StatusLine } from "@/components/ax/status-mark";
import { PLANS, TOP_UPS, type WorkspacePlan } from "@/lib/plans";
import { setWorkspacePlan, topUpCredits } from "@/server/actions/launch";

/**
 * Settings › General (simulated: no payment is taken). Today's Architect plans, Free, Starter, Pro and Custom, with
 * monthly or yearly prices, credits, what each includes and what's coming; a credit top-up; and the Enterprise extras
 * 2.0 adds. Owners and Admins switch plans and buy credits.
 */
export function PlanSection({ plan, canEdit, credits }: { plan: WorkspacePlan; canEdit: boolean; credits: { left: number; total: number } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, done: string) =>
    start(async () => {
      setError(undefined);
      setNote(undefined);
      const r = await fn();
      if (!r.ok) return setError(r.message);
      setNote(done);
      router.refresh();
    });
  const reason = !canEdit ? "Only Owners and Admins can change the plan or buy credits." : pending ? "Saving…" : undefined;
  return (
    <section id="plan" aria-labelledby="plan-title" className="flex scroll-mt-6 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="plan-title" className="flex-1 text-heading font-[650]">
          Plan
        </h2>
        <SimTag title="Billing is simulated: switching plans or buying credits takes no payment." />
        <Segmented
          mode="filter"
          label="Billing"
          value={billing}
          onChange={setBilling}
          options={[
            { value: "monthly", label: "Monthly" },
            { value: "annual", label: "Yearly" },
          ]}
        />
      </div>
      <p className="text-ink-2">The plans today&apos;s Architect has. No payment is taken in this prototype.</p>
      <ul aria-label="Plans" className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((p) => {
          const current = p.id === plan;
          return (
            <li key={p.id} className={current ? "flex flex-col gap-2 rounded-card border-[1.5px] border-ink bg-surface p-4" : "flex flex-col gap-2 rounded-card border border-line bg-surface p-4"}>
              <span className="flex items-center gap-2">
                <span className="font-semibold">{p.label}</span>
                {p.popular && <Tag>Popular</Tag>}
              </span>
              <span className="font-[650] tabular-nums">{billing === "annual" ? p.annual : p.monthly}</span>
              {billing === "annual" && p.saves && <span className="text-small text-ink-2">{p.saves}</span>}
              <span className="text-small font-semibold">{p.credits}</span>
              <ul className="flex flex-col gap-1 text-small">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-1.5">
                    <Icon name="check" size="sm" className="mt-0.5 flex-none" />
                    {f}
                  </li>
                ))}
                {p.soon.map((f) => (
                  <li key={f} className="flex items-start gap-1.5 text-ink-2">
                    <span className="mt-0.5 rounded-full border border-line-ctl px-1.5 text-[11px] leading-4 font-semibold">Soon</span>
                    {f}
                  </li>
                ))}
              </ul>
              <span className="mt-auto pt-1">
                {current ? (
                  <StatusLine status="works">Your plan</StatusLine>
                ) : (
                  <Button size="sm" disabledReason={reason} onClick={() => run(() => setWorkspacePlan({ plan: p.id }), `You're on ${p.label} now.`)}>
                    {p.id === "enterprise" ? "Talk to us" : `Switch to ${p.label}`}
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-2 rounded-card border border-line p-4">
        <h3 className="font-semibold">Top up credits</h3>
        <p className="text-small text-ink-2">
          {credits.left.toLocaleString("en-US")} of {credits.total.toLocaleString("en-US")} credits left this month. A top-up adds to this month&apos;s allowance.
        </p>
        <div className="flex flex-wrap gap-2">
          {TOP_UPS.map((t) => (
            <Button key={t.credits} size="sm" disabledReason={reason} onClick={() => run(() => topUpCredits({ credits: t.credits }), `Added ${t.credits.toLocaleString("en-US")} credits.`)}>
              {t.credits.toLocaleString("en-US")} credits · {t.price}
            </Button>
          ))}
        </div>
      </div>
      {note && (
        <p role="status" className="text-small font-semibold">
          {note}
        </p>
      )}
      {error && (
        <p role="alert" className="text-small font-semibold text-failed">
          {error}
        </p>
      )}
    </section>
  );
}
