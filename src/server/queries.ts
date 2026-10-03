import "server-only";

import { createServerDb } from "./db";
import type { AppContext } from "./workspace";

/** First day of the current credit period, given the reset date (credits reset monthly). */
export function periodStart(resetOn: string): string {
  const reset = new Date(`${resetOn}T00:00:00Z`);
  const start = new Date(Date.UTC(reset.getUTCFullYear(), reset.getUTCMonth() - 1, reset.getUTCDate()));
  return start.toISOString();
}

/** "2026-11-01" → "1 Nov" */
export function formatResetDate(resetOn: string): string {
  const d = new Date(`${resetOn}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** What the side nav shows: counts and credits, all from the database under RLS. */
export async function getNavData(ctx: AppContext) {
  const db = await createServerDb();
  const ws = ctx.workspace.id;
  const [projects, approvals, usage] = await Promise.all([
    db.from("projects").select("id", { count: "exact", head: true }).eq("workspace_id", ws),
    db.from("approvals").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("status", "waiting"),
    db.from("usage_ledger").select("credits").eq("workspace_id", ws).gte("created_at", periodStart(ctx.workspace.creditsResetOn)),
  ]);
  const used = (usage.data ?? []).reduce((sum, r) => sum + Number(r.credits), 0);
  return {
    projectCount: projects.count ?? 0,
    approvalsWaiting: approvals.count ?? 0,
    credits: {
      left: Math.max(0, Math.round(ctx.workspace.creditsTotal - used)),
      total: ctx.workspace.creditsTotal,
      resetsOn: formatResetDate(ctx.workspace.creditsResetOn),
    },
  };
}
