"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Status = icon shape + colour (+ a word where it helps). Colour is only ever a status.
 * Blocked and paused are neutral ink with a pause icon, never amber or red.
 */
export type Status = "works" | "building" | "attention" | "approval" | "failed" | "blocked" | "todo";

/** Icon variants for statuses that come in several shapes (from the final screens). */
export type StatusIcon = "check" | "spin" | "alert" | "plug" | "lines" | "lock" | "pause" | "dot" | "minus";

const icons: Record<StatusIcon, ReactNode> = {
  check: <path d="M3.5 8.5l3 3 6-7" />,
  spin: <path className="origin-center animate-spin [animation-duration:1.4s]" d="M8 2.5a5.5 5.5 0 1 1-5.5 5.5" />,
  alert: <path d="M8 4v5M8 11.5v.1" />,
  plug: <path d="M6 2.5v3M10 2.5v3M4.5 5.5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11.5v2" />,
  lines: <path d="M3.5 5h9M3.5 8h9M3.5 11h5" />,
  lock: <><rect x="4" y="7.5" width="8" height="5.5" rx="1.3" /><path d="M5.6 7.5V6a2.4 2.4 0 0 1 4.8 0v1.5" /></>,
  pause: <path d="M6 5v6M10 5v6" />,
  dot: <circle cx="8" cy="8" r="1.5" fill="currentColor" />,
  minus: <path d="M4.5 8h7" />,
};

const defaultIcon: Record<Status, StatusIcon> = {
  works: "check",
  building: "spin",
  attention: "alert",
  approval: "lock",
  failed: "alert",
  blocked: "pause",
  todo: "dot",
};

const tone: Record<Status, string> = {
  works: "text-works bg-works-bg",
  building: "text-building bg-building-bg",
  attention: "text-attention bg-attention-bg",
  approval: "text-approval bg-approval-bg",
  failed: "text-failed bg-failed-bg",
  blocked: "text-ink-2 shadow-[inset_0_0_0_1.5px_var(--line-ctl)]",
  todo: "text-ink-2 shadow-[inset_0_0_0_1.5px_var(--line-ctl)]",
};

// Only the icon or dot carries the status colour (M5.9, doc 25): the word is ink-2, and ink for Blocked, so a list of
// rows doesn't become a column of colour. It's still icon plus word. ink-2 is 9.7:1 on surface in light, and more in dark.
const wordTone: Record<Status, string> = {
  works: "text-ink-2",
  building: "text-ink-2",
  attention: "text-ink-2",
  approval: "text-ink-2",
  failed: "text-ink-2",
  blocked: "text-ink",
  todo: "text-ink-2",
};

const dotTone: Record<Status, string> = {
  works: "bg-works",
  building: "bg-building",
  attention: "bg-attention",
  approval: "bg-approval",
  failed: "bg-failed",
  blocked: "bg-ink",
  todo: "bg-ink-3",
};

/** The 20px circle with the status icon. Decorative unless given a label. */
export function StatusMark({
  status,
  icon,
  label,
  className,
}: {
  status: Status;
  icon?: StatusIcon;
  label?: string;
  className?: string;
}) {
  // A status that changes while on screen (a part going Building → Works in a build) cross-fades, and a new Works tick
  // draws in. Nothing animates on first paint.
  const [prev, setPrev] = useState(status);
  const [changed, setChanged] = useState(false);
  if (prev !== status) {
    setPrev(status);
    setChanged(true);
  }
  return (
    <span
      key={changed ? status : "first"}
      className={cn("mt-px grid size-5 flex-none place-items-center rounded-full", tone[status], changed && "ax-fade-in", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className={cn("size-3 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2.4]", changed && status === "works" && "ax-tick")}
      >
        {icons[icon ?? defaultIcon[status]]}
      </svg>
    </span>
  );
}

/** "Dot plus word" for lists: "● Needs you: connect Gmail". */
export function StatusWord({
  status,
  children,
  className,
}: {
  status: Status;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-body font-[650]", wordTone[status], className)}>
      <i className={cn("block size-2 flex-none rounded-full", dotTone[status])} aria-hidden="true" />
      {children}
    </span>
  );
}

/** Status mark + word, as used in Home's "Continue where you left off" rows. */
export function StatusLine({
  status,
  icon,
  children,
  className,
}: {
  status: Status;
  icon?: StatusIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-body font-[650]", wordTone[status], className)}>
      <StatusMark status={status} icon={icon} />
      {children}
    </span>
  );
}
