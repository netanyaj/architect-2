"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Button, IconButton } from "@/components/ax/button";
import { Composer, QueueLine } from "@/components/ax/composer";
import { ModelNotAllowed, ModelPicker } from "@/components/ax/model-picker";
import { Option } from "@/components/ax/stage-banner";
import type { ModelChoice } from "@/lib/models";
import { canBuild } from "@/lib/permissions";
import { useUi } from "@/lib/ui-store";
import { applyChange, discardChange, sendMessage } from "@/server/actions/chat";
import type { ChangeCardData, ProjectWorkspace } from "@/server/project";
import { PrCard } from "./pr-card";

function Architect({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-small font-semibold text-ink-2">
        <span className="grid size-[22px] place-items-center rounded-[7px] bg-primary text-small font-bold text-on-primary" aria-hidden="true">
          A
        </span>
        Architect
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function You({ children }: { children: React.ReactNode }) {
  return <div className="max-w-[86%] self-end rounded-[16px_16px_4px_16px] bg-selected px-[13px] py-[9px] whitespace-pre-wrap">{children}</div>;
}

type Choice = { decision: "keep" | "defer" | "drop"; reason?: string };

/** A change from chat: what it adds, changes or removes, its price, and Apply · Edit · Discard. Nothing changes until Apply. */
function ChangeCardView({ card, canChange, onEdit }: { card: ChangeCardData; canChange: boolean; onEdit: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const reasonId = useId();
  const undecided = card.conflicts.filter((r) => !choices[r.key] || (choices[r.key].decision === "drop" && !choices[r.key].reason?.trim()));

  const cost = card.credits
    ? `~${card.credits} credits${card.minutes ? ` · about ${card.minutes} min` : ""}${card.status === "proposed" ? " · nothing starts until you apply it" : ""}`
    : "No extra cost. Nothing changes until you apply it.";

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      setError(undefined);
      const r = await fn();
      if (!r.ok) setError(r.message);
      else router.refresh();
    });

  const applyReason = !canChange
    ? "Viewers can't change the plan."
    : undecided.length
      ? `Decide what happens to ${undecided.map((u) => `“${u.title}”`).join(", ")} first.`
      : pending
        ? "Applying…"
        : undefined;

  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-surface px-3.5 py-3">
      <span className="text-small font-[650] text-ink-2">{card.status === "applied" ? `Applied as plan v${card.versionCreated}` : card.status === "discarded" ? "Discarded" : "Suggested change"}</span>
      <ul className="flex flex-col gap-1">
        {card.add.map((a) => (
          <li key={a.key}>
            <span className="text-ink-2">Add </span>
            <b>{a.title}</b>
          </li>
        ))}
        {card.change.map((c) => (
          <li key={c.key}>
            <span className="text-ink-2">{c.kind === "weaken" ? "Weaken " : "Change "}</span>
            <b>{c.title}</b>
            {c.fields.length > 0 && <span className="text-ink-2"> ({c.fields.join(", ")})</span>}
          </li>
        ))}
        {card.remove.map((r) => (
          <li key={r.key}>
            <span className="text-ink-2">Remove </span>
            <b className={card.status !== "proposed" ? "line-through" : undefined}>{r.title}</b>
          </li>
        ))}
      </ul>
      <span className="text-small text-ink-2 tabular-nums">{cost}</span>

      {card.status === "proposed" &&
        card.conflicts.map((r) => {
          const c = choices[r.key];
          const weaken = r.kind === "weaken";
          return (
            // Conflict guard (A-3): no part is removed or weakened without a recorded decision.
            <div key={r.key} className="flex flex-col gap-2 rounded-card border-[1.5px] border-attention px-3 py-2.5">
              <p className="text-small">
                Your request asked for <b>{r.title}</b>. {weaken ? "This change weakens it" : "This change removes it"} ({r.reason}).
              </p>
              {weaken && r.before && r.after && (
                <p className="text-small text-ink-2">
                  Checked now: {r.before}
                  <br />
                  After the change: {r.after}
                </p>
              )}
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={`What happens to ${r.title}`}>
                <Option selected={c?.decision === "keep"} onClick={() => setChoices({ ...choices, [r.key]: { decision: "keep" } })}>
                  Keep
                </Option>
                <Option selected={c?.decision === "defer"} onClick={() => setChoices({ ...choices, [r.key]: { decision: "defer" } })}>
                  Set aside
                </Option>
                <Option selected={c?.decision === "drop"} onClick={() => setChoices({ ...choices, [r.key]: { decision: "drop", reason: c?.reason ?? (weaken ? "" : r.reason) } })}>
                  Drop
                </Option>
              </div>
              <p className="text-small text-ink-3">
                {c?.decision === "keep"
                  ? weaken
                    ? "Keep: the part stays as you asked; the weaker version isn't applied."
                    : "Keep: the part stays in the plan."
                  : c?.decision === "defer"
                    ? "Set aside: the part waits in Up next and isn't built or charged."
                    : c?.decision === "drop"
                      ? weaken
                        ? "Drop: the stronger version goes, and the part is built as changed. Your reason is saved on it."
                        : "Drop: the part is struck through with your reason, and isn't built."
                      : "Choose one to apply the change."}
              </p>
              {c?.decision === "drop" && (
                <>
                  <label htmlFor={`${reasonId}-${r.key}`} className="text-small font-semibold">
                    Why (saved on the plan)
                  </label>
                  <input
                    id={`${reasonId}-${r.key}`}
                    value={c.reason ?? ""}
                    onChange={(e) => setChoices({ ...choices, [r.key]: { decision: "drop", reason: e.target.value } })}
                    maxLength={200}
                    className="min-h-8 rounded-full border border-line-ctl bg-surface px-3"
                  />
                </>
              )}
            </div>
          );
        })}

      {card.status === "proposed" && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Button size="sm" disabledReason={applyReason} onClick={() => run(() => applyChange({ proposalId: card.id, decisions: choices }))}>
            {pending ? "Applying…" : "Apply"}
          </Button>
          <Button size="sm" variant="quiet" onClick={onEdit}>
            Edit
          </Button>
          <Button size="sm" variant="quiet" disabledReason={canChange ? undefined : "Viewers can't change the plan."} onClick={() => run(() => discardChange({ proposalId: card.id }))}>
            Discard
          </Button>
        </div>
      )}
      {applyReason && card.status === "proposed" && !pending && <span className="text-small text-ink-2">{applyReason}</span>}
      {error && (
        <p role="alert" className="text-small font-semibold text-failed">
          {error}
        </p>
      )}
    </div>
  );
}

