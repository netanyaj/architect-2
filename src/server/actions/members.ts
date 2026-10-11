"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { loginUrl } from "@/lib/auth-paths";
import type { Json } from "@/lib/database.types";
import type { Role } from "@/lib/db";
import { assignableRolesFor, canChangeMember, canManageMembers, canResetDemo, ROLE_INFO } from "@/lib/permissions";
import { createAdminDb, createServerDb } from "../db";
import { completeOnInvite } from "../handoff";
import { origin } from "../origin";
import { removeProjectFiles } from "../uploads";
import { displayNameFor, getAppContext, WORKSPACE_COOKIE } from "../workspace";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };

async function audit(workspaceId: string, actor: string, action: string, target: string, details: Json = {}) {
  await createAdminDb().from("audit_log").insert({ workspace_id: workspaceId, actor, action, target, details });
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter an email address like sam@company.com."),
  role: z.enum(["admin", "builder", "viewer"]),
});

/** Invite someone by link, with a role. Re-inviting a pending address updates its role and keeps its link. */
export async function inviteMember(input: { email: string; role: string }): Promise<ActionResult<{ link: string; emailed: boolean }>> {
  const ctx = await getAppContext();
  if (!canManageMembers(ctx.role)) return { ok: false, message: "Only Owners and Admins can invite people." };
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const { email, role } = parsed.data;
  if (!assignableRolesFor(ctx.role).includes(role)) {
    return { ok: false, message: `Only the Owner can invite someone as ${ROLE_INFO[role].label}.` };
  }

  const admin = createAdminDb();
  const ws = ctx.workspace.id;
  // Exact, case-insensitive match in code (no user input inside a filter string).
  const { data: all } = await admin.from("members").select("id, status, invite_token, role, email, invited_email").eq("workspace_id", ws);
  const existing = all?.filter((m) => m.email?.toLowerCase() === email || m.invited_email?.toLowerCase() === email);

  if (existing?.some((m) => m.status === "active")) return { ok: false, message: `${email} is already in this workspace.` };

  let token: string | null = null;
  const pending = existing?.find((m) => m.status === "invited");
  if (pending) {
    const { data, error } = await admin.from("members").update({ role }).eq("id", pending.id).select("invite_token").single();
    if (error) return { ok: false, message: "The invite couldn't be updated. Try again." };
    token = data.invite_token;
  } else {
    const { data, error } = await admin
      .from("members")
      .insert({ workspace_id: ws, invited_email: email, email, role, status: "invited", invited_by: ctx.user.id })
      .select("invite_token")
      .single();
    if (error) return { ok: false, message: "The invite couldn't be created. Try again." };
    token = data.invite_token;
  }
  if (!token) return { ok: false, message: "The invite has no link. Remove it and invite again." };

  await audit(ws, ctx.name, "member.invited", email, { role });
  const link = `${await origin()}/invite/${token}`;
  const emailed = await emailInvite(email, link);
  revalidatePath("/settings");
  return { ok: true, link, emailed };
}

/**
 * With custom SMTP set up in Supabase Auth and INVITE_EMAILS=on, the invite also goes by email (Supabase's invite
 * mail, which signs them in and lands on the invite link). Otherwise, and whenever it can't (they already have an
 * account), it's copy-a-link only. Never throws: the link always works.
 */
async function emailInvite(email: string, link: string): Promise<boolean> {
  if (process.env.INVITE_EMAILS !== "on") return false;
  try {
    const { error } = await createAdminDb().auth.admin.inviteUserByEmail(email, { redirectTo: link });
    return !error;
  } catch {
    return false;
  }
}

/** Pending invites: a fresh link replaces the old one (which stops working). Owners and Admins only. */
export async function resendInvite(input: { memberId: string }): Promise<ActionResult<{ link: string; emailed: boolean }>> {
  const ctx = await getAppContext();
  if (!canManageMembers(ctx.role)) return { ok: false, message: "Only Owners and Admins can resend invites." };
  const target = await loadTarget(input.memberId, ctx.workspace.id);
  if (!target || target.status !== "invited") return { ok: false, message: "That invite isn't pending any more." };
  const { data, error } = await createAdminDb().from("members").update({ invite_token: crypto.randomUUID() }).eq("id", target.id).select("invite_token").single();
  if (error || !data?.invite_token) return { ok: false, message: "A new link couldn't be made. Try again." };
  const link = `${await origin()}/invite/${data.invite_token}`;
  const email = target.invited_email ?? target.email ?? "";
  const emailed = email ? await emailInvite(email, link) : false;
  await audit(ctx.workspace.id, ctx.name, "member.invite_resent", email || target.id, { role: target.role, emailed });
  revalidatePath("/settings");
  return { ok: true, link, emailed };
}

