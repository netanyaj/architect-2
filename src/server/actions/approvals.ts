"use server";

import type { DecisionScope } from "@/lib/approvals";
import { decide, removeRule } from "../approvals";
import { createAdminDb } from "../db";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";
import { track } from "../analytics";

/** Approve (once, or with an allow-rule) or reject a request on the Approvals page (screen 11). */
export async function decideApproval(input: { approvalId: string; decision: "approve" | "reject"; scope?: DecisionScope; reason?: string; allowHost?: boolean }): Promise<ActionResult<{ note?: string }>> {
  const ctx = await getAppContext();
  const admin = createAdminDb();
  const { data: before } = await admin.from("approvals").select("kind, project_id").eq("id", input.approvalId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  const r = await decide(admin, ctx, input);
  if (r.ok && input.decision === "approve" && before?.kind === "deploy") await track("launch", { user: ctx.user, workspaceId: ctx.workspace.id, projectId: before.project_id, detail: "approved" });
  return r;
}

/** Rules tab: remove an allow-rule made from an approval. */
export async function removeAllowRule(input: { ruleId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  return removeRule(createAdminDb(), ctx, input.ruleId);
}
