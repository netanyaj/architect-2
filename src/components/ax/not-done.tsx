"use client";

import type { NotDone } from "@/lib/readiness";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusMark, type StatusIcon } from "./status-mark";

const ICON: Record<NotDone["status"], StatusIcon | undefined> = { blocked: "pause", attention: "plug", approval: "lock", building: "spin", todo: "dot" };

/** What isn't done yet (A-10): each part with its reason. A row opens the part. */
export function NotDoneList({ rows, onOpen }: { rows: NotDone[]; onOpen?: (key: string) => void }) {
  return (
    <ul aria-label="What's not done" className="flex flex-col divide-y divide-line">
      {rows.map((r) => (
        <li key={r.key}>
          <button type="button" onClick={() => onOpen?.(r.key)} className="flex w-full items-start gap-2.5 rounded-tile px-2.5 py-2 text-left hover:bg-selected">
            <StatusMark status={r.status} icon={ICON[r.status]} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{r.title}</span>
              <span className="block text-small text-ink-2">{r.reason}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** On the stepper: "Not done · 3", opening the list. Hidden when every part works. */
export function NotDoneButton({ rows, onOpen }: { rows: NotDone[]; onOpen: (key: string) => void }) {
  if (!rows.length) return null;
  return (
    <Popover>
      <PopoverTrigger className="flex min-h-[30px] items-center gap-1.5 rounded-full px-3 text-body font-[550] text-ink-2 hover:bg-selected">
        Not done <span className="tabular-nums">· {rows.length}</span>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-[340px] rounded-card border border-line bg-surface p-1.5 shadow-pop">
        <p className="px-2.5 pt-1.5 pb-1 text-small font-semibold text-ink-2">What&apos;s not done, and why</p>
        <NotDoneList rows={rows} onOpen={onOpen} />
      </PopoverContent>
    </Popover>
  );
}
