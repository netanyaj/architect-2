"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Segmented } from "@/components/ax/segmented";
import { setTheme } from "@/server/actions/projects";

/** Light or dark: saved to the person's account, and used everywhere, Developer view included. */
export function AppearanceSection({ theme }: { theme: "light" | "dark" }) {
  const router = useRouter();
  const [, start] = useTransition();
  return (
    <section aria-labelledby="appearance" className="flex flex-col gap-3">
      <h2 id="appearance" className="text-heading font-[650]">
        Appearance
      </h2>
      <div className="flex flex-wrap items-center gap-4 rounded-card border border-line p-4">
        <p className="min-w-[220px] flex-1 text-ink-2">Your theme, saved to your account. Developer view uses it too.</p>
        <Segmented
          mode="filter"
          label="Theme"
          value={theme}
          onChange={(t) =>
            start(async () => {
              document.documentElement.setAttribute("data-theme", t);
              await setTheme(t);
              router.refresh();
            })
          }
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </div>
    </section>
  );
}
