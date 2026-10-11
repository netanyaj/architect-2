import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { IconTile } from "./list-row";
import type { IconName } from "./icon";
import { Tag } from "./pill";

/** A starting point. Picking one fills the Home prompt so it can be edited before the plan is written. */
export function TemplateCard({
  icon,
  picture,
  kind,
  name,
  description,
  footer,
  onPick,
  className,
}: {
  icon: IconName;
  /** A 34px picture in place of the icon tile: the template's mosaic (Soft Tray v4). */
  picture?: ReactNode;
  kind?: "Template" | "Agentlet" | "Prompt";
  name: string;
  description: string;
  footer?: ReactNode;
  onPick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "flex flex-col gap-2.5 rounded-card border border-line bg-surface p-4 text-left text-ink hover:border-line-ctl",
        className,
      )}
    >
      <span className="flex items-center justify-between">
        {picture ?? <IconTile icon={icon} />}
        {kind && <Tag>{kind}</Tag>}
      </span>
      <span className="font-semibold">{name}</span>
      <span className="text-small text-ink-2">{description}</span>
      {footer && <span className="mt-auto text-small text-ink-3">{footer}</span>}
    </button>
  );
}
