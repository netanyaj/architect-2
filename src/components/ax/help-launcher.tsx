"use client";

import { useUi } from "@/lib/ui-store";
import { Icon } from "./icon";

/**
 * Help (M5.8): one 36px button, 16px from the bottom-right corner, on every screen, projects included. It opens the
 * Help panel upwards (ask about Architect, Talk to a person). Links (docs, Discord, What's new) live in Resources.
 * Layouts keep that corner clear: a strip below the page outside projects, a footer row under the chat composer in one.
 * On a phone the page scrolls under a floating button, so the button sits in a solid bar along the bottom instead, and
 * the page gets the bar's height as extra room at its end (globals.css), so nothing is ever hidden under it.
 */
export function HelpLauncher({
  projectId = null,
}: {
  projectId?: string | null;
}) {
  const { openHelp, closeHelp, helpOpen } = useUi();
  return (
    <>
      <div
        data-corner-bar
        aria-hidden
        className="fixed inset-x-0 bottom-0 z-30 h-[60px] border-t border-line bg-canvas md:hidden"
      />
      <button
        type="button"
        aria-label="Help"
        data-tour="help"
        title="Help"
        aria-expanded={helpOpen}
        onClick={() => (helpOpen ? closeHelp() : openHelp(projectId))}
        className="fixed right-4 bottom-4 z-40 grid size-9 place-items-center rounded-full border border-line-ctl bg-surface shadow-pop hover:bg-selected"
      >
        <Icon name={helpOpen ? "close" : "help"} size="sm" />
      </button>
    </>
  );
}
