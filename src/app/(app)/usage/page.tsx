import type { Metadata } from "next";
import { SimTag } from "@/components/ax/pill";
import { createServerDb } from "@/server/db";
import { formatResetDate, periodStart } from "@/server/queries";
import { getAppContext } from "@/server/workspace";
import { UsageTable, type LedgerRow } from "./usage-table";

export const metadata: Metadata = { title: "Usage · Architect" };

const KIND: Record<string, string> = { build: "Build", fix: "Fix", change: "Change", running: "Running", blueprint: "Plan" };

export default async function UsagePage() {
  const ctx = await getAppContext();
  const db = await createServerDb();
  const { data, error } = await db
    .from("usage_ledger")
    .select("id, kind, credits, note, created_at, projects(name)")
    .eq("workspace_id", ctx.workspace.id)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`Couldn't load usage: ${error.message}`);

  const rows: LedgerRow[] = (data ?? []).map((r) => ({
    id: r.id,
    at: r.created_at,
    project: r.projects?.name ?? "Workspace",
    kind: KIND[r.kind] ?? r.kind,
    note: r.note ?? "",
    credits: Number(r.credits),
  }));
  const start = periodStart(ctx.workspace.creditsResetOn);
  const used = Math.round(rows.filter((r) => r.at >= start).reduce((s, r) => s + r.credits, 0));
  const fixes = Math.round(rows.filter((r) => r.at >= start && r.kind === "Fix").reduce((s, r) => s + r.credits, 0));
  const left = Math.max(0, ctx.workspace.creditsTotal - used);

  const stat = (label: string, value: string, sub?: string) => (
    <div className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4">
      <span className="text-small font-[650] text-ink-2">{label}</span>
      <span className="text-heading font-[650] tabular-nums">{value}</span>
      {sub && <span className="text-small text-ink-2">{sub}</span>}
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-[22px] px-8 pt-10 pb-12 max-sm:px-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-[650]">Usage</h1>
        <p className="flex flex-wrap items-center gap-2 text-ink-2">
          Every credit spent, line by line. Fixes are their own lines, so you can see what fixing cost. Build and fix lines
          come from the simulated build.
          <SimTag />
        </p>
      </div>
      <div data-tour="usage-totals" className="grid gap-3 sm:grid-cols-3">
        {stat("Credits left", `${left.toLocaleString("en-US")} / ${ctx.workspace.creditsTotal.toLocaleString("en-US")}`, `Resets ${formatResetDate(ctx.workspace.creditsResetOn)}`)}
        {stat("Used this month", used.toLocaleString("en-US"), "Plans, builds, fixes and running apps")}
        {stat("Spent on fixes", fixes.toLocaleString("en-US"), "Up to 3 tries per part, then it stops")}
      </div>
      <UsageTable rows={rows} />
    </div>
  );
}
