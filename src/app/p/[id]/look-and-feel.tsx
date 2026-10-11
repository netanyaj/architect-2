"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { SimTag } from "@/components/ax/pill";
import { canBuild } from "@/lib/permissions";
import { THEMES, type ThemeId } from "@/lib/themes";
import { cn } from "@/lib/utils";
import { setLook } from "@/server/actions/launch";
import type { ProjectWorkspace } from "@/server/project";

/** Plan › Design › Look and feel (screen 5): six theme presets for the app; the choice shows in its preview at once. */
export function LookAndFeel({ project }: { project: ProjectWorkspace }) {
  const router = useRouter();
  const [shown, setShown] = useOptimistic<ThemeId>(project.look);
  const [, start] = useTransition();
  const [error, setError] = useState<string>();
  const canAct = canBuild(project.role);
  return (
    <section aria-labelledby="design" className="mx-auto flex w-full max-w-[860px] flex-col gap-2.5 px-6 pt-2 pb-10 max-sm:px-4">
      <h2 id="design" className="text-title font-[650]">
        Design
      </h2>
      <h3 id="look" className="flex items-center gap-2 text-sub font-semibold">
        Look and feel <SimTag title="Themes style the preview; the generated app's styles are simulated in this prototype." />
      </h3>
      <p className="text-small text-ink-2">A theme for the app. It shows in the preview (App) straight away.</p>
      <div role="radiogroup" aria-label="Theme" className="grid gap-2 sm:grid-cols-3">
        {THEMES.map((t) => {
          const on = shown === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-disabled={!canAct || undefined}
              title={canAct ? undefined : "Viewers can't change the look."}
              onClick={() =>
                canAct &&
                !on &&
                start(async () => {
                  setError(undefined);
                  setShown(t.id);
                  const r = await setLook({ projectId: project.id, theme: t.id });
                  if (!r.ok) setError(r.message);
                  router.refresh();
                })
              }
              className={cn("flex items-center gap-3 rounded-card border bg-surface p-3 text-left", on ? "border-[1.5px] border-ink" : "border-line hover:border-line-ctl", !canAct && "cursor-not-allowed")}
            >
              <span aria-hidden="true" className="flex size-11 flex-none flex-col overflow-hidden border" style={{ background: t.vars.bg, borderColor: t.vars.line, borderRadius: t.vars.radius }}>
                <span className="mt-auto h-3" style={{ background: t.vars.sel }} />
                <span className="h-1.5" style={{ background: t.vars.accent }} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold" style={{ fontFamily: t.vars.font }}>
                  {t.label}
                </span>
                <span className="text-small text-ink-2">{t.about}</span>
              </span>
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-small font-semibold text-failed">
          {error}
        </p>
      )}
    </section>
  );
}
