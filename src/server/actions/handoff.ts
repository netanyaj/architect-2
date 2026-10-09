"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Role } from "@/lib/db";
import { canBuild, canManageMembers } from "@/lib/permissions";
import { createAdminDb } from "../db";
import { completeTransfer } from "../handoff";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";

/* Hand-off (F8): offer a project to another member with a note; they accept in the project, or by accepting their
   invite link if they haven't joined yet. */

const uuid = z.string().uuid();

export async function transferOwnership(input: { projectId: string; memberId: string; note?: string }): Promise<ActionResult<{ invited: boolean }>> {
  const ctx = await getAppContext();
  if (!uuid.safeParse(input.projectId).success || !uuid.safeParse(input.memberId).success) return { ok: false, message: "Choose a project and a member." };
  const note = (input.note ?? "").trim();
  if (note.length > 500) return { ok: false, message: "Keep the note under 500 characters." };
  const admin = createAdminDb();
  const { data: project } = await admin.from("projects").select("id, name, owner_id, owner_display_name, workspace_id").eq("id", input.projectId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!project) return { ok: false, message: "That project isn't in this workspace." };
  if (project.owner_id !== ctx.user.id && !canManageMembers(ctx.role)) return { ok: false, message: "Only the project's owner, or an Owner or Admin, can hand it over." };
  const { data: member } = await admin.from("members").select("id, user_id, role, status, display_name, invited_email, email").eq("id", input.memberId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!member) return { ok: false, message: "That person isn't in this workspace." };
  if (member.user_id && member.user_id === project.owner_id && !project.owner_display_name) return { ok: false, message: "They already own it." };
  if (!canBuild(member.role as Role)) return { ok: false, message: "Viewers can't own projects. Change their role in Settings first." };
  const name = member.display_name ?? member.email ?? member.invited_email ?? "them";
  // One open offer per project: a new one replaces it.
  await admin.from("ownership_transfers").update({ status: "cancelled" }).eq("project_id", project.id).eq("status", "pending");
  const { error } = await admin.from("ownership_transfers").insert({
    project_id: project.id,
    from_user: ctx.user.id,
    from_name: ctx.name,
    to_member: member.id,
    to_name: name,
    note: note || null,
    status: "pending",
  });
  if (error) return { ok: false, message: "The hand-off couldn't be offered. Try again." };
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "project.ownership_offered", target: project.name, details: { to: name, invited: member.status === "invited" } });
  revalidatePath(`/p/${project.id}`);
  return { ok: true, invited: member.status === "invited" };
}

async function offerOf(transferId: string, workspaceId: string) {
  if (!uuid.safeParse(transferId).success) return null;
  const { data } = await createAdminDb()
    .from("ownership_transfers")
    .select("id, project_id, from_user, from_name, to_member, status, projects!inner(id, workspace_id, owner_id)")
    .eq("id", transferId)
    .maybeSingle();
  return data && data.projects.workspace_id === workspaceId ? data : null;
}

/** Accept a hand-off offered to you: you become the project's owner. */
export async function acceptTransfer(input: { transferId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  const t = await offerOf(input.transferId, ctx.workspace.id);
  if (!t || t.status !== "pending") return { ok: false, message: "That hand-off isn't open any more." };
  const admin = createAdminDb();
  const { data: me } = await admin.from("members").select("id").eq("workspace_id", ctx.workspace.id).eq("user_id", ctx.user.id).maybeSingle();
  if (!me || me.id !== t.to_member) return { ok: false, message: "This hand-off is for someone else." };
  if (!(await completeTransfer(admin, t, { id: ctx.user.id, name: ctx.name }, ctx.workspace.id))) return { ok: false, message: "The hand-off couldn't be accepted. Try again." };
  revalidatePath(`/p/${t.project_id}`);
  return { ok: true };
}

/** Cancel an open offer (whoever offered it, the person it's for, or an Owner or Admin). */
export async function cancelTransfer(input: { transferId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  const t = await offerOf(input.transferId, ctx.workspace.id);
  if (!t || t.status !== "pending") return { ok: false, message: "That hand-off isn't open any more." };
  const admin = createAdminDb();
  const { data: me } = await admin.from("members").select("id").eq("workspace_id", ctx.workspace.id).eq("user_id", ctx.user.id).maybeSingle();
  if (t.from_user !== ctx.user.id && me?.id !== t.to_member && !canManageMembers(ctx.role)) return { ok: false, message: "Only the person who offered it, or an Owner or Admin, can cancel it." };
  await admin.from("ownership_transfers").update({ status: "cancelled" }).eq("id", t.id);
  revalidatePath(`/p/${t.project_id}`);
  return { ok: true };
}

/** The new owner read the "You now own …" banner. */
export async function dismissHandoff(input: { transferId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!uuid.safeParse(input.transferId).success) return { ok: false, message: "That hand-off isn't here." };
  await createAdminDb().from("ownership_transfers").update({ seen_at: new Date().toISOString() }).eq("id", input.transferId).eq("to_user", ctx.user.id);
  return { ok: true };
}
