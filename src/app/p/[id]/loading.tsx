import { CoachCard } from "@/components/ax/tour-guide";

/**
 * While the project loads: the three panes as quiet placeholders, so nothing jumps when it arrives. The tour's coach
 * card stays where it was (from the browser's copy), so changing pages never makes it flash.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Opening the project" className="flex h-dvh flex-col gap-2.5 bg-canvas p-2.5">
      <div className="h-[56px] rounded-pane" />
      <div className="flex min-h-0 flex-1 gap-2.5">
        <div className="w-[340px] flex-none animate-pulse rounded-pane border border-line bg-tray max-md:hidden" />
        <div className="flex-1 animate-pulse rounded-pane border border-line bg-surface" />
        <div className="w-[344px] flex-none animate-pulse rounded-pane border border-line bg-surface max-lg:hidden" />
      </div>
      <CoachCard />
    </div>
  );
}