function planIntro(project: ProjectWorkspace, writing: boolean): string {
  const plan = project.plan;
  if (writing) return "I'm writing the plan now. Parts appear on the left as they're ready. Nothing is built yet.";
  if (!plan) return "I'll write the plan here: every part, how I'll check it works, and what it costs. Nothing is built until you click Build.";
  if (plan.generation === "failed") {
    return `Sorry, I lost the connection to the model part-way through. Your request${project.items.length ? ` and the first ${project.items.length} parts are` : " is"} saved. Try again, or switch models.`;
  }
  const parts = project.items.filter((i) => i.status !== "dropped" && i.status !== "deferred").length;
  const choices = plan.defaults.length + plan.questions.filter((q) => !q.blocking && !q.answer).length;
  const open = plan.questions.filter((q) => q.blocking && !q.answer);
  return [
    `Here's the plan: ${parts} parts${plan.totals.likely ? `, about ${Math.round(plan.totals.likely)} credits` : ""}.`,
    choices ? ` I picked ${choices} sensible ${choices === 1 ? "default" : "defaults"} you can change.` : "",
    open.length ? ` ${open.length === 1 ? "One question" : `${open.length} questions`} before I can build: ${open.map((q) => q.text.replace(/\?$/, "").replace(/^./, (c) => c.toLowerCase())).join("; ")}?` : "",
    " Change anything else by telling me here.",
  ].join("");
}

