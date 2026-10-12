"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button, TextLink } from "@/components/ax/button";
import { Select } from "@/components/ax/select";
import { StatusMark } from "@/components/ax/status-mark";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { providerName } from "@/lib/providers";
import { acceptTransfer, cancelTransfer, dismissHandoff, transferOwnership } from "@/server/actions/handoff";
import type { ProjectWorkspace, WorkspaceItem } from "@/server/project";

/* Hand-off (F8): offer the project to another member with a note; they accept and see what they now own. */

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const act = (fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) =>
    start(async () => {
      setError(undefined);
      const r = await fn();
      if (!r.ok) return setError(r.message);
      after?.();
      router.refresh();
    });
  return { pending, error, act };
}

/** ⋯ › Transfer ownership: choose a member and add an optional note. */
export function TransferDialog({ project, open, onOpenChange }: { project: ProjectWorkspace; open: boolean; onOpenChange: (o: boolean) => void }) {
  const h = project.handoff;
  const [memberId, setMemberId] = useState(h.recipients[0]?.id ?? "");
  const [note, setNote] = useState("");
  const { pending, error, act } = useAct();
  const ids = { member: useId(), note: useId() };
  const chosen = h.recipients.find((c) => c.id === memberId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[480px]">
        <DialogTitle className="text-sub font-semibold">Transfer ownership of {project.name}</DialogTitle>
        <DialogDescription className="text-ink-2">The new owner gets the plan, its checks, its versions and what still needs someone. Nothing changes until they accept.</DialogDescription>
        {h.recipients.length === 0 ? (
          <p className="text-ink-2">Nobody else here can own it yet. Invite someone as a Builder in Settings first.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <label htmlFor={ids.member} className="text-small font-semibold text-ink-2">
              New owner
            </label>
            <Select id={ids.member} value={memberId} onChange={(e) => setMemberId(e.target.value)} controlSize="md" wrapperClassName="w-full">
              {h.recipients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.invited ? " (invited)" : ""}
                </option>
              ))}
            </Select>
            {chosen?.invited && <p className="text-small text-ink-2">{chosen.name} hasn&apos;t joined yet. The hand-off completes when they accept their invite link.</p>}
            <label htmlFor={ids.note} className="text-small font-semibold text-ink-2">
              Note for them (optional)
            </label>
            <textarea id={ids.note} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} placeholder="What they should know: who uses it, what's left, anything odd." className="rounded-[12px] border border-line-ctl bg-surface px-3 py-2.5 text-body" />
          </div>
        )}
        {h.outgoing && <p className="text-small text-ink-2">This replaces the open offer to {h.outgoing.toName}.</p>}
        {error && (
          <p role="alert" className="text-small font-semibold text-failed">
            {error}
          </p>
        )}
        <DialogFooter className="mt-2 gap-2">
          <Button variant="quiet" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabledReason={!h.recipients.length ? "Nobody can own it yet." : pending ? "Sending…" : undefined}
            onClick={() => act(() => transferOwnership({ projectId: project.id, memberId, note }), () => onOpenChange(false))}
          >
            Offer ownership
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The hand-off banners: an offer to you, your offer waiting, or what you now own. */
export function HandoffBanner({ project, items, onOpenPlan }: { project: ProjectWorkspace; items: WorkspaceItem[]; onOpenPlan: () => void }) {
  const h = project.handoff;
  const { pending, error, act } = useAct();
  const [hidden, setHidden] = useState(false);
  const box = "mx-3 mb-2 flex flex-col gap-2 rounded-card border-[1.5px] bg-surface px-4 py-3";
  const err = error && (
    <p role="alert" className="text-small font-semibold text-failed">
      {error}
    </p>
  );

  if (h.offer) {
    return (
      <section aria-label="Ownership offer" className={`${box} border-attention`}>
        <h3 className="font-semibold">
          {h.offer.fromName} wants to hand you {project.name}
        </h3>
        {h.offer.note && <blockquote className="border-l-2 border-line-ctl pl-3 text-ink-2">“{h.offer.note}”</blockquote>}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" disabledReason={pending ? "Saving…" : undefined} onClick={() => act(() => acceptTransfer({ transferId: h.offer!.id }))}>
            Accept ownership
          </Button>
          <Button variant="quiet" size="sm" disabledReason={pending ? "Saving…" : undefined} onClick={() => act(() => cancelTransfer({ transferId: h.offer!.id }))}>
            Decline
          </Button>
        </div>
        {err}
      </section>
    );
  }

  if (h.received && !hidden) {
    const counted = items.filter((i) => i.status !== "deferred" && i.status !== "dropped");
    const works = counted.filter((i) => i.status === "built" || i.status === "sample_data").length;
    const needs = counted.filter((i) => ["needs_connection", "needs_approval", "paused", "failed"].includes(i.status));
    const questions = project.plan?.questions.filter((q) => q.blocking && !q.answer) ?? [];
    return (
      <section aria-label="You now own this project" className={`${box} border-ink`}>
        <h3 className="font-semibold">You now own {project.name}</h3>
        <p className="text-ink-2">From {h.received.fromName}.</p>
        {h.received.note && <blockquote className="border-l-2 border-line-ctl pl-3 text-ink-2">“{h.received.note}”</blockquote>}
        <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1 text-small">
          <dt className="font-semibold text-ink-2">The plan</dt>
          <dd>
            {project.plan ? `v${project.plan.version} · ${counted.length} parts` : "Not written yet"}{" "}
            {project.plan && (
              <TextLink className="text-small" onClick={onOpenPlan}>
                Open full plan
              </TextLink>
            )}
          </dd>
          <dt className="font-semibold text-ink-2">Readiness</dt>
          <dd>
            {works} of {counted.length} parts work
          </dd>
          <dt className="font-semibold text-ink-2">Needs you</dt>
          <dd>
            {needs.length + questions.length === 0 ? (
              "Nothing open"
            ) : (
              <ul className="flex flex-col gap-1">
                {questions.map((q) => (
                  <li key={q.id} className="flex items-start gap-2">
                    <StatusMark status="attention" />
                    {q.text}
                  </li>
                ))}
                {needs.map((i) => (
                  <li key={i.key} className="flex items-start gap-2">
                    <StatusMark status={i.status === "needs_approval" ? "approval" : i.status === "paused" ? "blocked" : i.status === "failed" ? "failed" : "attention"} icon={i.status === "needs_connection" ? "plug" : i.status === "needs_approval" ? "lock" : undefined} />
                    {i.status === "needs_connection"
                      ? `Connect ${providerName(i.provider)} for ${i.title}`
                      : i.status === "needs_approval"
                        ? `${i.title}: waiting for IT`
                        : i.status === "paused"
                          ? `${i.title} is blocked`
                          : `${i.title} failed its check`}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </dl>
        <div>
          <Button size="sm" variant="quiet" onClick={() => {
              setHidden(true);
              act(() => dismissHandoff({ transferId: h.received!.id }));
            }}>
            Got it
          </Button>
        </div>
      </section>
    );
  }

  if (h.outgoing && (h.outgoing.fromMe || h.canTransfer)) {
    return (
      <section aria-label="Ownership offer sent" className={`${box} border-line`}>
        <p>
          <b className="font-semibold">Waiting for {h.outgoing.toName} to accept ownership.</b>{" "}
          <span className="text-ink-2">{h.outgoing.invited ? `${h.outgoing.toName} accepts with their invite link (Settings › Members).` : "They'll see it when they open the project."}</span>
        </p>
        <div>
          <Button size="sm" variant="quiet" disabledReason={pending ? "Saving…" : undefined} onClick={() => act(() => cancelTransfer({ transferId: h.outgoing!.id }))}>
            Cancel the offer
          </Button>
        </div>
        {err}
      </section>
    );
  }
  return null;
}
