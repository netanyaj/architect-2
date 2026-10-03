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
    <div className={cn("relative mx-3 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-white", className)}>
      {(url || badge) && (
        <div className="flex items-center gap-2.5 border-b border-[#e4e6ea] bg-[#f7f8fa] px-2.5 py-2">
          {badge}
          {url && (
            <span className="mx-auto flex h-7 max-w-[440px] flex-1 items-center gap-1.5 rounded-full border border-[#dfe2e7] bg-white px-3 font-mono text-small text-[#454b57]">
              <Icon name="lock" size="sm" />
              <span className="truncate">{url}</span>
            </span>
          )}
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-auto">{children}</div>
      {dock}
    </div>
  );
}

/** Architect's preview tools in one dark dock at the bottom of the frame. It never shrinks the app. */
export function PreviewDock({
  size,
  onSizeChange,
  pointing,
  onPointToggle,
  problems,
  onOpenProblems,
}: {
  size: "desktop" | "phone";
  onSizeChange: (size: "desktop" | "phone") => void;
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
      className="absolute bottom-3.5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-primary p-[5px] text-on-primary shadow-[0_10px_30px_rgba(0,0,0,.2)]"
    >
      <button type="button" aria-label="Desktop size" aria-pressed={size === "desktop"} onClick={() => onSizeChange("desktop")} className={cn(btn, size === "desktop" && "bg-white/20")}>
        <Icon name="desktop" size="sm" />
      </button>
      <button type="button" aria-label="Phone size" aria-pressed={size === "phone"} onClick={() => onSizeChange("phone")} className={cn(btn, size === "phone" && "bg-white/20")}>
        <Icon name="phone" size="sm" />
      </button>
      <span className="h-5 w-px bg-white/25" aria-hidden="true" />
      <button type="button" aria-pressed={pointing} onClick={onPointToggle} className={cn(btn, pointing && "bg-white/20")}>
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
