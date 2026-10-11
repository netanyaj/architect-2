"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IconButton, TextLink } from "@/components/ax/button";
import { ChatCard } from "@/components/ax/chat-message";
import { Tag } from "@/components/ax/pill";
import { Option } from "@/components/ax/stage-banner";
import { answerQuestion } from "@/server/actions/plan";
import type { PlanQuestion } from "@/server/project";

/**
 * The plan's open questions in chat (M5.8, Base44's pattern): one at a time, "1/3" with paging. A question that holds
 * Build is tagged "Needed to build"; the others have Skip, which keeps the recommended answer. Answering here is the
 * same as answering in the plan, where the questions still show.
 */
export function QuestionCard({ questions, editReason }: { questions: PlanQuestion[]; editReason?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  // Skipped this visit: they keep their recommended answer, and the card moves on.
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  // Blocking questions first: they're the ones Build waits for.
  const open = [...questions.filter((q) => !q.answer && q.blocking), ...questions.filter((q) => !q.answer && !q.blocking && !skipped.has(q.id))];
  const [index, setIndex] = useState(0);
  if (open.length === 0) return null;
  const at = Math.min(index, open.length - 1);
  const q = open[at];

  const answer = (value: string) =>
    start(async () => {
      setError(undefined);
      const r = await answerQuestion({ questionId: q.id, value });
      if (!r.ok) return setError(r.message);
      router.refresh();
    });

  return (
    <ChatCard label="Questions about the plan">
      <div className="flex min-h-8 items-center gap-2">
        {q.blocking ? <Tag>Needed to build</Tag> : <span className="text-small font-[650] text-ink-2">Has a default</span>}
        <span className="flex-1" />
        {open.length > 1 && (
          <span className="flex items-center gap-0.5">
            <IconButton icon="chevronLeft" label="Previous question" quiet size={32} disabled={at === 0} onClick={() => setIndex(at - 1)} className="disabled:text-ink-3" />
            <span className="text-small text-ink-2 tabular-nums" aria-live="polite">
              {at + 1}/{open.length}
            </span>
            <IconButton icon="chevronRight" label="Next question" quiet size={32} disabled={at === open.length - 1} onClick={() => setIndex(at + 1)} className="disabled:text-ink-3" />
          </span>
        )}
      </div>
      <p className="font-semibold">{q.text}</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={q.text}>
        {q.options.map((o) => (
          <Option key={o.value} onClick={editReason || pending ? undefined : () => answer(o.value)}>
            {o.label}
            {o.value === q.recommended && <Tag>recommended</Tag>}
          </Option>
        ))}
      </div>
      <p className="text-small text-ink-2">
        {editReason ??
          (q.blocking
            ? "Build waits for this one: there's no safe default."
            : "I'll use the recommended answer if you skip it. It's in the plan too, to change later.")}
      </p>
      {!q.blocking && !editReason && (
        <TextLink
          className="self-start text-small"
          onClick={() => {
            setSkipped(new Set(skipped).add(q.id));
            setIndex(at);
          }}
        >
          Skip
        </TextLink>
      )}
      {error && (
        <p role="alert" className="text-small font-semibold text-failed">
          {error}
        </p>
      )}
    </ChatCard>
  );
}
