"use client";

import { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";

export type HelpMessage = { role: "user" | "bot"; text: string };

/**
 * Help with Architect: a greeting that names what's stuck, 3 suggested questions, "Talk to a person"
 * (a ticket, reply within one working day) and an ask field. Esc closes it.
 */
export function HelpPanel({
  open,
  onClose,
  greeting,
  suggestions,
  messages,
  pending,
  draft,
  onDraftChange,
  onAsk,
  onTalkToPerson,
  ticketNote,
  peopleOnline,
  className,
}: {
  open: boolean;
  onClose: () => void;
  greeting: ReactNode;
  suggestions: string[];
  messages: HelpMessage[];
  pending: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  onAsk: (question: string) => void;
  onTalkToPerson: () => void;
  /** Replaces the "Talk to a person" line once a ticket exists, e.g. "Ticket #12 is open…" */
  ticketNote?: ReactNode;
  peopleOnline?: boolean;
  className?: string;
}) {
  const inputId = useId();
  const titleId = useId();
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    inputRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending]);

  if (!open) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = draft.trim();
    if (q && !pending) onAsk(q);
  };
  return (
    <section
      role="dialog"
      aria-labelledby={titleId}
      className={cn(
        "fixed bottom-2.5 left-2.5 z-40 flex max-h-[min(640px,calc(100dvh-20px))] w-[min(380px,calc(100vw-20px))] flex-col overflow-hidden rounded-pane border border-line bg-surface shadow-pop",
        className,
      )}
    >
      <header className="flex items-center gap-2.5 px-4 pt-3.5 pb-2.5">
        <span className="grid size-[22px] place-items-center rounded-[7px] bg-primary text-small font-bold text-on-primary" aria-hidden="true">
          A
        </span>
        <h2 id={titleId} className="text-sub font-semibold">
          Help with Architect
        </h2>
        <span className="flex-1" />
        {peopleOnline && (
          <span className="inline-flex items-center gap-1.5 text-small font-[650] text-works">
            <i className="block size-2 rounded-full bg-current" aria-hidden="true" />
            People online
          </span>
        )}
        <button type="button" onClick={onClose} aria-label="Close help" className="grid size-8 place-items-center rounded-full hover:bg-selected">
          <Icon name="close" size="sm" />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto px-4 pb-3" aria-live="polite">
        <div className="rounded-card bg-selected px-3 py-2.5">{greeting}</div>
        {messages.length === 0 &&
          suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onAsk(s)}
              className="min-h-8 rounded-full border border-line-ctl bg-surface px-3 text-left font-semibold hover:bg-selected"
            >
              {s}
            </button>
          ))}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="max-w-[86%] self-end rounded-[16px_16px_4px_16px] bg-selected px-3 py-2">
              {m.text}
            </div>
          ) : (
            <div key={i} className="whitespace-pre-wrap">
              {m.text}
            </div>
          ),
        )}
        {pending && <div className="text-ink-2">Looking that up…</div>}
        <div ref={endRef} />
      </div>
      <div className="flex items-center gap-3 border-t border-line px-4 py-3">
        {ticketNote ?? (
          <>
            <p className="flex-1 text-small text-ink-2">A person replies within one working day. You get a ticket number.</p>
            <button
              type="button"
              onClick={onTalkToPerson}
              className="min-h-8 flex-none rounded-full border border-line-ctl bg-surface px-3 font-semibold hover:bg-selected"
            >
              Talk to a person
            </button>
          </>
        )}
      </div>
      <form onSubmit={submit} className="mx-3 mb-3 flex items-center gap-2 rounded-full border border-line-ctl bg-surface py-1 pr-1 pl-4">
        <label htmlFor={inputId} className="sr-only">
          Ask about Architect
        </label>
        <input
          id={inputId}
          ref={inputRef}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="Ask about Architect…"
          className="min-h-8 flex-1 border-0 bg-transparent outline-none placeholder:text-ink-3 focus-visible:outline-none"
        />
        <button
          type="submit"
          aria-label="Ask"
          aria-disabled={!draft.trim() || pending ? true : undefined}
          className={cn("grid size-8 place-items-center rounded-full bg-primary text-on-primary", (!draft.trim() || pending) && "bg-primary-disabled")}
        >
          <Icon name="arrowUp" size="sm" />
        </button>
      </form>
    </section>
  );
}
