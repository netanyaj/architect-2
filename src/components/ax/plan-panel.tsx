"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";
import { StatusMark, type Status, type StatusIcon } from "./status-mark";

/** The project's parts (Needs you, In progress, Works, Up next), in a tray on the left. Collapses to a 56px rail. */
export function PlanPanel({
  title = "Parts",
  version,
  intro,
  progress,
  collapsed = false,
  onToggleCollapsed,
  footer,
  className,
  children,
}: {
  title?: string;
  /** e.g. "v1 · draft" */
  version?: string;
  intro?: ReactNode;
  /** 0..1 for the progress bar, with its label (cost appears once, here). */
  progress?: { value: number; label: string };
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Under the parts, outside their scroll (the tour guide). */
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  if (collapsed) {
    return (
      <aside aria-label="Parts" className="flex w-14 flex-none flex-col items-center rounded-pane border border-line bg-tray py-3 shadow-pane">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Open the parts panel"
          className="grid size-[38px] place-items-center rounded-full hover:bg-selected"
        >
          <Icon name="panelLeft" size="sm" />
        </button>
      </aside>
    );
  }
  return (
    <aside
      aria-label="Parts"
      className={cn("flex h-full min-h-0 flex-col overflow-hidden rounded-pane border border-line bg-tray shadow-pane md:w-[340px] md:flex-none", className)}
    >
      <div className="flex flex-col gap-2 px-4 pt-3.5 pb-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-heading font-[650]">{title}</h2>
          {version && <span className="text-small text-ink-2">{version}</span>}
          <span className="flex-1" />
          {onToggleCollapsed && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label="Collapse the parts panel"
              className="grid size-8 place-items-center rounded-full hover:bg-selected"
            >
              <Icon name="panelLeft" size="sm" />
            </button>
          )}
        </div>
        {intro && <p className="text-small text-ink-2">{intro}</p>}
        {progress && (
          <div className="flex flex-col gap-1.5">
            <div className="h-1.5 overflow-hidden rounded-full bg-selected" aria-hidden="true">
              <i className="block h-full bg-ink" style={{ width: `${Math.round(progress.value * 100)}%` }} />
            </div>
            <span className="text-small text-ink-2 tabular-nums">{progress.label}</span>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-1">{children}</div>
      {footer}
    </aside>
  );
}

/** A group in the fixed order: Needs you, In progress, Works, Up next. "Works" collapses after 3 rows. */
export function PlanGroup({
  title,
  count,
  collapseAfter,
  children,
}: {
  title: string;
  count?: number | string;
  collapseAfter?: number;
  children: ReactNode[] | ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = Array.isArray(children) ? children : [children];
  const hidden = collapseAfter !== undefined && !expanded ? Math.max(0, rows.length - collapseAfter) : 0;
  const shown = hidden > 0 ? rows.slice(0, collapseAfter) : rows;
  return (
    <section className="mx-2.5 mb-2.5 rounded-card border border-line bg-surface px-1.5 pt-1.5 pb-2">
      <h3 className="flex items-center justify-between px-2 pt-1.5 pb-1 text-body font-[650]">
        {title}
        {count !== undefined && <span className="text-small font-medium text-ink-3 tabular-nums">{count}</span>}
      </h3>
      <ul className="flex flex-col">{shown.map((row, i) => <li key={i}>{row}</li>)}</ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="ml-2 min-h-6 text-body font-semibold underline decoration-line-ctl underline-offset-[3px]"
        >
          Show {hidden} more
        </button>
      )}
    </section>
  );
}

/** One part of the plan. Finished rows get only a quiet check, never a filled chip. */
export function PlanRow({
  status,
  icon,
  title,
  detail,
  selected,
  onClick,
  struck,
}: {
  status: Status;
  icon?: StatusIcon;
  title: string;
  detail?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  struck?: boolean;
}) {
  return (
    <button
      type="button"
      // The tour's "Proof per part" step opens the first part that works.
      data-tour={status === "works" ? "part-works" : undefined}
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-tile border-0 bg-transparent p-2 text-left text-ink hover:bg-selected",
        selected && "bg-selected",
      )}
    >
      <StatusMark status={status} icon={icon} />
      <span className="min-w-0 flex-1">
        <span className={cn("block", struck && "text-ink-3 line-through")}>{title}</span>
        {detail && <span className="mt-0.5 block text-small text-ink-2">{detail}</span>}
      </span>
    </button>
  );
}
