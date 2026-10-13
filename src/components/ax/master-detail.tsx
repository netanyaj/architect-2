import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { StatusMark, type Status, type StatusIcon } from "./status-mark";

/**
 * Screen 11's master–detail: a 380px tray on the left (title, a line, filters, the rows) and the selected item on
 * the right. Approvals and every Governance section use it. Stacks on phones.
 */
export function MasterDetail({
  title,
  intro,
  filters,
  listLabel,
  rows,
  detailLabel,
  children,
}: {
  title: string;
  intro: ReactNode;
  filters?: ReactNode;
  listLabel: string;
  rows: ReactNode;
  detailLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 max-md:flex-col">
      <section aria-label={listLabel} className="flex flex-none flex-col border-r border-line bg-tray max-md:border-r-0 max-md:border-b md:w-[380px] md:rounded-l-pane">
        <div className="flex flex-col gap-2.5 px-5 pt-6 pb-3">
          <h1 className="text-title font-[650]">{title}</h1>
          <div className="text-small text-ink-2">{intro}</div>
          {filters}
        </div>
        <ul aria-label={listLabel} className="flex flex-col gap-2 px-2.5 pb-4">
          {rows}
        </ul>
      </section>
      <section aria-label={detailLabel} className="flex min-w-0 flex-1 flex-col">
        {children}
      </section>
    </div>
  );
}

/** A row in the master list: a status mark, the name and one line, and an optional age. */
export function MasterRow({
  on,
  onClick,
  status,
  icon,
  title,
  meta,
  aside,
}: {
  on: boolean;
  onClick: () => void;
  status: Status;
  icon?: StatusIcon;
  title: string;
  meta: string;
  aside?: string;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={on || undefined}
        onClick={onClick}
        className={cn("flex w-full items-center gap-3 rounded-card border border-line bg-surface px-3.5 py-3 text-left transition-colors hover:border-line-ctl", on && "border-2 border-ink px-[13px] py-[11px]")}
      >
        <StatusMark status={status} icon={icon} />
        <span className="flex min-w-0 flex-1 flex-col">
          <strong className="truncate font-[650]">{title}</strong>
          <span className="truncate text-small text-ink-2">{meta}</span>
        </span>
        {aside && <span className="flex-none text-small text-ink-2 tabular-nums">{aside}</span>}
      </button>
    </li>
  );
}

/** The detail's scrolling body and its sticky footer of actions (primary first). */
export function DetailBody({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <>
      <div className="flex-1 overflow-auto">
        <div className="mx-auto flex max-w-[680px] flex-col gap-5 px-6 pt-6 pb-8 max-sm:px-4">{children}</div>
      </div>
      {footer && <div className="flex flex-wrap items-center gap-2 border-t border-line px-6 py-3.5 max-sm:px-4">{footer}</div>}
    </>
  );
}

/** The detail's heading: a small line above (kind, rule), the title, and one sentence. */
export function DetailHead({ kicker, title, children, "data-tour": tour }: { kicker: ReactNode; title: string; children?: ReactNode; "data-tour"?: string }) {
  return (
    <div data-tour={tour} className="flex flex-col gap-1.5">
      <span className="flex flex-wrap items-center gap-2 text-small font-semibold text-ink-2">{kicker}</span>
      <h2 className="text-title font-[650]">{title}</h2>
      {children && <div className="text-ink-2">{children}</div>}
    </div>
  );
}
