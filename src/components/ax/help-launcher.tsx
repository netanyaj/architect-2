"use client";

import { useUi } from "@/lib/ui-store";
import { Icon } from "./icon";

/**
 * Help outside projects (M5.5 review): a launcher at the bottom-right, the convention. Inside a project there's none
 * (the chat composer sits there); Help is the "?" at the end of the project header.
 */
export function HelpLauncher() {
  const { openHelp, helpOpen } = useUi();
  if (helpOpen) return null;
  return (
    <button
      type="button"
      onClick={() => openHelp()}
      className="fixed right-5 bottom-5 z-40 inline-flex min-h-11 items-center gap-2 rounded-full border border-line-ctl bg-surface px-4 font-semibold shadow-pop hover:bg-selected"
    >
      <Icon name="help" size="sm" />
      Help
    </button>
  );
}
