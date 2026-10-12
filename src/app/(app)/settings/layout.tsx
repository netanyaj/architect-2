import { canResetDemo, ROLE_INFO } from "@/lib/permissions";
import { getAppContext } from "@/server/workspace";
import { settingsMenu } from "./settings-menu";
import { SettingsNav } from "./settings-nav";

/** Settings (M6): a page per topic, with the menu on the left (at the top on a phone). */
export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const ctx = await getAppContext();
  const groups = settingsMenu({ demo: canResetDemo(ctx.role) && ctx.workspace.kind !== "personal" });
  return (
    <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-6 px-8 pt-10 pb-12 max-sm:px-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-[650]">Settings</h1>
        <p className="text-ink-2">
          {ctx.workspace.name} · you&apos;re {/^[AEIOU]/.test(ROLE_INFO[ctx.role].label) ? "an" : "a"} {ROLE_INFO[ctx.role].label}.{" "}
          {ROLE_INFO[ctx.role].can}
        </p>
      </div>
      <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-10 max-md:grid-cols-1 max-md:gap-5">
        <SettingsNav groups={groups} />
        <div className="flex min-w-0 flex-col gap-8">{children}</div>
      </div>
    </div>
  );
}
