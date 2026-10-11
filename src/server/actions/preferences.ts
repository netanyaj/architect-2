"use server";

import { z } from "zod";
import { createAdminDb } from "../db";
import { getAppContext } from "../workspace";

const pane = z.object({ pane: z.enum(["parts", "chat"]), open: z.boolean() });

/**
 * The Parts or Chat pane was opened or collapsed (M5.10): the choice is saved per person and wins over the per-tab
 * defaults, across tabs, projects and reloads. Best effort: a failed save only means the default next time.
 */
export async function savePane(raw: z.input<typeof pane>): Promise<void> {
  const parsed = pane.safeParse(raw);
  if (!parsed.success) return;
  const ctx = await getAppContext();
  const admin = createAdminDb();
  const { data } = await admin.from("user_preferences").select("panes").eq("user_id", ctx.user.id).maybeSingle();
  const panes = { ...((data?.panes as Record<string, string> | null) ?? {}), [parsed.data.pane]: parsed.data.open ? "open" : "closed" };
  await admin.from("user_preferences").upsert({ user_id: ctx.user.id, panes, updated_at: new Date().toISOString() });
}
