import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icon";

/** A warm tray that groups white rows. */
export function Tray({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <ul aria-label={label} className={cn("flex flex-col gap-1.5 rounded-pane border border-line bg-tray p-1.5", className)}>
      {children}
    </ul>
  );
}

/** 34px icon tile. A dark tile marks the current project. */
export function IconTile({ icon, dark = false, className }: { icon: IconName; dark?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-[34px] flex-none place-items-center rounded-tile border border-line bg-surface text-ink",
        dark && "border-primary bg-primary text-on-primary",
        className,
      )}
    >
      <Icon name={icon} size="sm" />
    </span>
  );
}

/** Tool initials, 24px squares (C, G, S…). */
export function ToolInitials({ tools }: { tools: string[] }) {
  if (tools.length === 0) return null;
  return (
    <span className="inline-flex gap-[3px]" aria-label={`Tools: ${tools.join(", ")}`}>
      {tools.map((t) => (
        <span
          key={t}
          title={t}
          aria-hidden="true"
          className="inline-grid size-6 place-items-center rounded-[7px] border border-line bg-surface text-small font-bold"
        >
          {t[0]?.toUpperCase()}
        </span>
      ))}
    </span>
  );
}

/**
 * A row inside a tray: icon tile · name + meta · tools · status with the next action · trailing (⋯ menu or chevron).
 * With `href`, the name links to it; the trailing slot stays independently clickable.
 */
export function ListRow({
  icon,
  darkTile,
  name,
  meta,
  tools,
  status,
  trailing,
  href,
  selected,
  footer,
  className,
}: {
  icon: IconName;
  darkTile?: boolean;
  name: ReactNode;
  meta?: ReactNode;
  tools?: string[];
  status?: ReactNode;
  trailing?: ReactNode;
  href?: string;
  selected?: boolean;
  /** Shown under the row, inside the same card (an error, an invite link). */
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <li
      className={cn(
        "relative flex flex-col gap-2 rounded-card border border-line bg-surface px-4 py-3.5 text-ink",
        href && "hover:border-line-ctl",
        selected && "border-2 border-ink",
        className,
      )}
    >
      <div className="flex items-center gap-3.5">
      <IconTile icon={icon} dark={darkTile} />
      <div className="flex min-w-0 flex-1 flex-col">
        {href ? (
          <Link
            href={href}
            className="truncate font-semibold no-underline after:absolute after:inset-0 after:rounded-card after:content-['']"
          >
            {name}
          </Link>
        ) : (
          <span className="truncate font-semibold">{name}</span>
        )}
        {meta && <span className="truncate text-small text-ink-2">{meta}</span>}
      </div>
      {tools && <ToolInitials tools={tools} />}
      {status && <span className="relative flex-none max-sm:hidden">{status}</span>}
      {trailing && <span className="relative z-10 flex-none">{trailing}</span>}
      </div>
      {footer && <div className="relative z-10">{footer}</div>}
    </li>
  );
}
