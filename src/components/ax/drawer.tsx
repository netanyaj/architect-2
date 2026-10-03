"use client";

import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * Detail on demand, on the right over a 32% scrim. Esc closes it and focus returns to the opener (Radix).
 * Structure: header (icon, title, one-sentence state) · content · footer (one primary).
 */
export function Drawer({
  open,
  onOpenChange,
  icon,
  title,
  state,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon?: ReactNode;
  title: string;
  state?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "inset-y-2.5! right-2.5! h-auto! w-[min(520px,calc(100vw-20px))]! max-w-none! gap-0 overflow-hidden rounded-pane border border-line bg-surface p-0 shadow-drawer",
          className,
        )}
      >
        <div className="flex items-start gap-2.5 border-b border-line px-5 pt-[18px] pb-3.5 pr-12">
          {icon}
          <div className="flex min-w-0 flex-col gap-0.5">
            <SheetTitle className="text-sub font-semibold text-ink">{title}</SheetTitle>
            {state ? (
              <SheetDescription className="text-small text-ink-2">{state}</SheetDescription>
            ) : (
              <SheetDescription className="sr-only">{title}</SheetDescription>
            )}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-auto px-5 py-[18px]">{children}</div>
        {footer && <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
      </SheetContent>
    </Sheet>
  );
}
