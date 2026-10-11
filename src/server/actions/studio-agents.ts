"use server";

import { canBuild } from "@/lib/permissions";
import { createAdminDb } from "../db";
import { listLyzrAgents, type StudioAgent } from "../lyzr";
import { workspaceLyzrKey } from "../lyzr-key";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";

/*
 * Attach Studio agent (BL-2): the Lyzr Studio agents a new project can use instead of building its own. Listed with
 * the workspace's own Lyzr key only (M5.10), so nobody ever sees another account's agents. Without a key there's no
 * list, only the prompt to connect one.
 */
export async function studioAgents(): Promise<ActionResult<{ agents: StudioAgent[]; needsKey: boolean; note?: string }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't start projects." };
  const apiKey = await workspaceLyzrKey(createAdminDb(), ctx.workspace.id);
  if (!apiKey) return { ok: true, agents: [], needsKey: true };
  try {
    return { ok: true, agents: await listLyzrAgents(apiKey), needsKey: false };
  } catch {
    return { ok: true, agents: [], needsKey: false, note: "Lyzr Studio didn't answer. Try again in a minute." };
  }
}
