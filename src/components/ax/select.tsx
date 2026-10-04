import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";

/**
 * A native select in the pill style. The browser's own arrow is hidden (it ignores padding);
 * ours sits 12px from the right edge with an even gap after the text.
 * Use aria-disabled + a title for a locked value, so the reason stays readable; it then shows no arrow.
 */
export function Select({
  controlSize = "sm",
  className,
  wrapperClassName,
  children,
  ...rest
}: Omit<ComponentProps<"select">, "size"> & { controlSize?: "sm" | "md"; wrapperClassName?: string }) {
  const locked = Boolean(rest["aria-disabled"]);
  return (
    <span className={cn("relative inline-flex flex-none", wrapperClassName)}>
      <select
        className={cn(
          "w-full appearance-none rounded-full border border-line-ctl bg-surface pl-3.5 text-body font-[550] text-ink",
          locked ? "pr-3.5" : "pr-9",
          "aria-disabled:cursor-not-allowed aria-disabled:border-transparent aria-disabled:bg-selected aria-disabled:text-ink-3",
          controlSize === "sm" ? "min-h-8" : "min-h-[38px]",
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      {/* A locked value can't open, so it gets no arrow. */}
      {!locked && (
        <Icon name="chevronDown" size="sm" className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-2" />
      )}
    </span>
  );
}
