import type { Metadata } from "next";
import { EmptyState } from "@/components/ax/empty-state";
import { SimTag } from "@/components/ax/pill";
import { canBuild, canManageMembers } from "@/lib/permissions";
import { connectRefusal, SCOPE_LABEL, scopeOf } from "@/lib/policies";
import { PROVIDERS } from "@/lib/providers";
import { createAdminDb, createServerDb } from "@/server/db";
import { loadPolicies } from "@/server/policy";
import { listProjects } from "@/server/queries";
import { getAppContext } from "@/server/workspace";
import { ConnectionsList, type ConnectionRow } from "./connections-list";

export const metadata: Metadata = { title: "Connections · Architect" };

export default async function ConnectionsPage() {
  const ctx = await getAppContext();
  const db = await createServerDb();
  const [{ data: connections }, policies, { data: approvals }, projects] = await Promise.all([
    db.from("connections").select("id, provider, status, scopes").eq("workspace_id", ctx.workspace.id).order("created_at"),
    loadPolicies(createAdminDb(), ctx.workspace.id),
    db.from("approvals").select("payload, status").eq("workspace_id", ctx.workspace.id).eq("kind", "connector").eq("status", "waiting"),
    listProjects(ctx),
  ]);
  // With governance on, apps not on the allowed list need an admin (C-3); off, nothing is held back.
  const blocked = (provider: string) => policies.governance && !policies.apps.allow.includes(provider);
  const isAdmin = canManageMembers(ctx.role);
  const waiting = new Set((approvals ?? []).map((a) => (a.payload as { provider?: string } | null)?.provider));

  const rows: ConnectionRow[] = (connections ?? []).map((c) => {
    const info = PROVIDERS[c.provider] ?? { name: c.provider, tool: c.provider, what: "" };
    return {
      id: c.id,
      name: info.name,
      what: info.what,
      usedBy: projects.filter((p) => p.tools.includes(info.tool)).map((p) => p.name),
      scope: policies.governance && !blocked(c.provider) ? SCOPE_LABEL[scopeOf(policies.apps, c.provider)] : undefined,
      state: c.status === "connected" ? "connected" : blocked(c.provider) ? (waiting.has(c.provider) ? "waiting" : "blocked") : c.status === "expired" ? "expired" : "missing",
    };
  });

  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-[22px] px-8 pt-10 pb-12 max-sm:px-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-[650]">Connections</h1>
        <p className="flex flex-wrap items-center gap-2 text-ink-2">
          Apps your projects can use. Connecting is simulated in this prototype: no real account is linked.
          <SimTag />
        </p>
      </div>
      {rows.length ? (
        <ConnectionsList rows={rows} access={{ canConnect: canBuild(ctx.role), refusal: connectRefusal(policies.apps, policies.governance, isAdmin), isAdmin }} />
      ) : (
        <EmptyState icon="connections" title="No apps connected yet">
          When a plan needs an app, it shows up here with what it&apos;s used for. Nothing connects without your click.
        </EmptyState>
      )}
    </div>
  );
}
