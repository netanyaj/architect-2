import Link from "next/link";
import { Button } from "@/components/ax/button";
import { Icon } from "@/components/ax/icon";
import { SimTag } from "@/components/ax/pill";
import { StatusWord } from "@/components/ax/status-mark";

/**
 * An app built with Architect 1.0 (F9). It keeps running unchanged; nothing is forced. Move to 2.0 imports it from its
 * repo as a plan (F3), keeping its stack; its Studio agents stay linked (the registry is shared), and its credits and
 * plan carry over. Once moved, it points at the new project.
 */
export function LegacyProject({ id, name, repo, movedTo, canMove }: { id: string; name: string; repo: string; movedTo: { id: string; name: string } | null; canMove: boolean }) {
  return (
    <main className="min-h-dvh bg-canvas p-2.5">
      <div className="mx-auto flex max-w-[720px] flex-col gap-6 rounded-pane border border-line bg-surface px-8 py-8 shadow-pane max-sm:px-4">
        <Link href="/projects" className="flex items-center gap-2 text-small font-semibold text-ink-2 no-underline hover:text-ink">
          <Icon name="chevronLeft" size="sm" /> Projects
        </Link>
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-title font-[650]">{name}</h1>
            <SimTag title="The Architect 1.0 app is a seeded example; nothing runs." />
          </div>
          <StatusWord status="works">Live on Architect 1.0 · keeps running as it is</StatusWord>
        </header>
        {movedTo ? (
          <section aria-label="Moved to 2.0" className="flex flex-col gap-3 rounded-card border border-line p-5">
            <h2 className="text-sub font-semibold">Moved to 2.0</h2>
            <p className="text-ink-2">
              It was imported from <code className="font-mono text-small">{repo}</code> as a plan. The 1.0 app keeps running until you switch your users over.
            </p>
            <Button variant="primary" className="self-start" href={`/p/${movedTo.id}`}>
              Open {movedTo.name}
            </Button>
          </section>
        ) : (
          <section aria-label="Move to 2.0" className="flex flex-col gap-3 rounded-card border border-line p-5">
            <h2 className="text-sub font-semibold">Move it to Architect 2.0 when you&apos;re ready</h2>
            <ul className="list-disc pl-5 text-ink-2">
              <li>Nothing is forced. This app keeps running unchanged while you move it.</li>
              <li>
                Move to 2.0 imports it from its repo, <code className="font-mono text-small">{repo}</code>, as a plan: what it does today, with its tests as proof.
              </li>
              <li>Its Lyzr Studio agents stay linked as they are. Its credits and plan carry over.</li>
              <li>You can move the repo from Lyzr&apos;s organisation to your own on GitHub at any time.</li>
            </ul>
            <Button variant="primary" className="self-start" href={`/import?repo=${encodeURIComponent(repo)}&from=${id}`} disabledReason={canMove ? undefined : "Viewers can't move apps. Ask an Owner, Admin or Builder."}>
              Move to 2.0
            </Button>
          </section>
        )}
      </div>
    </main>
  );
}
