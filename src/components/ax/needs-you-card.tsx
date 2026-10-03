import type { ReactNode } from "react";
import { StatusMark, type Status, type StatusIcon } from "./status-mark";

/**
 * A blocker with the one thing the user can do about it.
 * The sentence always says what still works. When the user can fix it, the action is the screen's
 * primary (Button variant="primary" size="sm"); when they can only wait, it's a TextLink.
 */
export function NeedsYouCard({
  status,
  icon,
  name,
  children,
  action,
}: {
  status: Extract<Status, "attention" | "approval" | "failed" | "blocked">;
  icon?: StatusIcon;
  name: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mx-0.5 my-1 flex flex-col gap-2.5 rounded-card border border-line bg-surface p-3">
      <div className="flex items-start gap-2.5">
        <StatusMark status={status} icon={icon} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{name}</div>
          <p className="mt-0.5 text-small text-ink-2">{children}</p>
        </div>
      </div>
      {action && <div className="pl-[30px]">{action}</div>}
    </div>
  );
}
