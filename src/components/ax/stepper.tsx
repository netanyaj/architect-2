import { Fragment } from "react";
import { cn } from "@/lib/utils";

export type Stage = "plan" | "build" | "launch";

const stages: { id: Stage; label: string }[] = [
  { id: "plan", label: "Plan" },
  { id: "build", label: "Build" },
  { id: "launch", label: "Launch" },
];

/**
 * The project header's one answer to "where am I". The current stage carries the one progress figure.
 * On narrow screens only the current stage shows.
 */
export function Stepper({
  current,
  progress,
  paused = false,
  onSelect,
}: {
  current: Stage;
  /** e.g. "7 of 12 working · about 6 min", "1 question left", "paused at budget" */
  progress?: string;
  paused?: boolean;
  onSelect?: (stage: Stage) => void;
}) {
  const currentIndex = stages.findIndex((s) => s.id === current);
  return (
    <nav
      aria-label="Project stage"
      className="mx-auto flex items-center gap-1 rounded-full border border-line bg-surface p-1"
    >
      {stages.map((s, i) => {
        const done = i < currentIndex;
        const on = i === currentIndex;
        return (
          <Fragment key={s.id}>
            {i > 0 && <span className={cn("h-px w-[18px] bg-line-ctl", !on && "max-[900px]:hidden")} aria-hidden="true" />}
            <button
              type="button"
              aria-current={on ? "step" : undefined}
              onClick={() => onSelect?.(s.id)}
              className={cn(
                "flex items-center gap-2 rounded-full border-0 py-1.5 pr-3.5 pl-2 text-body font-[550] text-ink-2",
                on && "bg-primary text-on-primary",
                !on && "max-[900px]:hidden",
              )}
            >
              <span
                className={cn(
                  "grid size-[22px] place-items-center rounded-full text-small font-bold shadow-[inset_0_0_0_1.5px_var(--line-ctl)]",
                  done && "bg-works-bg text-works shadow-none",
                  on && "bg-on-primary text-primary shadow-none",
                )}
              >
                {done ? (
                  <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2.4]">
                    <path d="M3.5 8.5l3 3 6-7" />
                  </svg>
                ) : on && paused ? (
                  <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3 fill-none stroke-current [stroke-linecap:round] [stroke-width:2.4]">
                    <path d="M6 5v6M10 5v6" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              {s.label}
              {done && <span className="sr-only">(done)</span>}
              {on && progress && <span className="font-[450] opacity-85">· {progress}</span>}
            </button>
          </Fragment>
        );
      })}
    </nav>
  );
}
