import type { Metadata } from "next";
import { canBuild } from "@/lib/permissions";
import { projectIcon } from "@/lib/project-status";
import { createAdminDb, createServerDb } from "@/server/db";
import { purgeDeleted } from "@/server/trash";
import { getAppContext } from "@/server/workspace";
import { TrashList, type TrashRow } from "./trash-list";

export const metadata: Metadata = { title: "Trash · Architect" };

/**
 * Trash (M5.8; was "Recently deleted" under Projects): deleted projects for 30 days. Opening it purges what's older,
 * as the old list did. Rows: who deleted it, when, days left; Restore; Delete permanently for the Owner.
 */
/** When the list was read: days left count from here. */
const loadedAt = () => Date.now();

export default async function TrashPage() {
  const ctx = await getAppContext();
  let rows: TrashRow[] = [];
  if (canBuild(ctx.role)) {
    const admin = createAdminDb();
    await purgeDeleted(admin, ctx.workspace.id);
    const db = await createServerDb();
    const { data } = await db.rpc("list_deleted_projects", { p_workspace: ctx.workspace.id });
    const ids = (data ?? []).map((p) => p.id);
    const { data: icons } = ids.length ? await admin.from("projects").select("id, icon").in("id", ids) : { data: [] };
    rows = (data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      icon: projectIcon(icons?.find((i) => i.id === p.id)?.icon ?? null),
      deletedAt: p.deleted_at,
      deletedBy: p.deleted_by_name,
    }));
  }
  return <TrashList rows={rows} canRestore={canBuild(ctx.role)} canDeleteForever={ctx.role === "owner"} now={loadedAt()} />;
}
