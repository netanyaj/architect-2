/**
 * The build loader (Soft Tray v4): a 56px shape morphing through the brand and art colours, with the build's current
 * progress line under it ("Build 4/6 · Building Rate-card check"). It sits in the empty preview while a build runs;
 * small inline spinners stay as they are. Under prefers-reduced-motion it's a still moss circle (globals.css).
 */
export function BuildLoader({ step, children }: { step: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span aria-hidden="true" className="ax-build-loader block size-14 rounded-full" />
      <p className="max-w-[420px] font-mono text-small text-ink-2">{step}</p>
      {children}
    </div>
  );
}
