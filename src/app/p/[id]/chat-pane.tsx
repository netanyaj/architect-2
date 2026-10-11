"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Button, IconButton, TextLink } from "@/components/ax/button";
import { ArchitectMessage, ChatCard, chatTime, YouMessage } from "@/components/ax/chat-message";
import { Icon } from "@/components/ax/icon";
import { AttachmentChip, Composer, QueueLine } from "@/components/ax/composer";
import { SimTag } from "@/components/ax/pill";
import { ModelNotAllowed, ModelPicker } from "@/components/ax/model-picker";
import { Option } from "@/components/ax/stage-banner";
import type { ModelPick } from "@/lib/models";
import { canBuild } from "@/lib/permissions";
import { useUi } from "@/lib/ui-store";
import { answerInstead, applyChange, discardChange, sendMessage, turnIntoChange, undoChange } from "@/server/actions/chat";
import type { ChangeCardData, ProjectWorkspace } from "@/server/project";
import { ChatAddMenu, useAttachments } from "./chat-add-menu";
import { ChatMoreMenu } from "./chat-more-menu";
import { CodeEditCard } from "./code-edit-card";
import { PrCard } from "./pr-card";
import { QuestionCard } from "./question-card";

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
    <ChatCard label="Change card">
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

      {/* Undo this change (M5.8): a new plan version with the change taken back. */}
      {card.status === "applied" &&
        (card.undoneIn ? (
          <span className="text-small text-ink-2">Undone in plan v{card.undoneIn}.</span>
        ) : (
          canChange && (
            <Button size="sm" variant="quiet" icon="undo" className="self-start" disabledReason={pending ? "Undoing…" : undefined} onClick={() => run(() => undoChange({ proposalId: card.id }))}>
              {pending ? "Undoing…" : "Undo this change"}
            </Button>
          )
        ))}
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
      {/* A card from a message that could have been a question (M5.8): one click turns it back into an answer. */}
      {card.unclear && card.status === "proposed" && canChange && (
        <p className="text-small text-ink-2">
          Only asking?{" "}
          <TextLink className="text-small" onClick={() => run(() => answerInstead({ proposalId: card.id }))}>
            Just answer instead
          </TextLink>
        </p>
      )}
      {error && (
        <p role="alert" className="text-small font-semibold text-failed">
          {error}
        </p>
      )}
    </ChatCard>
  );
}

