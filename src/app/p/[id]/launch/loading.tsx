/** While Launch loads: the header, the three version cards and the checklist as placeholders. */
export default function Loading() {
  return (
    <div role="status" aria-label="Opening Launch" className="flex h-dvh flex-col gap-2.5 bg-canvas p-2.5">
      <div className="h-[56px] rounded-pane" />
      <div className="flex min-h-0 flex-1 gap-2.5">
        <div className="w-[340px] flex-none animate-pulse rounded-pane border border-line bg-tray max-md:hidden" />
        <div className="flex flex-1 flex-col gap-4 rounded-pane border border-line bg-surface p-8">
          <div className="h-8 w-64 animate-pulse rounded-tile bg-tray" />
          <div className="grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-card bg-tray" />
            ))}
          </div>
          <div className="h-40 animate-pulse rounded-card bg-tray" />
        </div>
      </div>
    </div>
  );
}
