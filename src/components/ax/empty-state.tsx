import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { IconName } from "./icon";
import { IconTile } from "./list-row";

/**
 * What a page shows when there's nothing in it yet: icon tile (or a picture), a title naming what's missing,
 * one sentence on what happens next, the primary action, an alternative and a help link.
 */
export function EmptyState({
  icon,
  picture,
  title,
  children,
  primary,
  alternative,
  help,
  className,
}: {
  icon: IconName;
  /** A small picture in place of the icon tile: a mosaic in mist and moss with one accent (Soft Tray v4). */
  picture?: ReactNode;
  title: string;
  children: ReactNode;
  primary?: ReactNode;
  alternative?: ReactNode;
  help?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto flex max-w-[460px] flex-col items-center gap-3 px-6 py-12 text-center", className)}>
      {picture ?? <IconTile icon={icon} />}
      <h2 className="text-heading font-[650]">{title}</h2>
      <p className="text-ink-2">{children}</p>
      {(primary || alternative) && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {primary}
          {alternative}
        </div>
      )}
      {help && <div className="mt-1">{help}</div>}
    </div>
  );
}
