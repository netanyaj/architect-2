import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icon";

/**
 * A pressable option that sits inside the box it acts on.
 * - `pressed` makes it a toggle.
 * - `soft` is a picker showing its current value (the model).
 */
export function Pill({
  icon,
  iconAfter,
  pressed,
  soft = false,
  disabledReason,
  className,
  children,
  onClick,
  title,
  type = "button",
  ...rest
}: ComponentProps<"button"> & { icon?: IconName; iconAfter?: IconName; pressed?: boolean; soft?: boolean; disabledReason?: string }) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      aria-disabled={disabledReason ? true : undefined}
      title={disabledReason ?? title}
      onClick={(e) => (disabledReason ? e.preventDefault() : onClick?.(e))}
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-body font-[550] whitespace-nowrap text-ink transition-colors",
        soft ? "border-line bg-tray hover:bg-selected" : "border-line-ctl bg-surface hover:bg-selected",
        pressed && "border-ink bg-selected",
        disabledReason && "cursor-not-allowed border-line text-ink-3 hover:bg-surface",
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} size="sm" />}
      {children}
      {iconAfter && <Icon name={iconAfter} size="sm" />}
    </button>
  );
}

/** A non-pressable label (Template, Agentlet, recommended). */
export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full bg-selected px-[9px] text-small font-semibold whitespace-nowrap text-ink-2",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Every simulated surface wears this: a dashed outline pill saying "Simulated".
 * Never hide that something is simulated.
 */
export function SimTag({ title, className, children = "Simulated" }: { title?: string; className?: string; children?: ReactNode }) {
  return (
    <span
      title={title ?? "Simulated in this prototype"}
      className={cn(
        "inline-flex h-6 items-center rounded-full border border-dashed border-line-ctl px-[9px] text-small font-semibold whitespace-nowrap text-ink-2",
        className,
      )}
    >
      {children}
    </span>
  );
}
