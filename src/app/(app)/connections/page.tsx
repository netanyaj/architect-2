import type { Metadata } from "next";
import { EmptyState } from "@/components/ax/empty-state";
import { SimTag } from "@/components/ax/pill";
import { canBuild, canManageMembers } from "@/lib/permissions";
import { connectRefusal, SCOPE_LABEL, scopeOf } from "@/lib/policies";
import { serviceHost } from "@/lib/approvals";
import { relativeTime } from "@/lib/project-status";
import { PROVIDERS, providerName } from "@/lib/providers";
import { createAdminDb, createServerDb } from "@/server/db";
import { blockedServices, loadPolicies } from "@/server/policy";
import { listProjects } from "@/server/queries";
import { getAppContext } from "@/server/workspace";
import { AppsSection, ConnectionsList, type ConnectionRow } from "./connections-list";
import { EmptyMosaic } from "@/components/ax/MosaicThumb";
import { lyzrKeyStatus } from "@/server/lyzr-key";
import { LyzrCard } from "./lyzr-card";
import { McpServers } from "./mcp-servers";
import type { McpConnection } from "@/lib/mcp-connections";

export const metadata: Metadata = { title: "Connections · Architect" };

export default async function ConnectionsPage() {
  const ctx = await getAppContext();
  const db = await createServerDb();
  const [{ data: connections }, policies, { data: approvals }, projects, lyzr] = await Promise.all([
    db.from("connections").select("id, provider, status, scopes, kind, set_by_name, set_at, name, url, tools, checked_at, check_error").eq("workspace_id", ctx.workspace.id).order("created_at"),
    loadPolicies(createAdminDb(), ctx.workspace.id),
    db.from("approvals").select("payload, status").eq("workspace_id", ctx.workspace.id).eq("kind", "connector").eq("status", "waiting"),
    listProjects(ctx),
    lyzrKeyStatus(createAdminDb(), ctx.workspace.id),
  ]);
  // With governance on, apps not on the allowed list, or allowed everywhere by a rule, need an admin (C-3).
  const held = new Set(await blockedServices(createAdminDb(), ctx.workspace.id, null, (connections ?? []).map((c) => c.provider), policies));
  const blocked = (provider: string) => held.has(provider);
  const isAdmin = canManageMembers(ctx.role);
  const waiting = new Set((approvals ?? []).map((a) => (a.payload as { provider?: string } | null)?.provider));

  // MCP servers (M6) have their own section; the rest are apps.
  const mcp: McpConnection[] = (connections ?? [])
    .filter((c) => c.kind === "mcp")
    .map((c) => ({
      id: c.id,
      name: c.name ?? c.url ?? "MCP server",
      url: c.url ?? "",
      tools: ((c.tools ?? []) as { name: string }[]).map((t) => t.name),
      checkedAt: c.checked_at,
      error: c.check_error,
      connected: c.status === "connected",
    }));
  const rows: ConnectionRow[] = (connections ?? []).filter((c) => c.kind !== "mcp").map((c) => {
    const name = providerName(c.provider);
    const info = PROVIDERS[c.provider] ?? { name, tool: name, what: "" };
    if (c.kind === "api_key") {
      return {
        id: c.id,
        kind: "api_key",
        name,
        what: `Called with an API key at ${serviceHost(c.provider).host}.`,
        usedBy: projects.filter((p) => p.providers.includes(c.provider)).map((p) => p.name),
        setBy: c.status === "connected" && c.set_by_name ? `${c.set_by_name} · ${relativeTime(c.set_at ?? "")}` : undefined,
        state: c.status === "connected" ? "connected" : blocked(c.provider) ? "blocked" : "missing",
      };
    }
    return {
      id: c.id,
      kind: "oauth",
      name: info.name,
      what: info.what,
      usedBy: projects.filter((p) => p.tools.includes(info.tool)).map((p) => p.name),
      scope: policies.governance && !blocked(c.provider) ? SCOPE_LABEL[scopeOf(policies.apps, c.provider)] : undefined,
      state: c.status === "connected" ? "connected" : blocked(c.provider) ? (waiting.has(c.provider) ? "waiting" : "blocked") : c.status === "expired" ? "expired" : "missing",
    };
  });

  return (
    <div data-tour="connections" className="mx-auto flex w-full max-w-[1040px] flex-col gap-[22px] px-8 pt-10 pb-12 max-sm:px-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-[650]">Connections</h1>
        <p className="flex flex-wrap items-center gap-2 text-ink-2">
          Apps your projects can use, by signing in, with an API key, or over MCP. Connecting apps is simulated in this prototype: no real account is linked, and a key you add for an app is checked and thrown away. Lyzr Studio and MCP Test connection are real.
          <SimTag title="Apps connect for real in the product; here only Lyzr Studio does." />
        </p>
      </div>
      {/* Three sections, in this order: Lyzr Studio, Apps, MCP servers. */}
      <LyzrCard status={lyzr} isAdmin={isAdmin} />
      <AppsSection canAdd={canBuild(ctx.role)} refusal={connectRefusal(policies.apps, policies.governance, isAdmin)}>
        {rows.length ? (
          <ConnectionsList rows={rows} access={{ canConnect: canBuild(ctx.role), refusal: connectRefusal(policies.apps, policies.governance, isAdmin), isAdmin }} />
        ) : (
          <EmptyState icon="connections" picture={<EmptyMosaic seed="connections" />} title="No apps connected yet">
            When a plan needs an app, it shows up here with what it&apos;s used for. Nothing connects without your click.
          </EmptyState>
        )}
      </AppsSection>
      <McpServers servers={mcp} canAct={canBuild(ctx.role)} refusal={connectRefusal(policies.apps, policies.governance, isAdmin)} governance={policies.governance} allowed={policies.governance ? policies.apps.mcp : []} />
    </div>
  );
}
