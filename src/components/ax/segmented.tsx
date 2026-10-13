"use client";

import type { KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export type SegmentOption<T extends string> = { value: T; label: string; count?: number };

/**
 * Switches between views of one thing.
 * - `mode="tabs"`: stage views (role=tablist, arrow keys move between tabs).
 * - `mode="filter"`: list filters with counts (role=group, aria-pressed).
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  mode = "tabs",
  className,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  mode?: "tabs" | "filter";
  className?: string;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (mode !== "tabs" || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + (e.key === "ArrowRight" ? 1 : options.length - 1)) % options.length];
    onChange(next.value);
    const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>("button");
    buttons[options.indexOf(next)]?.focus();
  };
  return (
    <div
      role={mode === "tabs" ? "tablist" : "group"}
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("inline-flex gap-0.5 rounded-full bg-selected p-[3px]", className)}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role={mode === "tabs" ? "tab" : undefined}
            aria-selected={mode === "tabs" ? on : undefined}
            aria-pressed={mode === "filter" ? on : undefined}
            tabIndex={mode === "tabs" && !on ? -1 : undefined}
            onClick={() => onChange(o.value)}
            className={cn(
              "min-h-[30px] rounded-full border-0 bg-transparent px-3.5 text-body font-[550] whitespace-nowrap text-ink-2 transition-colors hover:text-ink",
              on && "bg-surface font-[650] text-ink shadow-[0_1px_2px_rgba(0,0,0,.1),0_0_0_1px_var(--line)]",
            )}
          >
            {o.label}
            {o.count !== undefined && <span className="tabular-nums"> {o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
