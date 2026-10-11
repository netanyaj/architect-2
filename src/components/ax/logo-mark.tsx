import { cn } from "@/lib/utils";

/**
 * The Architect mark: an "A" on a moss tile (Soft Tray v4; moss is a brand colour, for pictures and the mark only).
 * 30px beside the wordmark, 22px as Architect's avatar in chat and Help.
 */
export function LogoMark({ size = 30, className }: { size?: 22 | 30; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid flex-none place-items-center font-bold",
        size === 30 ? "size-[30px] rounded-[9px] text-body" : "size-[22px] rounded-[7px] text-small",
        className,
      )}
      // Inline, so a parent's text colour (the chat header's) can't reach the letter.
      style={{ background: "var(--brand-moss)", color: "var(--surface)" }}
    >
      A
    </span>
  );
}
