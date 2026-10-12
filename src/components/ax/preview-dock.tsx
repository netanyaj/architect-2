"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";

/** The app frame labelled with its version ("Test version"), holding the preview and the floating dock. */
export function PreviewFrame({
  url,
  badge,
  children,
  dock,
  className,
}: {
  url?: string;
  badge?: ReactNode;
  children: ReactNode;
  dock?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative mx-3 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-white max-md:min-h-[520px]", className)}>
      {(url || badge) && (
        <div className="flex items-center gap-2.5 border-b border-line bg-tray px-2.5 py-2">
          {badge}
          {url && (
            <span className="mx-auto flex h-7 max-w-[440px] flex-1 items-center gap-1.5 rounded-full border border-line bg-surface px-3 font-mono text-small text-ink-2">
              <Icon name="lock" size="sm" />
              <span className="truncate">{url}</span>
            </span>
          )}
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-auto">{children}</div>
      {/* The dock sits in its own bar under the app, so it never covers the app's content (M6 round 4). */}
      {dock && <div className="flex flex-none flex-wrap items-center justify-center gap-2 border-t border-line bg-tray px-2.5 py-2">{dock}</div>}
    </div>
  );
}

/** Architect's preview tools in one dark dock in the bar under the frame: Point at something and the problems. The size and Light / Dark switches are in the project header (M5.8). */
export function PreviewDock({
  pointing,
  onPointToggle,
  problems,
  onOpenProblems,
}: {
  pointing: boolean;
  onPointToggle: () => void;
  problems: number;
  onOpenProblems: () => void;
}) {
  const btn = "inline-flex min-h-[34px] min-w-[34px] items-center justify-center gap-1.5 rounded-full border-0 bg-transparent px-2.5 font-[550] whitespace-nowrap text-inherit";
  return (
    <div
      role="toolbar"
      aria-label="Preview tools"
      className="flex max-w-full flex-wrap items-center justify-center gap-1 rounded-full bg-primary p-[5px] text-on-primary"
    >
      <button type="button" aria-pressed={pointing} onClick={onPointToggle} className={cn(btn, pointing && "bg-on-primary/20")}>
        <Icon name="pointer" size="sm" />
        Point at something
      </button>
      {problems > 0 && (
        <button type="button" onClick={onOpenProblems} className={cn(btn, "bg-[#ffd9d9] font-bold text-[#8f1b20]")}>
          {problems} {problems === 1 ? "problem" : "problems"}
        </button>
      )}
    </div>
  );
}
