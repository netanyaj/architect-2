import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TextLink } from "@/components/ax/button";
import { SimTag } from "@/components/ax/pill";
import { SettingRow } from "@/components/ax/toggle";
import { canManageMembers } from "@/lib/permissions";
import { createServerDb } from "@/server/db";
import { getAppContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Governance · Architect" };

const KIND: Record<string, string> = {
  location: "Where apps run",
  models: "Allowed models",
  connectors: "Allowed apps",
  egress: "Where data can go",
  budget: "Org budget",
  permission: "Needs approval",
};

function describe(kind: string, config: Record<string, unknown>): string {
  const list = (v: unknown) => (Array.isArray(v) ? v.join(", ") : "");
  switch (kind) {
    case "location":
      return String(config.label ?? config.mode ?? "");
    case "models":
      return list(config.allowed);
    case "connectors":
      return `${list(config.allow)}${config.deny ? ` · blocked: ${list(config.deny)}` : ""}`;
    case "egress":
      return list(config.hosts);
    case "permission":
      return list(config.needs_approval).replace(/_/g, " ");
    default:
      return JSON.stringify(config);
  }
}

/** The organisation's rules, read-only for now. */
export default async function GovernancePage() {
  const ctx = await getAppContext();
  // Owners and Admins only, and only while governance is on (Settings › Governance).
  if (!canManageMembers(ctx.role) || !ctx.workspace.governanceEnabled) notFound();
  const db = await createServerDb();
  const { data: policies } = await db.from("policies").select("id, kind, config").eq("workspace_id", ctx.workspace.id);
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-[22px] px-8 pt-10 pb-12 max-sm:px-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-[650]">Governance</h1>
        <p className="flex flex-wrap items-center gap-2 text-ink-2">
          {ctx.workspace.governanceEnabled ? "On for " : "Off for "}
          {ctx.workspace.name}. These rules apply to every project. Enforcement is simulated in this prototype.
          <SimTag />
        </p>
      </div>
      {policies?.length ? (
        <div className="rounded-card border border-line">
          {policies.map((p) => (
            <SettingRow key={p.id} label={KIND[p.kind] ?? p.kind} value={describe(p.kind, (p.config ?? {}) as Record<string, unknown>)} />
          ))}
        </div>
      ) : (
        <p className="rounded-card bg-tray px-4 py-5 text-ink-2">No rules set yet.</p>
      )}
      <p className="text-ink-2">
        Requests waiting for a decision are in <TextLink href="/governance/approvals">Approvals</TextLink>.
      </p>
    </div>
  );
}
