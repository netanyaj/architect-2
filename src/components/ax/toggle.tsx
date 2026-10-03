"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A switch for settings that take effect at once. Always next to a label and one line of consequence.
 * Use a Button instead for anything that costs credits.
 */
export function Toggle({
  checked,
  onCheckedChange,
  label,
  consequence,
  disabledReason,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  consequence?: ReactNode;
  disabledReason?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <span id={id} className="font-semibold">
          {label}
        </span>
        {consequence && <span className="text-small text-ink-2">{consequence}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        aria-disabled={disabledReason ? true : undefined}
        title={disabledReason}
        onClick={() => !disabledReason && onCheckedChange(!checked)}
        className={cn(
          "relative h-[26px] w-[42px] flex-none rounded-full border-0",
          checked ? "bg-ink" : "bg-line-ctl",
          disabledReason && "cursor-not-allowed opacity-60",
        )}
      >
        <span
          aria-hidden="true"
          className={cn("absolute top-[3px] size-5 rounded-full bg-surface transition-[left]", checked ? "left-[19px]" : "left-[3px]")}
        />
      </button>
    </div>
  );
}

/** A label + value + action row, as in the Launch settings and the plan's "Choices I made for you". */
export function SettingRow({ label, value, action }: { label: string; value: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto] items-center gap-3 border-t border-line px-3.5 py-3 first:border-t-0">
      <span className="text-ink-2">{label}</span>
      <span className="min-w-0">{value}</span>
      <span>{action}</span>
    </div>
  );
}
