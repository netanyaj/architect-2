"use client";

import { useState, useTransition } from "react";
import { askSupport, createSupportTicket } from "@/server/actions/support";
import type { HelpContext } from "@/server/queries";
import { useUi } from "@/lib/ui-store";
import { HelpPanel, type HelpMessage } from "./help-panel";
import { SimTag } from "./pill";

/** Mounts the Help panel once per page and wires it to the bot and to tickets. Opened via useUi().openHelp(). */
export function HelpHost({ context }: { context: HelpContext }) {
  const open = useUi((s) => s.helpOpen);
  const projectId = useUi((s) => s.helpProjectId);
  const close = useUi((s) => s.closeHelp);
  const [messages, setMessages] = useState<HelpMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [ticket, setTicket] = useState<number | null>(null);
  const [ticketError, setTicketError] = useState<string>();
  const [pending, start] = useTransition();

  const askQuestion = (question: string) => {
    const history = messages;
    setMessages([...history, { role: "user", text: question }]);
    setDraft("");
    start(async () => {
      const r = await askSupport({ question, history });
      setMessages((m) => [...m, { role: "bot", text: r.ok ? r.answer : r.message }]);
    });
  };

  const talkToPerson = () =>
    start(async () => {
      setTicketError(undefined);
      const lastQuestion = [...messages].reverse().find((m) => m.role === "user")?.text ?? draft;
      const r = await createSupportTicket({ question: lastQuestion, transcript: messages, projectId });
      if (r.ok) setTicket(r.ticketId);
      else setTicketError(r.message);
    });

  const greeting = (
    <p>
      Hi {context.firstName}.{" "}
      {context.stuck.length > 0 ? (
        <>
          {context.stuck.map((s, i) => (
            <span key={s.name}>
              {i > 0 && " and "}
              <b>{s.name}</b> {s.phrase}
            </span>
          ))}
          . What can I help with?
        </>
      ) : (
        "What can I help with?"
      )}
    </p>
  );

  return (
    <HelpPanel
      open={open}
      onClose={close}
      greeting={greeting}
      suggestions={context.suggestions}
      messages={messages}
      pending={pending}
      draft={draft}
      onDraftChange={setDraft}
      onAsk={askQuestion}
      onTalkToPerson={talkToPerson}
      personSimulated
      ticketNote={
        ticket !== null ? (
          <p role="status" className="flex-1 text-small text-ink-2">
            Ticket <b className="text-ink tabular-nums">#{ticket}</b> is open, with this conversation attached.{" "}
            <SimTag className="align-middle" title="Tickets are saved, but nobody is staffing them in this prototype." />
          </p>
        ) : ticketError ? (
          <p role="alert" className="flex-1 text-small font-semibold text-failed">
            {ticketError}
          </p>
        ) : undefined
      }
    />
  );
}
