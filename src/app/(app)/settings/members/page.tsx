import type { Metadata } from "next";
import type { Role } from "@/lib/db";
import { assignableRolesFor, canChangeMember, canManageMembers } from "@/lib/permissions";
import { createAdminDb, createServerDb } from "@/server/db";
import { origin } from "@/server/origin";
import { getAppContext } from "@/server/workspace";
import { MembersSection, type MemberRow } from "../members-section";

export const metadata: Metadata = { title: "Members · Settings · Architect" };

/** Settings › Members: who's in the workspace, their roles, and invites. */
export default async function MembersSettingsPage() {
  const ctx = await getAppContext();
  const db = await createServerDb();
  const { data: rows } = await db
    .from("members")
    .select("id, user_id, role, status, display_name, email, invited_email, created_at")
    .eq("workspace_id", ctx.workspace.id)
    .order("created_at");
  const manage = canManageMembers(ctx.role);
  // Invite links are only for people who can manage members; read them with the service role.
  const links = new Map<string, string>();
  if (manage) {
    const { data } = await createAdminDb().from("members").select("id, invite_token").eq("workspace_id", ctx.workspace.id).eq("status", "invited");
    const base = await origin();
    for (const m of data ?? []) if (m.invite_token) links.set(m.id, `${base}/invite/${m.invite_token}`);
  }
  const order: Record<Role, number> = { owner: 0, admin: 1, builder: 2, viewer: 3 };
  const members: MemberRow[] = (rows ?? [])
    .map((m) => {
      const change = canChangeMember({ role: ctx.role, userId: ctx.user.id }, { role: m.role as Role, userId: m.user_id });
      return {
        id: m.id,
        name: m.display_name ?? m.email ?? m.invited_email ?? "Someone",
        email: m.email ?? m.invited_email ?? "",
        role: m.role as Role,
        invited: m.status === "invited",
        isYou: m.user_id === ctx.user.id,
        changeBlockedReason: change.ok ? undefined : change.reason,
        inviteLink: links.get(m.id),
      };
    })
    .sort((a, b) => Number(a.invited) - Number(b.invited) || order[a.role] - order[b.role]);
  return <MembersSection workspaceName={ctx.workspace.name} members={members} canManage={manage} assignable={assignableRolesFor(ctx.role)} />;
}
