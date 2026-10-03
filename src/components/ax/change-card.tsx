import type { ReactNode } from "react";
import { Button } from "./button";

/**
 * A suggested change to the plan, from a chat request. Nothing builds until Apply.
 * Apply is secondary when the screen already has a primary.
 */
export function ChangeCard({
  label = "Suggested change",
  children,
  cost,
  applyIsPrimary = false,
  applyDisabledReason,
  onApply,
  onEdit,
  onDiscard,
}: {
  label?: string;
  children: ReactNode;
  /** e.g. "~18 credits · about 3 min" */
  cost: string;
  applyIsPrimary?: boolean;
  applyDisabledReason?: string;
  onApply?: () => void;
  onEdit?: () => void;
  onDiscard?: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-card border border-line bg-surface px-3.5 py-3">
      <span className="text-small font-[650] text-ink-2">{label}</span>
      <div>{children}</div>
      <span className="text-small text-ink-2 tabular-nums">{cost}</span>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Button size="sm" variant={applyIsPrimary ? "primary" : "secondary"} onClick={onApply} disabledReason={applyDisabledReason}>
          Apply
        </Button>
        <Button size="sm" variant="quiet" onClick={onEdit}>
          Edit
        </Button>
        <Button size="sm" variant="quiet" onClick={onDiscard}>
          Discard
        </Button>
      </div>
      {applyDisabledReason && <span className="text-small text-ink-2">{applyDisabledReason}</span>}
    </div>
  );
}
