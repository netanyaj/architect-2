import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HelpHost } from "@/components/ax/help-host";
import { HelpLauncher } from "@/components/ax/help-launcher";
import { TourHost } from "@/components/ax/tour-host";
import { Icon } from "@/components/ax/icon";
import { getHelpContext } from "@/server/queries";
import { canBuild, canManageMembers } from "@/lib/permissions";
import { createServerDb } from "@/server/db";
import { getAppContext } from "@/server/workspace";
import type { LaunchSettings } from "@/lib/launch";
import { SignInSetting } from "../launch-settings";
import { CodingAgents, type TokenRow } from "./coding-agents";

export const metadata: Metadata = { title: "Project settings · Architect" };

/** Project settings: Coding agents (F4), the project tokens a coding agent would use with Architect's MCP server. */
export default async function ProjectSettingsPage({ params }: PageProps<"/p/[id]/settings">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getAppContext();
  const db = await createServerDb();
  const { data: project } = await db.from("projects").select("id, name, workspace_id, owner_id, owner_display_name, launch_settings").eq("id", id).maybeSingle();
  if (!project || project.workspace_id !== ctx.workspace.id) notFound();
  const { data: tokens } = await db
    .from("project_tokens")
    .select("id, name, scopes, last4, status, created_at, revoked_at, approvals(status, reason, decided_by_name)")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false });
  // Ownership: the current owner, an open offer, and every hand-off accepted (F8).
  const [{ data: transfers }, { data: owner }] = await Promise.all([
    db.from("ownership_transfers").select("id, from_name, to_name, note, status, created_at, accepted_at").eq("project_id", project.id).in("status", ["pending", "accepted"]).order("created_at", { ascending: false }),
    project.owner_id ? db.from("members").select("display_name, email").eq("workspace_id", project.workspace_id).eq("user_id", project.owner_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const ownerName = project.owner_display_name ? `${project.owner_display_name} (set up for them; ${owner?.display_name ?? "you"} owns it until they join)` : project.owner_id === ctx.user.id ? `${owner?.display_name ?? ctx.name} (you)` : (owner?.display_name ?? owner?.email ?? "Someone");
  const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const rows: TokenRow[] = (tokens ?? []).map((t) => ({ id: t.id, name: t.name, scopes: t.scopes, last4: t.last4, status: t.status as TokenRow["status"], createdAt: t.created_at, rejected: t.approvals?.status === "rejected" && t.approvals.decided_by_name ? { by: t.approvals.decided_by_name, reason: t.approvals.reason } : null }));
  return (
    <TourHost>
    <div className="min-h-dvh bg-canvas p-2.5 pb-[64px] max-md:pb-2.5">
      <header className="flex min-h-[66px] items-center gap-3 px-1 py-2">
        <Link href={`/p/${project.id}`} aria-label={`Back to ${project.name}`} className="grid size-[38px] place-items-center rounded-full hover:bg-selected">
          <Icon name="chevronLeft" size="sm" />
        </Link>
        <h1 className="text-sub font-semibold">{project.name} · Project settings</h1>
      </header>
      <main className="rounded-pane border border-line bg-surface shadow-pane">
        <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8 px-8 pt-10 pb-12 max-sm:px-4">
          <section aria-labelledby="sign-in" className="flex flex-col gap-3">
            <h2 id="sign-in" className="text-heading font-[650]">
              Sign-in
            </h2>
            <div className="rounded-card border border-line">
              <SignInSetting
                projectId={project.id}
                value={((project.launch_settings ?? {}) as LaunchSettings).signIn ?? "google"}
                access={((project.launch_settings ?? {}) as LaunchSettings).access}
                governance={ctx.workspace.governanceEnabled}
                readOnly={canBuild(ctx.role) ? undefined : "Viewers can't change how people sign in."}
              />
            </div>
          </section>

          <section aria-labelledby="ownership" className="flex flex-col gap-3">
            <h2 id="ownership" className="text-heading font-[650]">
              Ownership
            </h2>
            <div className="flex flex-col gap-3 rounded-card border border-line p-4">
              <p>
                <span className="text-ink-2">Owner:</span> <b className="font-semibold">{ownerName}</b>
              </p>
              {(transfers ?? []).length ? (
                <ol aria-label="Ownership history" className="flex flex-col gap-2">
                  {(transfers ?? []).map((t) => (
                    <li key={t.id} className="flex flex-col border-t border-line pt-2 first:border-t-0 first:pt-0">
                      <span>
                        {t.status === "pending" ? (
                          <>
                            Offered to <b className="font-semibold">{t.to_name}</b> by {t.from_name} on {when(t.created_at)} · waiting for them to accept
                          </>
                        ) : (
                          <>
                            <b className="font-semibold">{t.from_name}</b> → <b className="font-semibold">{t.to_name}</b> · {when(t.accepted_at ?? t.created_at)}
                          </>
                        )}
                      </span>
                      {t.note && <span className="text-small text-ink-2">“{t.note}”</span>}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-ink-2">It hasn&apos;t changed hands. Hand it over from ⋯ › Transfer ownership in the project.</p>
              )}
            </div>
          </section>

          <CodingAgents
            projectId={project.id}
            tokens={rows}
            governance={ctx.workspace.governanceEnabled}
            canCreate={canBuild(ctx.role)}
            canApprove={canManageMembers(ctx.role)}
          />
        </div>
      </main>
      <HelpHost context={await getHelpContext(ctx)} />
      <HelpLauncher projectId={project.id} />
    </div>
    </TourHost>
  );
}
