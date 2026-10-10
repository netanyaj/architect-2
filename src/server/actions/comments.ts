"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminDb } from "../db";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";

const input = z.object({ projectId: z.string().uuid(), itemKey: z.string().min(1).max(120), body: z.string() });

/** BL-15: anyone in the workspace, Viewers included, comments on a plan part. Comments change nothing in the plan. */
export async function addPartComment(raw: z.input<typeof input>): Promise<ActionResult> {
  const ctx = await getAppContext();
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That comment can't be saved." };
  const body = parsed.data.body.trim();
  if (!body) return { ok: false, message: "Write a comment first." };
  if (body.length > 1000) return { ok: false, message: "Keep a comment under 1,000 characters." };
  const admin = createAdminDb();
  const { data: project } = await admin.from("projects").select("id, name, workspace_id").eq("id", parsed.data.projectId).maybeSingle();
  if (!project || project.workspace_id !== ctx.workspace.id) return { ok: false, message: "That project isn't in this workspace." };
  const { error } = await admin.from("part_comments").insert({ project_id: project.id, item_key: parsed.data.itemKey, body, author_id: ctx.user.id, author_name: ctx.name });
  if (error) return { ok: false, message: "The comment couldn't be saved. Try again." };
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "part.commented", target: `${project.name}: ${parsed.data.itemKey}`, details: {} });
  revalidatePath(`/p/${project.id}`);
  return { ok: true };
}
