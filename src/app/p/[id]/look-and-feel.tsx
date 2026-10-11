"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ax/button";
import { SimTag } from "@/components/ax/pill";
import { canBuild } from "@/lib/permissions";
import { THEMES, themeOf, type ThemeId } from "@/lib/themes";
import { cn } from "@/lib/utils";
import { setLook } from "@/server/actions/launch";
import type { ProjectWorkspace } from "@/server/project";

/**
 * Plan › Design › Look and feel (screen 5, M5.8): the presets as a row of swatches. Picking one only selects it;
 * "Apply to plan" is the one action, and the preview (App) shows it from then on.
 */
export function LookAndFeel({ project }: { project: ProjectWorkspace }) {
  const router = useRouter();
  const [picked, setPicked] = useState<ThemeId>(project.look);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const canAct = canBuild(project.role);
  const chosen = themeOf(picked);
  const applied = picked === project.look;
  return (
    <section aria-labelledby="design" className="mx-auto flex w-full max-w-[860px] flex-col gap-2.5 px-6 pt-2 pb-10 max-sm:px-4">
      <h2 id="design" className="text-title font-[650]">
        Design
      </h2>
      <h3 id="look" className="flex items-center gap-2 text-sub font-semibold">
        Look and feel <SimTag title="Themes style the preview; the generated app's styles are simulated in this prototype." />
      </h3>
      <p className="text-small text-ink-2">A theme for the app. Pick one, then apply it to the plan; the preview (App) shows it.</p>
      <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-2.5">
        {THEMES.map((t) => {
          const on = picked === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${t.label}: ${t.about}`}
              title={`${t.label}: ${t.about}`}
              onClick={() => setPicked(t.id)}
              className="flex flex-col items-center gap-1.5 rounded-card p-1"
            >
              <span
                aria-hidden="true"
                className={cn("flex size-14 flex-col overflow-hidden border", on ? "outline-2 outline-offset-2 outline-ink" : "")}
                style={{ background: t.vars.bg, borderColor: t.vars.line, borderRadius: t.vars.radius }}
              >
                <span className="mt-auto h-4" style={{ background: t.vars.sel }} />
                <span className="h-2" style={{ background: t.vars.accent }} />
              </span>
              <span className={cn("text-small", on ? "font-semibold text-ink" : "text-ink-2")} style={{ fontFamily: t.vars.font }}>
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabledReason={!canAct ? "Viewers can't change the look." : applied ? "This is the plan's look already." : pending ? "Applying…" : undefined}
          onClick={() =>
            start(async () => {
              setError(undefined);
              const r = await setLook({ projectId: project.id, theme: picked });
              if (!r.ok) setError(r.message);
              router.refresh();
            })
          }
        >
          {pending ? "Applying…" : "Apply to plan"}
        </Button>
        <span className="text-small text-ink-2">{applied ? `${chosen.label} is the plan's look.` : `${chosen.label}: ${chosen.about}.`}</span>
      </div>
      {error && (
        <p role="alert" className="text-small font-semibold text-failed">
          {error}
        </p>
      )}
    </section>
  );
}
