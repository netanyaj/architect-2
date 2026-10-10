import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createServerDb } from "@/server/db";
import { importPageData } from "@/server/import";
import { getAppContext } from "@/server/workspace";
import { ImportFlow, type MoveFrom } from "./import-flow";

export const metadata: Metadata = { title: "Import a repo · Architect" };

/**
 * Import a repo (screen 10): Choose repo → Understand it → Plan from repo. GitHub's install page returns here with
 * installation_id; that id isn't trusted on its own, so the person's GitHub sign-in for the App confirms it first.
 */
export default async function ImportPage({ searchParams }: PageProps<"/import">) {
  const sp = await searchParams;
  if (sp.installation_id || sp.setup_action) redirect("/api/github/connect");
  const ctx = await getAppContext();
  const data = await importPageData(ctx);
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const notice = one(sp.github_error)
    ? { kind: "error" as const, text: one(sp.github_error)! }
    : one(sp.github_none)
      ? { kind: "error" as const, text: "Your GitHub account doesn't have the Architect app installed yet. Install it on the repos you want to import." }
      : one(sp.github_connected)
        ? { kind: "done" as const, text: "GitHub is connected. Choose a repo." }
        : null;
  // F9: "Move to 2.0" from an Architect 1.0 app in this workspace that hasn't moved yet.
  const from = one(sp.from);
  let move: MoveFrom | null = null;
  if (from && /^[0-9a-f-]{36}$/i.test(from)) {
    const db = await createServerDb();
    const { data: legacy } = await db.from("projects").select("id, name, legacy_repo, moved_to, workspace_id").eq("id", from).maybeSingle();
    if (legacy?.legacy_repo && !legacy.moved_to && legacy.workspace_id === ctx.workspace.id) move = { projectId: legacy.id, name: legacy.name, repo: legacy.legacy_repo };
  }
  return <ImportFlow data={data} notice={notice} move={move} />;
}
