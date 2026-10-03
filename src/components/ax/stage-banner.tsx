import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { StatusMark } from "./status-mark";

/**
 * A state that affects the whole stage, at the top of the stage pane.
 * - paused: 1.5px ink border, pause icon. Says what's kept, what's needed and what's spent.
 * - error: 1.5px failed border. Says what happened, what's kept and what it cost.
 * - question: 1.5px attention border, options as Option buttons. Build waits for the answer.
 */
export function StageBanner({
  kind,
  title,
  children,
  actions,
  className,
}: {
  kind: "paused" | "error" | "question";
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section
      role={kind === "error" ? "alert" : "status"}
      className={cn(
        "flex flex-col gap-2.5 rounded-card border-[1.5px] bg-surface px-4 py-3.5",
        kind === "paused" && "border-ink",
        kind === "error" && "border-failed",
        kind === "question" && "border-attention",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <StatusMark status={kind === "paused" ? "blocked" : kind === "error" ? "failed" : "attention"} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="font-semibold">{title}</h3>
          {children && <div className="text-ink-2">{children}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 pl-[30px]">{actions}</div>}
    </section>
  );
}

/** An answer option inside a question banner. */
export function Option({
  selected,
  onClick,
  children,
}: {
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-[38px] items-center gap-2 rounded-card border border-line-ctl bg-surface px-3.5 font-[550]",
        selected && "border-2 border-ink bg-selected",
      )}
    >
      {children}
    </button>
  );
}
