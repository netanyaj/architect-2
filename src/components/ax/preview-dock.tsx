"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Icon } from "./icon";

/**
 * The app frame labelled with its version ("Test version"). The preview's tools sit beside its address (round 7):
 * Point at something and the problems. The bar under the app appears only when something needs saying there.
 */
export function PreviewFrame({
  url,
  badge,
  tools,
  children,
  dock,
  overlay,
  className,
}: {
  url?: string;
  badge?: ReactNode;
  /** Beside the address: PreviewTools. */
  tools?: ReactNode;
  children: ReactNode;
  /** The bar under the app (for example "This app has no dark theme yet"); left out when there's nothing to show. */
  dock?: ReactNode;
  /** Floats over the app, under the address bar (the problems list). */
  overlay?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative mx-3 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-white max-md:min-h-[520px]", className)}>
      {(url || badge || tools) && (
        <div className="flex items-center gap-2.5 border-b border-line bg-tray px-2.5 py-2">
          {badge}
          {url && (
            <span className="mx-auto flex h-7 max-w-[440px] min-w-0 flex-1 items-center gap-1.5 rounded-full border border-line bg-surface px-3 font-mono text-small text-ink-2">
              <Icon name="lock" size="sm" />
              <span className="truncate">{url}</span>
            </span>
          )}
          {tools}
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-auto">{children}</div>
      {overlay}
      {/* The bar sits under the app, so it never covers the app's content (M6 round 4). */}
      {dock && <div className="flex flex-none flex-wrap items-center justify-center gap-2 border-t border-line bg-tray px-2.5 py-2">{dock}</div>}
    </div>
  );
}

export const POINT_LABEL = "Point at something to change it";

/**
 * Architect's preview tools, beside the preview's address (round 7): a pointer button (pick something in the app and
 * its text goes to the chat box) and, when there are any, the problems. The size and Light / Dark switches are in the
 * project header (M5.8).
 */
export function PreviewTools({
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
  return (
    <div role="toolbar" aria-label="Preview tools" className="flex flex-none items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={POINT_LABEL}
            aria-pressed={pointing}
            onClick={onPointToggle}
            className={cn(
              "grid size-8 place-items-center rounded-full border",
              pointing ? "border-primary bg-primary text-on-primary" : "border-line-ctl bg-surface text-ink hover:bg-(--btn-hover)",
            )}
          >
            <Icon name="pointer" size="sm" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {POINT_LABEL}
        </TooltipContent>
      </Tooltip>
      {problems > 0 && (
        <button type="button" onClick={onOpenProblems} className="inline-flex min-h-8 items-center rounded-full bg-[#ffd9d9] px-3 text-small font-bold whitespace-nowrap text-[#8f1b20]">
          {problems} {problems === 1 ? "problem" : "problems"}
        </button>
      )}
    </div>
  );
}