/** A Viewer's change request (M5.8): "Suggested by Priya · Turn into a change", for an Owner, Admin or Builder. */
function SuggestionCard({ card, canChange }: { card: ChangeCardData; canChange: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const s = card.suggestion!;
  return (
    <ChatCard label="Suggestion">
      <span className="text-small font-[650] text-ink-2">Suggested by {s.by}</span>
      <p>{s.text}</p>
      {card.status === "proposed" ? (
        canChange ? (
          <Button
            size="sm"
            className="self-start"
            disabledReason={pending ? "Making the change card…" : undefined}
            onClick={() =>
              start(async () => {
                setError(undefined);
                const r = await turnIntoChange({ proposalId: card.id });
                if (!r.ok) setError(r.message);
                router.refresh();
              })
            }
          >
            {pending ? "Making the change card…" : "Turn into a change"}
          </Button>
        ) : (
          <span className="text-small text-ink-2">An Owner, Admin or Builder can turn it into a change.</span>
        )
      ) : (
        <span className="text-small text-ink-2">{s.turnedBy ? `${s.turnedBy} turned it into a change.` : "Closed."}</span>
      )}
      {error && (
        <p role="alert" className="text-small font-semibold text-failed">
          {error}
        </p>
      )}
    </ChatCard>
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

/**
 * Chat (344px): the request, the conversation and change cards, the queue and the composer (BL-4). One left edge and a
 * 16px gutter for everything in it (M5.8). Each message is read as a question or a change request: no mode switch.
 * Under the composer, a footer row keeps the Help button's corner clear of Send.
 */
export function ChatPane({
  project,
  writing,
  activity,
  title = "Chat",
  body,
  onCollapse,
  onPickModel,
  onOpenDesign,
}: {
  project: ProjectWorkspace;
  writing: boolean;
  /** What the build is doing (after Build), at the end of the conversation. */
  activity?: React.ReactNode;
  /** Developer view: Activity takes the conversation's place, above the same composer (screen 8). */
  title?: string;
  body?: React.ReactNode;
  onCollapse: () => void;
  onPickModel: (m: ModelPick) => void;
  /** + › Design system: opens Plan › Design. */
  onOpenDesign: () => void;
}) {
  const router = useRouter();
  const canChange = canBuild(project.role);
  const [draft, setDraft] = useState("");
  const [queue, setQueue] = useState<{ id: number; text: string }[]>([]);
  // The + menu's files, building blocks and looks: chips in the composer, sent with the next message (M5.8).
  const attachments = useAttachments();
  const [addStatus, setAddStatus] = useState<string>();
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [pickerOpen, setPickerOpen] = useState(false);
  // The project's model was disallowed after it was picked (C-2): say so here, never switch it silently.
  const modelAllowed = project.modelPick === "auto" || project.models.some((m) => m.choice === project.model);
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
      const r = await sendMessage({ projectId: project.id, content: head.text });
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
    const carried = attachments.items.map((a) => a.line).join("\n");
    setQueue((q) => [...q, { id: nextId.current++, text: carried ? `${text}\n\n${carried}` : text }]);
    attachments.clear();
    setDraft("");
  };

  const cardsByMessage = new Map(project.changes.filter((c) => c.messageId).map((c) => [c.messageId!, c]));
  const userBefore = (messageId: string) => {
    const idx = project.messages.findIndex((m) => m.id === messageId);
    return [...project.messages.slice(0, idx)].reverse().find((m) => m.role === "user")?.content ?? "";
  };

  // After a build has finished: the plan's open items as next steps (left out for now, then set aside).
  const finished = project.run?.status === "done" && Boolean(project.plan?.agreedAt) && canChange && !body;
  const nextSteps = finished
    ? [
        ...(project.plan?.notInThisVersion ?? []).map((n) => `Add ${n.title.replace(/^./, (c) => c.toLowerCase())}`),
        ...project.items.filter((i) => i.status === "deferred").map((i) => `Build ${i.title.replace(/^./, (c) => c.toLowerCase())} now`),
      ].slice(0, 3)
    : [];
  // The intro is about the first plan: it carries that version's time.
  const introAt = [...project.versions].sort((a, b) => a.version - b.version)[0]?.createdAt ?? null;
  return (
    <aside aria-label={title} className="flex min-h-0 flex-col overflow-hidden rounded-pane border border-line bg-surface shadow-pane lg:w-[344px] lg:flex-none">
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
        <h2 className="flex-1 text-sub font-semibold">{title}</h2>
        <IconButton icon="panelRight" label={`Collapse ${title.toLowerCase()}`} quiet size={32} onClick={onCollapse} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 pt-1.5 pb-3" aria-live="polite">
        {body ?? (
          <>
            {/* A plan from a repo is asked for with the whole analysis; the plan shows it on demand. */}
            {project.repo ? <YouMessage>Plan from my repo {project.repo}, keeping its stack.</YouMessage> : project.prompt && <YouMessage>{project.prompt}</YouMessage>}
            <ArchitectMessage time={chatTime(introAt)}>
              <p>{planIntro(project, writing)}</p>
              {project.plan?.generation === "ready" && !writing && <p className="text-small text-ink-2">Written by {project.plan.writtenBy}</p>}
              {/* The plan's open questions, one at a time (M5.8); the plan shows them too. */}
              {project.plan?.generation === "ready" && !project.plan.agreedAt && !writing && (
                <QuestionCard questions={project.plan.questions} editReason={canChange ? undefined : "Viewers can't answer the plan's questions."} />
              )}
            </ArchitectMessage>
            {project.messages.map((m) => {
              if (m.role === "user") return <YouMessage key={m.id} time={chatTime(m.createdAt)}>{m.content}</YouMessage>;
              if (m.role === "system") {
                return (
                  <p key={m.id} className="text-small text-ink-2">
                    {m.content}
                  </p>
                );
              }
              const card = cardsByMessage.get(m.id);
              return (
                <ArchitectMessage key={m.id} time={chatTime(m.createdAt)}>
                  <p className="whitespace-pre-wrap">{m.content}</p>
                  {m.mode === "plan" && !card && <span className="text-small text-ink-3">Answered. Nothing in the plan changed.</span>}
                  {card &&
                    !card.answered &&
                    (card.suggestion ? <SuggestionCard card={card} canChange={canChange} /> : <ChangeCardView card={card} canChange={canChange} onEdit={() => setDraft(userBefore(m.id))} />)}
                  {card?.answered && <span className="text-small text-ink-3">Answered instead. The change card was set aside.</span>}
                </ArchitectMessage>
              );
            })}
            {/* Edits made in Developer view, oldest first: each re-runs its part's check. */}
            {project.codeEdits.edits.map((e) => (
              <ArchitectMessage key={`edit-${e.id}`}>
                <CodeEditCard edit={e} />
              </ArchitectMessage>
            ))}
            {/* A repo project's sessions as pull requests, oldest first (B-4). */}
            {[...project.pullRequests].reverse().map((pr) => (
              <ArchitectMessage key={pr.id}>
                <p>
                  I opened a pull request for this {pr.title.startsWith("Change") ? "change" : "build"}. Nothing goes to main until you merge it.
                </p>
                <PrCard pr={pr} project={project} governance={project.governance} />
              </ArchitectMessage>
            ))}
            {activity}
          </>
        )}
        {sending !== null &&
          (body ? (
            <p className="text-small text-ink-2">Sent to chat: “{sending}”</p>
          ) : (
            <>
              <YouMessage>{sending}</YouMessage>
              <ArchitectMessage>
                <p className="text-ink-2">Thinking…</p>
              </ArchitectMessage>
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
      <div className="px-4">
        {/* After a build: three next steps from the plan's open items (M5.8). They fill the composer; nothing sends. */}
        {nextSteps.length > 0 && !draft && queue.length === 0 && sending === null && (
          <div role="group" aria-label="Suggested next steps" className="mb-2 flex flex-wrap gap-1.5">
            {nextSteps.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setDraft(n)}
                className="min-h-8 max-w-full truncate rounded-full border border-transparent bg-(--btn) px-3 text-left text-small font-[550] hover:bg-(--btn-hover)"
              >
                {n}
              </button>
            ))}
          </div>
        )}
        {/* Under 10% of the month's credits (M5.8): one quiet line, never a block. */}
        {project.creditsTotal > 0 && project.creditsLeft < project.creditsTotal * 0.1 && (
          <p className="mb-1.5 flex items-center gap-1.5 text-small text-ink-2">
            <Icon name="credits" size="sm" />
            <span>
              Low on credits ({project.creditsLeft.toLocaleString("en-US")} left) ·{" "}
              <Link href="/settings#plan" className="font-semibold text-ink underline decoration-line-ctl underline-offset-[3px]">
                View plans
              </Link>
            </span>
          </p>
        )}
        {!modelAllowed &&
          (canChange ? (
            <ModelNotAllowed className="mb-1.5" onSwitch={() => setPickerOpen(true)} />
          ) : (
            <p className="mb-1.5 text-small font-semibold text-attention">This model is no longer allowed. A Builder can switch it.</p>
          ))}
        {addStatus && (
          <p role="status" className="mb-1.5 text-small text-ink-2">
            {addStatus}
          </p>
        )}
        <Composer
          variant="chat"
          value={draft}
          onChange={setDraft}
          onSubmit={submit}
          attachments={
            attachments.items.length ? (
              <>
                {attachments.items.map((a) => (
                  <AttachmentChip key={a.id} icon={a.icon} onRemove={() => attachments.remove(a.id)}>
                    <span className="truncate">{a.label}</span>
                    {a.simulated && <SimTag className="flex-none" />}
                  </AttachmentChip>
                ))}
              </>
            ) : undefined
          }
          tools={
            <>
              <ChatAddMenu
                project={project}
                attached={attachments.items}
                onAdd={attachments.add}
                onPlanView={onOpenDesign}
                onStatus={setAddStatus}
                disabledReason={canChange ? undefined : "Viewers can't add files or building blocks."}
              />
              <ChatMoreMenu project={project} items={project.items} />
            </>
          }
          placeholder={canChange ? "Ask a question, or describe a change…" : "Ask about the plan, or suggest a change…"}
          label="Message Architect"
          modelPicker={
            <ModelPicker<ModelPick>
              value={project.modelPick}
              options={project.models}
              blocked={project.blockedModels}
              auto
              autoResolves={project.models.find((m) => m.choice === project.model)?.label}
              onChange={onPickModel}
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              compact
              disabledReason={canChange ? undefined : "Viewers can't change the model."}
            />
          }
        />
      </div>
      {/* The footer row keeps room on the right for the Help button (it never covers Send); Viewers learn where changes go. */}
      <p className="flex min-h-12 items-center px-4 pr-16 text-small text-ink-3">{canChange ? null : "Changes you ask for go to a Builder."}</p>
    </aside>
  );
}
