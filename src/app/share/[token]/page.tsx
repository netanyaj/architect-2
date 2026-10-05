import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SimTag } from "@/components/ax/pill";
import { previewState } from "@/lib/sim/preview";
import { createAdminDb } from "@/server/db";

export const metadata: Metadata = { title: "Test version · Architect", robots: { index: false } };

/**
 * A test version's view-only link (review gap 3): anyone with the link sees the app as it is now, with the
 * sample-data banner kept. Nothing here can change the project. Stopping the share makes the link 404.
 */
export default async function SharedTestPage({ params }: PageProps<"/share/[token]">) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound();
  const admin = createAdminDb();
  const { data: project } = await admin.from("projects").select("id, name, workspace_id, current_version").eq("test_share_token", token).maybeSingle();
  if (!project) notFound();
  const [{ data: bp }, { data: conns }] = await Promise.all([
    admin.from("blueprints").select("id").eq("project_id", project.id).not("agreed_at", "is", null).order("version", { ascending: false }).limit(1).maybeSingle(),
    admin.from("connections").select("provider").eq("workspace_id", project.workspace_id).eq("status", "connected"),
  ]);
  const { data: items } = bp ? await admin.from("items").select("key, grp, title, provider, status, status_detail").eq("blueprint_id", bp.id) : { data: [] };
  const preview = previewState(
    (items ?? []).map((i) => ({ key: i.key, grp: i.grp, title: i.title, provider: i.provider, status: i.status, statusDetail: i.status_detail })),
    (conns ?? []).map((c) => c.provider),
  );
  const sample = preview.sample.length > 0 || (items ?? []).some((i) => i.status === "sample_data" || i.status === "needs_connection");

  return (
    <main className="flex h-dvh flex-col bg-canvas p-2.5">
      <header className="flex flex-wrap items-center gap-3 px-2 py-2">
        <h1 className="text-sub font-semibold">{project.name}</h1>
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line px-2.5 text-small font-[650] text-building">
          <i className="size-1.5 rounded-full bg-building" aria-hidden="true" />
          Test version · view only
        </span>
        <SimTag title="The app is a pre-built sample in this prototype" />
        <span className="ml-auto text-small text-ink-2">Shared from Architect</span>
      </header>
      {sample && (
        <p role="status" className="mx-1 mb-2 rounded-card border border-dashed border-attention bg-attention-bg px-4 py-2 text-small font-semibold text-attention">
          This test version uses sample data in places. What you see isn&apos;t anyone&apos;s real email or calendar.
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-hidden rounded-pane border border-line bg-white">
        {preview.reveal.length ? (
          <iframe title={`${project.name}, test version`} src={preview.src} className="block h-full w-full" />
        ) : (
          <p className="grid h-full place-items-center p-8 text-ink-2">Nothing is built yet.</p>
        )}
      </div>
    </main>
  );
}
