import Link from "next/link";
import type { ComponentProps, MouseEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icon";

type Variant = "primary" | "secondary" | "quiet";

const base =
  "inline-flex items-center justify-center gap-[7px] rounded-full border font-[550] whitespace-nowrap no-underline text-body transition-colors";

const variants: Record<Variant, string> = {
  primary: "bg-primary border-primary text-on-primary font-semibold hover:opacity-90",
  secondary: "bg-surface border-line-ctl text-ink hover:bg-selected",
  quiet: "bg-transparent border-transparent text-ink hover:bg-selected",
};

const disabledStyles: Record<Variant, string> = {
  // A disabled primary keeps its weight so the screen still has an anchor.
  primary: "bg-primary-disabled border-primary-disabled text-on-primary hover:opacity-100 cursor-not-allowed",
  secondary: "bg-selected border-transparent text-ink-3 hover:bg-selected cursor-not-allowed",
  quiet: "bg-transparent border-transparent text-ink-3 hover:bg-transparent cursor-not-allowed",
};

export function buttonClasses({
  variant = "secondary",
  size = "md",
  disabled = false,
  className,
}: { variant?: Variant; size?: "md" | "sm"; disabled?: boolean; className?: string }) {
  return cn(
    base,
    size === "sm" ? "min-h-8 px-3" : "min-h-[38px] px-4",
    variants[variant],
    disabled && disabledStyles[variant],
    className,
  );
}

type ButtonProps = Omit<ComponentProps<"button">, "disabled"> & {
  variant?: Variant;
  size?: "md" | "sm";
  icon?: IconName;
  iconAfter?: IconName;
  /** Why the button can't be pressed. Disabled buttons always say why (title + visible text nearby). */
  disabledReason?: string;
  href?: string;
};

/**
 * Pill-shaped button. One `primary` per screen.
 * Disabled buttons use aria-disabled (so they stay focusable and the reason is readable) and swallow clicks.
 */
export function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconAfter,
  disabledReason,
  href,
  className,
  children,
  onClick,
  title,
  type = "button",
  ...rest
}: ButtonProps) {
  const disabled = disabledReason !== undefined;
  const classes = buttonClasses({ variant, size, disabled, className });
  const content = (
    <>
      {icon && <Icon name={icon} size="sm" />}
      {children}
      {iconAfter && <Icon name={iconAfter} size="sm" />}
    </>
  );
  if (href && !disabled) {
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }
  return (
    <button
      type={type}
      className={classes}
      aria-disabled={disabled || undefined}
      title={disabledReason ?? title}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      {...rest}
    >
      {content}
    </button>
  );
}

/** Icon-only button. Needs a label. */
export function IconButton({
  icon,
  label,
  quiet = false,
  size = 38,
  className,
  type = "button",
  ...rest
}: Omit<ComponentProps<"button">, "children"> & { icon: IconName; label: string; quiet?: boolean; size?: 32 | 36 | 38 }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "grid flex-none place-items-center rounded-full border text-ink transition-colors hover:bg-selected",
        quiet ? "border-transparent bg-transparent" : "border-line-ctl bg-surface",
        size === 32 ? "size-8" : size === 36 ? "size-9" : "size-[38px]",
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size="sm" />
    </button>
  );
}

const linkClasses =
  "inline-flex min-h-6 items-center border-0 bg-transparent p-0 text-body font-semibold text-ink underline decoration-line-ctl underline-offset-[3px] hover:decoration-ink";

/** Text link with a 24px target. Renders a link with href, otherwise a button. */
export function TextLink({
  href,
  children,
  className,
  ...rest
}: { href?: string; children: ReactNode; className?: string } & Omit<ComponentProps<"button">, "children">) {
  if (href) {
    return (
      <Link href={href} className={cn(linkClasses, className)}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={cn(linkClasses, className)} {...rest}>
      {children}
    </button>
  );
}
