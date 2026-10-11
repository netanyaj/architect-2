import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** "10:02": a message's time, in the chat's quiet small type. */
export function chatTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/**
 * The chat column's grammar (M5.8 alignment): every message has a 22px header row (avatar and name, or "You", with the
 * time at the far end, all centred on one line), then its body on the same left edge as the avatar. Cards inside a
 * message take the column's full width and never more.
 */
function Header({ children, time, align = "start" }: { children: ReactNode; time?: string | null; align?: "start" | "end" }) {
  return (
    <div className={cn("flex h-[22px] items-center gap-2 text-small font-semibold text-ink-2", align === "end" && "justify-end")}>
      {children}
      {time && <span className={cn("font-normal text-ink-3 tabular-nums", align === "start" && "ml-auto")}>{time}</span>}
    </div>
  );
}

export function ArchitectMessage({ children, time, tag, label = "Architect" }: { children: ReactNode; time?: string | null; tag?: ReactNode; label?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Header time={time}>
        <span className="grid size-[22px] flex-none place-items-center rounded-[7px] bg-primary text-small font-bold text-on-primary" aria-hidden="true">
          A
        </span>
        {label}
        {tag}
      </Header>
      <div className="flex min-w-0 flex-col gap-2 break-words">{children}</div>
    </div>
  );
}

export function YouMessage({ children, time }: { children: ReactNode; time?: string | null }) {
  return (
    <div className="flex min-w-0 flex-col items-end gap-1.5">
      {time && <Header time={time} align="end">You ·</Header>}
      <div className="max-w-[86%] rounded-[16px_16px_4px_16px] bg-selected px-[13px] py-[9px] break-words whitespace-pre-wrap">{children}</div>
    </div>
  );
}

/** A card inside a message: exactly the column's width. */
export function ChatCard({ children, className, tone = "line", label }: { children: ReactNode; className?: string; tone?: "line" | "attention"; label?: string }) {
  return (
    <section aria-label={label} className={cn("flex w-full min-w-0 flex-col gap-2 rounded-card bg-surface px-3.5 py-3", tone === "attention" ? "border-[1.5px] border-attention" : "border border-line", className)}>
      {children}
    </section>
  );
}