async function loadTarget(memberId: string, workspaceId: string) {
  const { data } = await createAdminDb()
    .from("members")
    .select("id, user_id, role, status, display_name, email, invited_email")
    .eq("id", memberId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return data;
}

/** Change someone's role. Written to the audit log. */
export async function changeRole(input: { memberId: string; role: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  const role = z.enum(["admin", "builder", "viewer"]).safeParse(input.role);
  if (!role.success) return { ok: false, message: "Pick Admin, Builder or Viewer." };
  const target = await loadTarget(input.memberId, ctx.workspace.id);
  if (!target) return { ok: false, message: "That person isn't in this workspace any more." };

  const allowed = canChangeMember({ role: ctx.role, userId: ctx.user.id }, { role: target.role as Role, userId: target.user_id });
  if (!allowed.ok) return { ok: false, message: allowed.reason };
  if (!assignableRolesFor(ctx.role).includes(role.data)) {
    return { ok: false, message: `Only the Owner can make someone ${ROLE_INFO[role.data].label}.` };
  }
  if (target.role === role.data) return { ok: true };

  const { error } = await createAdminDb().from("members").update({ role: role.data }).eq("id", target.id);
  if (error) return { ok: false, message: "The role couldn't be changed. Try again." };
  await audit(ctx.workspace.id, ctx.name, "member.role_changed", target.display_name ?? target.email ?? target.invited_email ?? target.id, {
    from: target.role,
    to: role.data,
  });
  revalidatePath("/settings");
  return { ok: true };
}

/** Remove a member, or cancel a pending invite (its link stops working). */
export async function removeMember(input: { memberId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  const target = await loadTarget(input.memberId, ctx.workspace.id);
  if (!target) return { ok: false, message: "That person isn't in this workspace any more." };
  const allowed = canChangeMember({ role: ctx.role, userId: ctx.user.id }, { role: target.role as Role, userId: target.user_id });
  if (!allowed.ok) return { ok: false, message: allowed.reason };

  const { error } = await createAdminDb().from("members").delete().eq("id", target.id);
  if (error) return { ok: false, message: "They couldn't be removed. Try again." };
  await audit(
    ctx.workspace.id,
    ctx.name,
    target.status === "invited" ? "member.invite_cancelled" : "member.removed",
    target.display_name ?? target.email ?? target.invited_email ?? target.id,
    { role: target.role },
  );
  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Accept an invite link. The signed-in email must match the invited one, so a forwarded link
 * can't be used by someone else. Joining adds this workspace next to their own and switches to it.
 */
export async function acceptInvite(token: string): Promise<ActionResult> {
  const db = await createServerDb();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect(loginUrl(`/invite/${token}`));
  if (!z.string().uuid().safeParse(token).success) return { ok: false, message: "This invite link isn't valid." };

  const admin = createAdminDb();
  const { data: invite } = await admin
    .from("members")
    .select("id, workspace_id, role, invited_email, status, display_name")
    .eq("invite_token", token)
    .maybeSingle();
  if (!invite || invite.status !== "invited") {
    return { ok: false, message: "This invite was already used or cancelled. Ask for a new link." };
  }
  if ((invite.invited_email ?? "").toLowerCase() !== (user.email ?? "").toLowerCase()) {
    return {
      ok: false,
      message: `This invite is for ${invite.invited_email}. Sign out, then sign in with that email to accept it.`,
    };
  }

  const { data: already } = await admin
    .from("members")
    .select("id")
    .eq("workspace_id", invite.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (already) {
    // They joined another way; the invite is no longer needed.
    await admin.from("members").delete().eq("id", invite.id);
  } else {
    const { error } = await admin
      .from("members")
      .update({
        user_id: user.id,
        status: "active",
        accepted_at: new Date().toISOString(),
        invite_token: null,
        email: user.email,
        display_name: displayNameFor(user),
      })
      .eq("id", invite.id)
      .eq("status", "invited");
    if (error) return { ok: false, message: "The invite couldn't be accepted. Try again." };
    await audit(invite.workspace_id, displayNameFor(user), "member.joined", user.email ?? user.id, { role: invite.role });
    // Hand-offs waiting for this invite complete now (F8), and projects seeded as theirs become theirs.
    await completeOnInvite(admin, { memberId: invite.id, workspaceId: invite.workspace_id, displayName: invite.display_name, user: { id: user.id, name: displayNameFor(user) } });
  }

  (await cookies()).set(WORKSPACE_COOKIE, invite.workspace_id, { path: "/", sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 365 });
  redirect("/home");
}

/** Switch between workspaces you belong to (your own Acme Ops, and any you were invited to). */
export async function switchWorkspace(workspaceId: string): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx.memberships.some((m) => m.workspaceId === workspaceId)) {
    return { ok: false, message: "You're not a member of that workspace." };
  }
  (await cookies()).set(WORKSPACE_COOKIE, workspaceId, { path: "/", sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Settings › Reset demo data (Owner only): restores the seeded demo, removing projects' uploaded files. People and tickets are kept. */
export async function resetDemoData(): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!canResetDemo(ctx.role)) return { ok: false, message: "Only the workspace Owner can reset demo data." };
  const admin = createAdminDb();
  // The reset deletes every project, so note which ones have files before it runs.
  const { data: before } = await admin.from("projects").select("id").eq("workspace_id", ctx.workspace.id);
  const { error } = await admin.rpc("reset_demo_workspace", { p_workspace: ctx.workspace.id, p_owner: ctx.user.id });
  if (error) return { ok: false, message: "Demo data couldn't be reset. Nothing was changed. Try again." };
  for (const p of before ?? []) await removeProjectFiles(admin, ctx.workspace.id, p.id);
  revalidatePath("/", "layout");
  return { ok: true };
}
