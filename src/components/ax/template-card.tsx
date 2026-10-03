import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { IconTile } from "./list-row";
import type { IconName } from "./icon";
import { Tag } from "./pill";

/** A starting point. Picking one fills the Home prompt so it can be edited before the plan is written. */
export function TemplateCard({
  icon,
  kind,
  name,
  description,
  footer,
  onPick,
  className,
}: {
  icon: IconName;
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
        <IconTile icon={icon} />
        {kind && <Tag>{kind}</Tag>}
      </span>
      <span className="font-semibold">{name}</span>
      <span className="text-small text-ink-2">{description}</span>
      {footer && <span className="mt-auto text-small text-ink-3">{footer}</span>}
    </button>
  );
}
