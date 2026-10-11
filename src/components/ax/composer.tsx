"use client";

import { useId, useRef, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icon";

/**
 * The message box for Home and Chat.
 * - Home: context pills inside the box, voice stays, Send is the labelled primary "Write the plan ↑".
 * - Chat: Send is a 36px round icon button, no voice, so nothing clips at 344px. The + and ⋯ menus come in `tools`.
 * There's no mode switch (M5.8): Architect reads each message as a question or a change request.
 */
export function Composer({
  variant,
  value,
  onChange,
  onSubmit,
  tools,
  modelPicker,
  contextPills,
  attachments,
  placeholder,
  submitLabel = "Write the plan",
  submitDisabledReason,
  pending = false,
  label = "Describe what to build",
  className,
}: {
  variant: "home" | "chat";
  value: string;
  onChange: (value: string) => void;
  /** Gets the text as the box holds it at submit (it can differ from `value` if typed before the page was ready). */
  onSubmit: (value: string) => void;
  /** Chat only: the + menu (files, building blocks, look) and the ⋯ menu, before the model pill. */
  tools?: ReactNode;
  /** The model pill (a picker); rendered by the caller so it can own the model list. */
  modelPicker?: ReactNode;
  /** Home only: Add files, agents or tools · Import a repo · Templates and prompts · Help me decide */
  contextPills?: ReactNode;
  /** Attached files or agents, shown above the text. */
  attachments?: ReactNode;
  placeholder?: string;
  submitLabel?: string;
  submitDisabledReason?: string;
  pending?: boolean;
  label?: string;
  className?: string;
}) {
  const id = useId();
  const empty = value.trim().length === 0;
  const blockedReason = submitDisabledReason ?? (empty ? "Type what you want first" : undefined);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const current = textRef.current?.value ?? value;
    if (current !== value) onChange(current);
    if (submitDisabledReason || pending || current.trim().length === 0) return;
    onSubmit(current);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
  };
  const home = variant === "home";
  return (
    <form
      onSubmit={submit}
      className={cn(
        "flex flex-col border border-line-ctl bg-surface",
        home ? "gap-3 rounded-[22px] px-3.5 pt-3.5 pb-3 shadow-hero" : "gap-2 rounded-pane px-2.5 pt-2.5 pb-2",
        className,
      )}
    >
      {attachments && <div className="flex flex-wrap gap-2">{attachments}</div>}
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        id={id}
        ref={textRef}
        name="prompt"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        rows={home ? 3 : 2}
        className={cn(
          "resize-none border-0 bg-transparent px-1.5 py-1 outline-none placeholder:text-ink-3 focus-visible:outline-none",
          home ? "min-h-[72px] text-sub" : "min-h-11 text-body",
        )}
      />
      {home && contextPills && <div className="flex flex-wrap gap-2 border-b border-line pb-3">{contextPills}</div>}
      <div className="flex items-center gap-2">
        {!home && tools}
        {modelPicker}
        <span className="flex-1" />
        {home && (
          <button
            type="button"
            aria-label="Speak instead of typing"
            aria-disabled
            title="Voice input isn't in this prototype yet. Type your request instead."
            className="grid size-[38px] cursor-not-allowed place-items-center rounded-full text-ink-3"
          >
            <Icon name="mic" size="sm" />
          </button>
        )}
        {home ? (
          <button
            type="submit"
            aria-disabled={blockedReason || pending ? true : undefined}
            title={blockedReason}
            className={cn(
              "inline-flex min-h-[38px] items-center gap-[7px] rounded-full border border-primary bg-primary px-4 font-semibold text-on-primary",
              (blockedReason || pending) && "cursor-not-allowed border-primary-disabled bg-primary-disabled",
            )}
          >
            {pending ? "Writing…" : submitLabel}
            <Icon name="arrowUp" size="sm" />
          </button>
        ) : (
          <button
            type="submit"
            aria-label="Send"
            aria-disabled={blockedReason || pending ? true : undefined}
            title={blockedReason ?? "Send"}
            className={cn(
              "grid size-9 flex-none place-items-center rounded-full bg-primary text-on-primary",
              (blockedReason || pending) && "cursor-not-allowed bg-primary-disabled",
            )}
          >
            <Icon name="arrowUp" size="sm" />
          </button>
        )}
      </div>
    </form>
  );
}

/** A queued message, shown above the composer. */
export function QueueLine({ children, onEdit }: { children: ReactNode; onEdit?: () => void }) {
  return (
    <div className="mx-4 mb-2 flex items-center gap-2 rounded-card bg-selected px-3 py-2">
      <Icon name="clock" size="sm" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {onEdit && (
        <button type="button" onClick={onEdit} className="min-h-6 font-semibold underline decoration-line-ctl underline-offset-[3px]">
          Edit
        </button>
      )}
    </div>
  );
}

/** A removable attachment chip inside the composer. */
export function AttachmentChip({ icon, children, onRemove }: { icon: IconName; children: ReactNode; onRemove?: () => void }) {
  return (
    <span className="inline-flex h-[30px] max-w-full min-w-0 items-center gap-1.5 rounded-[9px] border border-line bg-tray pr-1 pl-2.5 [&>span]:truncate">
      <Icon name={icon} size="sm" />
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label="Remove" className="grid size-6 flex-none place-items-center text-ink-2">
          <Icon name="close" size="sm" />
        </button>
      )}
    </span>
  );
}
