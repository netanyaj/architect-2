import "server-only";

import type { AdminDb } from "./db";

/**
 * Completes a hand-off (F8): the project's owner becomes the accepting person, the offer is accepted, and the
 * change is audited. Shared by Accept in the project and by accepting an invite link.
 */
export async function completeTransfer(admin: AdminDb, t: { id: string; project_id: string; from_name: string }, user: { id: string; name: string }, workspaceId: string) {
  const now = new Date().toISOString();
  const { error } = await admin.from("ownership_transfers").update({ status: "accepted", to_user: user.id, to_name: user.name, accepted_at: now }).eq("id", t.id).eq("status", "pending");
  if (error) return false;
  await admin.from("projects").update({ owner_id: user.id, owner_display_name: null, updated_at: now }).eq("id", t.project_id);
  const { data: p } = await admin.from("projects").select("name").eq("id", t.project_id).maybeSingle();
  await admin.from("audit_log").insert({ workspace_id: workspaceId, actor: user.name, action: "project.ownership_accepted", target: p?.name ?? t.project_id, details: { from: t.from_name, transfer: t.id } });
  return true;
}

/**
 * A member accepted their invite link: every hand-off offered to that invited member completes, and projects seeded
 * as theirs by name (Sam's ticket-triage) become really theirs, recorded in the ownership history.
 */
export async function completeOnInvite(admin: AdminDb, input: { memberId: string; workspaceId: string; displayName: string | null; user: { id: string; name: string } }) {
  const { data: offers } = await admin.from("ownership_transfers").select("id, project_id, from_name").eq("to_member", input.memberId).eq("status", "pending");
  for (const t of offers ?? []) await completeTransfer(admin, t, input.user, input.workspaceId);
  if (!input.displayName) return;
  const { data: seeded } = await admin.from("projects").select("id, name, owner_id").eq("workspace_id", input.workspaceId).eq("owner_display_name", input.displayName);
  for (const p of seeded ?? []) {
    const { data: from } = await admin.from("members").select("display_name").eq("workspace_id", input.workspaceId).eq("user_id", p.owner_id ?? "").maybeSingle();
    const { data: t } = await admin
      .from("ownership_transfers")
      .insert({ project_id: p.id, from_user: p.owner_id, from_name: from?.display_name ?? "the workspace", to_member: input.memberId, to_name: input.displayName, note: `${p.name} was set up as ${input.displayName}'s project.`, status: "pending" })
      .select("id, project_id, from_name")
      .single();
    if (t) await completeTransfer(admin, t, input.user, input.workspaceId);
  }
}
