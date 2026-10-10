"use server";

import type { DecisionScope } from "@/lib/approvals";
import { decide, removeRule } from "../approvals";
import { createAdminDb } from "../db";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";

/** Approve (once, or with an allow-rule) or reject a request on the Approvals page (screen 11). */
export async function decideApproval(input: { approvalId: string; decision: "approve" | "reject"; scope?: DecisionScope; reason?: string; allowHost?: boolean }): Promise<ActionResult<{ note?: string }>> {
  const ctx = await getAppContext();
  return decide(createAdminDb(), ctx, input);
}

/** Rules tab: remove an allow-rule made from an approval. */
export async function removeAllowRule(input: { ruleId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  return removeRule(createAdminDb(), ctx, input.ruleId);
}
