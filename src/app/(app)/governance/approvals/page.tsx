import type { Metadata } from "next";
import { EmptyState } from "@/components/ax/empty-state";
import { ListRow, Tray } from "@/components/ax/list-row";
import { SimTag } from "@/components/ax/pill";
import { StatusWord } from "@/components/ax/status-mark";
import { canManageMembers } from "@/lib/permissions";
import { relativeTime } from "@/lib/project-status";
import { createServerDb } from "@/server/db";
import { getAppContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Approvals · Architect" };

const KIND: Record<string, string> = { connector: "App connection", deploy: "Live deploy", token: "Coding agent token", budget: "Budget" };

/** The approval queue, read-only for now. Approving or rejecting with a reason comes in M5 (screen 11). */
export default async function ApprovalsPage() {
  const ctx = await getAppContext();
  if (!canManageMembers(ctx.role)) {
    return (
      <EmptyState icon="approvals" title="Approvals are for admins">
        Only Owners and Admins decide on requests. You&apos;ll see the answer on the project that asked.
      </EmptyState>
    );
  }
  const db = await createServerDb();
  const { data: approvals } = await db
    .from("approvals")
    .select("id, kind, title, status, created_at, payload")
    .eq("workspace_id", ctx.workspace.id)
    .order("created_at", { ascending: false });
  const waiting = (approvals ?? []).filter((a) => a.status === "waiting");

  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-[22px] px-8 pt-10 pb-12 max-sm:px-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-[650]">Approvals</h1>
        <p className="flex flex-wrap items-center gap-2 text-ink-2">
          {waiting.length} waiting. Approving or rejecting with a reason comes in M5; the requests are simulated.
          <SimTag />
        </p>
      </div>
      {approvals?.length ? (
        <Tray label="Approval requests">
          {approvals.map((a) => {
            const by = (a.payload as { requested_by_name?: string } | null)?.requested_by_name;
            return (
              <ListRow
                key={a.id}
                icon="approvals"
                name={a.title}
                meta={`${KIND[a.kind] ?? a.kind}${by ? ` · asked by ${by}` : ""} · ${relativeTime(a.created_at)}`}
                status={
                  a.status === "waiting" ? (
                    <StatusWord status="approval">Waiting for a decision</StatusWord>
                  ) : a.status === "approved" ? (
                    <StatusWord status="works">Approved</StatusWord>
                  ) : (
                    <StatusWord status="blocked">Rejected</StatusWord>
                  )
                }
              />
            );
          })}
        </Tray>
      ) : (
        <EmptyState icon="approvals" title="Nothing waiting">
          When a project asks for something your policies hold back, like a new app or a Live deploy, it shows up here.
        </EmptyState>
      )}
    </div>
  );
}
