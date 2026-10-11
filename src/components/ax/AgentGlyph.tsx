import { cn } from "@/lib/utils";
import type { AgentRole } from "@/lib/brand";

/** Each role's shape on a 7×7 dot grid ("x" is a moss dot; the rest stay faint). */
const SHAPES: Record<AgentRole, string[]> = {
  planner: ["..xxx..", ".x...x.", "x.....x", "x.....x", "x.....x", ".x...x.", "..xxx.."],
  extractor: ["....xxx", "...xxx.", "...xxx.", "..xxx..", ".xxx...", ".xxx...", "xxx...."],
  checker: ["...x...", "..xxx..", ".xx.xx.", "xx...xx", ".xx.xx.", "..xxx..", "...x..."],
  notifier: ["...x...", "..xxx..", ".xxxxx.", ".xxxxx.", ".xxxxx.", "xxxxxxx", "...x..."],
  router: ["x.....x", ".x...x.", "..x.x..", "...x...", "...x...", "...x...", "...x..."],
  writer: ["xxxxxxx", ".......", "xxxxxx.", ".......", "xxxxxxx", ".......", "xxxx..."],
  "data analyst": [".....x.", ".....x.", "...x.x.", "...x.x.", ".x.x.x.", ".x.x.x.", "xxxxxxx"],
  custom: [".......", "..x.x..", ".x.x.x.", "..x.x..", ".x.x.x.", "..x.x..", "......."],
};

const RADIUS: Record<AgentGlyphSize, number> = { 20: 6, 34: 10, 52: 10 };
export type AgentGlyphSize = 20 | 34 | 52;

/**
 * An agent's picture (Soft Tray v4): its role as a dotted shape in moss on a mist tile. Sizes: 20 in lists, 34 on
 * cards and graph nodes, 52 on the agent's detail. Decorative: the agent's name sits beside it.
 */
export function AgentGlyph({ role, size = 34, className }: { role: AgentRole; size?: AgentGlyphSize; className?: string }) {
  const shape = SHAPES[role] ?? SHAPES.custom;
  // The grid fills the middle 70% of the tile.
  const pitch = (size * 0.7) / 7;
  const origin = (size - pitch * 7) / 2 + pitch / 2;
  const dot = pitch * 0.34;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-role={role}
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className={cn("flex-none", className)}
    >
      <rect width={size} height={size} rx={RADIUS[size]} style={{ fill: "var(--brand-mist)" }} />
      {shape.flatMap((row, y) =>
        [...row].map((c, x) => (
          <circle
            key={`${x}-${y}`}
            cx={origin + x * pitch}
            cy={origin + y * pitch}
            r={c === "x" ? dot : dot * 0.6}
            style={{ fill: c === "x" ? "var(--brand-moss)" : "var(--brand-mist-cell)" }}
          />
        )),
      )}
    </svg>
  );
}
