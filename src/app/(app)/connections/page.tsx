import type { Metadata } from "next";
import { EmptyState } from "@/components/ax/empty-state";
import { SimTag } from "@/components/ax/pill";
import { canBuild } from "@/lib/permissions";
import { createServerDb } from "@/server/db";
import { listProjects } from "@/server/queries";
import { getAppContext } from "@/server/workspace";
import { ConnectionsList, type ConnectionRow } from "./connections-list";

export const metadata: Metadata = { title: "Connections · Architect" };

const PROVIDERS: Record<string, { name: string; tool: string; what: string }> = {
  google_calendar: { name: "Google Calendar", tool: "Calendar", what: "Reads your meetings and who's coming." },
  gmail: { name: "Gmail", tool: "Gmail", what: "Reads email threads you choose. Never sends without asking." },
  slack: { name: "Slack", tool: "Slack", what: "Posts messages to channels and DMs." },
  hubspot: { name: "HubSpot", tool: "HubSpot", what: "Reads leads, companies and deals." },
  zendesk: { name: "Zendesk", tool: "Zendesk", what: "Reads tickets and drafts replies." },
  github: { name: "GitHub", tool: "GitHub", what: "Reads the repos you pick." },
};

export default async function ConnectionsPage() {
  const ctx = await getAppContext();
  const db = await createServerDb();
  const [{ data: connections }, { data: policy }, { data: approvals }, projects] = await Promise.all([
    db.from("connections").select("id, provider, status, scopes").eq("workspace_id", ctx.workspace.id).order("created_at"),
    db.from("policies").select("config").eq("workspace_id", ctx.workspace.id).eq("kind", "connectors").maybeSingle(),
    db.from("approvals").select("payload, status").eq("workspace_id", ctx.workspace.id).eq("kind", "connector").eq("status", "waiting"),
    listProjects(ctx),
  ]);
  const deny = (policy?.config as { deny?: string[] } | null)?.deny ?? [];
  const waiting = new Set((approvals ?? []).map((a) => (a.payload as { provider?: string } | null)?.provider));

  const rows: ConnectionRow[] = (connections ?? []).map((c) => {
    const info = PROVIDERS[c.provider] ?? { name: c.provider, tool: c.provider, what: "" };
    return {
      id: c.id,
      name: info.name,
      what: info.what,
      usedBy: projects.filter((p) => p.tools.includes(info.tool)).map((p) => p.name),
      state: c.status === "connected" ? "connected" : deny.includes(c.provider) ? (waiting.has(c.provider) ? "waiting" : "blocked") : c.status === "expired" ? "expired" : "missing",
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
        <ConnectionsList rows={rows} canConnect={canBuild(ctx.role)} />
      ) : (
        <EmptyState icon="connections" title="No apps connected yet">
          When a plan needs an app, it shows up here with what it&apos;s used for. Nothing connects without your click.
        </EmptyState>
      )}
    </div>
  );
}