/** Chat (344px): the request, the conversation and change cards, the queue and the composer (BL-4). */
export function ChatPane({
  project,
  writing,
  activity,
  title = "Chat",
  body,
  onCollapse,
  onPickModel,
}: {
  project: ProjectWorkspace;
  writing: boolean;
  /** What the build is doing (after Build), at the end of the conversation. */
  activity?: React.ReactNode;
  /** Developer view: Activity takes the conversation's place, above the same composer (screen 8). */
  title?: string;
  body?: React.ReactNode;
  onCollapse: () => void;
  onPickModel: (m: ModelChoice) => void;
}) {
  const router = useRouter();
  const canChange = canBuild(project.role);
  const [draft, setDraft] = useState("");
  const [talkFirst, setTalkFirst] = useState(!canChange);
  const [queue, setQueue] = useState<{ id: number; text: string; talkFirst: boolean }[]>([]);
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [pickerOpen, setPickerOpen] = useState(false);
  // The project's model was disallowed after it was picked (C-2): say so here, never switch it silently.
  const modelAllowed = project.models.some((m) => m.choice === project.model);
  const endRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  // Point at something and Fix with AI hand text to the composer.
  const { chatDraft, takeChatDraft } = useUi();
  useEffect(() => {
    if (!chatDraft) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- taking text handed over from the preview once
    setDraft((d) => (d ? `${d} ${chatDraft.text}` : chatDraft.text));
    takeChatDraft();
  }, [chatDraft, takeChatDraft]);

  // Queued messages run in order, one at a time (BL-4).
  useEffect(() => {
    if (sending !== null || queue.length === 0) return;
    const [head, ...rest] = queue;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- moving the head of the queue into flight
    setQueue(rest);
    setSending(head.text);
    void (async () => {
      const r = await sendMessage({ projectId: project.id, content: head.text, talkFirst: head.talkFirst });
      if (!r.ok) setError(r.message);
      setSending(null);
      router.refresh();
    })();
  }, [queue, sending, project.id, router]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [project.messages.length, sending]);

  const submit = (text: string) => {
    setError(undefined);
    setQueue((q) => [...q, { id: nextId.current++, text, talkFirst: talkFirst || !canChange }]);
    setDraft("");
  };

  const cardsByMessage = new Map(project.changes.filter((c) => c.messageId).map((c) => [c.messageId!, c]));
  const userBefore = (messageId: string) => {
    const idx = project.messages.findIndex((m) => m.id === messageId);
    return [...project.messages.slice(0, idx)].reverse().find((m) => m.role === "user")?.content ?? "";
  };

  return (
    <aside aria-label={title} className="flex min-h-0 flex-col overflow-hidden rounded-pane border border-line bg-surface shadow-pane lg:w-[344px] lg:flex-none">
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
        <h2 className="flex-1 text-sub font-semibold">{title}</h2>
        <IconButton icon="panelRight" label={`Collapse ${title.toLowerCase()}`} quiet size={32} onClick={onCollapse} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto px-4 pt-1.5 pb-3" aria-live="polite">
        {body ?? (
          <>
        {/* A plan from a repo is asked for with the whole analysis; the plan shows it on demand. */}
        {project.repo ? <You>Plan from my repo {project.repo}, keeping its stack.</You> : project.prompt && <You>{project.prompt}</You>}
        <Architect>
          <p>{planIntro(project, writing)}</p>
        </Architect>
        {project.messages.map((m) => {
          if (m.role === "user") return <You key={m.id}>{m.content}</You>;
          if (m.role === "system") {
            return (
              <p key={m.id} className="text-center text-small text-ink-2">
                {m.content}
              </p>
            );
          }
          const card = cardsByMessage.get(m.id);
          return (
            <Architect key={m.id}>
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.mode === "plan" && <span className="text-small text-ink-3">Talk first: nothing in the plan changed.</span>}
              {card && <ChangeCardView card={card} canChange={canChange} onEdit={() => setDraft(userBefore(m.id))} />}
            </Architect>
          );
        })}
        {/* A repo project's sessions as pull requests, oldest first (B-4). */}
        {[...project.pullRequests].reverse().map((pr) => (
          <Architect key={pr.id}>
            <p>
              I opened a pull request for this {pr.title.startsWith("Change") ? "change" : "build"}. Nothing goes to main until you merge it.
            </p>
            <PrCard pr={pr} project={project} governance={project.governance} />
          </Architect>
        ))}
        {activity}
          </>
        )}
        {sending !== null && (body ? <p className="text-small text-ink-2">Sent to chat: “{sending}”</p> : (
          <>
            <You>{sending}</You>
            <Architect>
              <p className="text-ink-2">Thinking…</p>
            </Architect>
          </>
        ))}
        {error && (
          <p role="alert" className="text-small font-semibold text-failed">
            {error}
          </p>
        )}
        <div ref={endRef} />
      </div>
      {queue.map((q) => (
        <QueueLine
          key={q.id}
          onEdit={() => {
            setQueue((all) => all.filter((x) => x.id !== q.id));
            setDraft(q.text);
          }}
        >
          Next: “{q.text}”
        </QueueLine>
      ))}
      <div className="px-3 pb-3">
        {!modelAllowed &&
          (canChange ? (
            <ModelNotAllowed className="mb-1.5 px-1" onSwitch={() => setPickerOpen(true)} />
          ) : (
            <p className="mb-1.5 px-1 text-small font-semibold text-attention">This model is no longer allowed. A Builder can switch it.</p>
          ))}
        <Composer
          variant="chat"
          value={draft}
          onChange={setDraft}
          onSubmit={submit}
          talkFirst={talkFirst || !canChange}
          onTalkFirstChange={(on) => canChange && setTalkFirst(on)}
          placeholder={talkFirst || !canChange ? "Ask a question. Talk first changes nothing…" : "Ask a question or describe a change…"}
          label="Message Architect"
          modelPicker={
            <ModelPicker
              value={project.model}
              options={project.models}
              onChange={onPickModel}
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              compact
              disabledReason={canChange ? undefined : "Viewers can't change the model."}
            />
          }
        />
        {!canChange && <p className="mt-1.5 text-small text-ink-2">Viewers can talk the plan through. Talk first stays on, so nothing changes.</p>}
      </div>
    </aside>
  );
}
