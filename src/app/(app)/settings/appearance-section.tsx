"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Segmented } from "@/components/ax/segmented";
import { OPEN_IN_DEV, type OpenInDev } from "@/lib/dev-preference";
import { setOpenInDev, setTheme } from "@/server/actions/projects";
import { applyTheme } from "@/lib/theme-choice";

/**
 * Settings › Appearance (M5.8): Theme and where projects open, both moved here from the account menu. Theme is also
 * the one-click cycle in Resources. Saved to the person's account.
 */
export function AppearanceSection({ theme, openInDev, canBuild }: { theme: "system" | "light" | "dark"; openInDev: OpenInDev; canBuild: boolean }) {
  const router = useRouter();
  const [, start] = useTransition();
  return (
    <section id="preferences" aria-labelledby="preferences-title" className="flex scroll-mt-6 flex-col gap-3">
      <h2 id="preferences-title" className="text-heading font-[650]">
        Appearance
      </h2>
      <div className="flex flex-wrap items-center gap-4 rounded-card border border-line p-4">
        <p className="min-w-[220px] flex-1 text-ink-2">
          <b className="text-ink">Theme.</b> Saved to your account. Developer view uses it too.
        </p>
        <Segmented
          mode="filter"
          label="Theme"
          value={theme}
          onChange={(t) =>
            start(async () => {
              applyTheme(t);
              await setTheme(t);
              router.refresh();
            })
          }
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </div>
      {canBuild && (
        <div className="flex flex-wrap items-center gap-4 rounded-card border border-line p-4">
          <p className="min-w-[220px] flex-1 text-ink-2">
            <b className="text-ink">Open projects in Developer view.</b> Where a project opens from Home and Projects. You can switch any time with the Developer view switch in the project header.
          </p>
          <Segmented
            mode="filter"
            label="Open projects in Developer view"
            value={openInDev}
            onChange={(v) =>
              start(async () => {
                await setOpenInDev(v);
                router.refresh();
              })
            }
            options={OPEN_IN_DEV}
          />
        </div>
      )}
    </section>
  );
}
