import { cn } from "@/lib/utils";
import { emptyParts, mosaicFor, MOSAIC_ROWS, type MosaicTone } from "@/lib/brand";

/** Brand and art colours (v4): pictures only. */
const FILL: Record<MosaicTone, string> = { moss: "var(--brand-moss)", fern: "var(--brand-fern)", mist: "var(--brand-mist-cell)" };

/**
 * A project's picture (Soft Tray v4): one column per plan part, moss when it works, fern while it's being built,
 * mist when it's up next, and one cell in the project's accent. Plain SVG with no state, so it renders on the server.
 * Decorative: the row or card next to it carries the meaning.
 */
export function MosaicThumb({
  seed,
  parts,
  size = 34,
  crop,
  className,
}: {
  /** The project's (or template's) id: it picks the accent and its cell. */
  seed: string;
  parts: { id: string; status: string }[];
  size?: number;
  /** Show only the first few columns. Defaults to 4 at 34px and below, all (up to 8) above. */
  crop?: number;
  className?: string;
}) {
  // At 34px and below a full mosaic reads as a skeleton: show the first 4 columns, as the header does (M5.9).
  const { columns, accent } = mosaicFor(seed, parts, crop ?? (size <= 34 ? 4 : undefined));
  // Cells fill a 100-unit box: square up to 4 columns, narrower beyond. Bottom-aligned and centred.
  const pad = 13;
  const gap = 3.5;
  const inner = 100 - pad * 2;
  const cellW = (inner - gap * (Math.max(columns.length, MOSAIC_ROWS) - 1)) / Math.max(columns.length, MOSAIC_ROWS);
  const cellH = (inner - gap * (MOSAIC_ROWS - 1)) / MOSAIC_ROWS;
  const width = columns.length * cellW + (columns.length - 1) * gap;
  const left = (100 - width) / 2;
  const bottom = 100 - pad;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cn("flex-none rounded-tile border border-line", className)}
      style={{ background: "var(--brand-mist)" }}
    >
      {columns.map((c, x) =>
        Array.from({ length: c.height }, (_, y) => {
          const isAccent = accent.column === x && accent.row === y;
          return (
            <rect
              key={`${x}-${y}`}
              x={left + x * (cellW + gap)}
              y={bottom - (y + 1) * cellH - y * gap}
              width={cellW}
              height={cellH}
              rx={Math.min(cellW, cellH) * 0.22}
              style={{ fill: isAccent ? `var(--art-${accent.colour})` : FILL[c.tone] }}
            />
          );
        }),
      )}
    </svg>
  );
}

/** An empty state's picture (Soft Tray v4): a small mosaic in mist and moss with one accent cell, unique per page. */
export function EmptyMosaic({ seed }: { seed: string }) {
  return <MosaicThumb seed={seed} parts={emptyParts(seed)} size={72} />;
}
