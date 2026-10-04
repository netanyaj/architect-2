"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ax/button";
import { setProjectBudget } from "@/server/actions/projects";

export type BudgetRow = { id: string; name: string; budget: number | null; spent: number };

function BudgetItem({ p, canEdit }: { p: BudgetRow; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const inputId = useId();

  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const raw = String(new FormData(e.currentTarget).get("budget") ?? "").trim();
    const credits = raw === "" ? null : Number(raw.replace(/,/g, ""));
    if (credits !== null && !Number.isFinite(credits)) {
      setMessage({ ok: false, text: "Use a number of credits, or leave it empty for no budget." });
      return;
    }
    start(async () => {
      const r = await setProjectBudget({ projectId: p.id, credits });
      setMessage(r.ok ? { ok: true, text: credits === null ? "No budget now." : "Saved." } : { ok: false, text: r.message });
    });
  };

  return (
    <li className="flex flex-col gap-1.5 rounded-card border border-line bg-surface px-4 py-3">
      <form onSubmit={save} className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-[180px] flex-1 flex-col">
          <span className="font-semibold">{p.name}</span>
          <span className="text-small text-ink-2 tabular-nums">{p.spent.toLocaleString("en-US")} credits spent so far</span>
        </div>
        <label htmlFor={inputId} className="sr-only">
          Budget for {p.name}, in credits
        </label>
        {canEdit ? (
          <>
            <span className="inline-flex items-center gap-2">
              <input
                id={inputId}
                name="budget"
                inputMode="numeric"
                defaultValue={p.budget ?? ""}
                placeholder="No budget"
                className="min-h-8 w-[110px] rounded-full border border-line-ctl bg-surface px-3 text-right tabular-nums placeholder:text-left placeholder:text-ink-3"
              />
              <span className="text-small text-ink-2">credits</span>
            </span>
            <Button size="sm" type="submit" disabledReason={pending ? "Saving…" : undefined}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </>
        ) : (
          <span className="tabular-nums">{p.budget === null ? "No budget" : `${p.budget.toLocaleString("en-US")} credits`}</span>
        )}
      </form>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-small text-ink-2" : "text-small font-semibold text-failed"}>
          {message.text}
        </p>
      )}
    </li>
  );
}

/** Per-project budgets. The build pauses when a project reaches its budget; finished parts are kept. */
export function BudgetsSection({ projects, canEdit }: { projects: BudgetRow[]; canEdit: boolean }) {
  return (
    <section aria-labelledby="budgets" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id="budgets" className="text-heading font-[650]">
          Budgets
        </h2>
        <p className="text-ink-2">
          A build pauses when its project reaches its budget. Finished parts are kept, and you choose what happens next.
          {!canEdit && " Only Owners and Admins can change budgets."}
        </p>
      </div>
      {projects.length ? (
        <ul aria-label="Project budgets" className="flex flex-col gap-1.5 rounded-pane border border-line bg-tray p-1.5">
          {projects.map((p) => (
            <BudgetItem key={p.id} p={p} canEdit={canEdit} />
          ))}
        </ul>
      ) : (
        <p className="rounded-card bg-tray px-4 py-5 text-ink-2">No projects yet. Budgets appear here once you start one.</p>
      )}
    </section>
  );
}
