/** While a page in the app loads (Home, Projects, Connections, Settings, Governance): a quiet skeleton of the page. */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="mx-auto flex w-full max-w-[1040px] flex-col gap-[22px] px-8 pt-10 pb-12 max-sm:px-4">
      <div className="h-8 w-56 animate-pulse rounded-tile bg-tray" />
      <div className="h-4 w-80 max-w-full animate-pulse rounded-tile bg-tray" />
      <div className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3.5">
            <div className="size-9 flex-none animate-pulse rounded-[10px] bg-tray" />
            <div className="flex flex-1 flex-col gap-1.5">
              <div className="h-4 w-48 max-w-full animate-pulse rounded-tile bg-tray" />
              <div className="h-3 w-72 max-w-full animate-pulse rounded-tile bg-tray" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
