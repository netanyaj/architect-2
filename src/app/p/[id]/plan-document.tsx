"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { Button, TextLink } from "@/components/ax/button";
import { Icon } from "@/components/ax/icon";
import { SimTag, Tag } from "@/components/ax/pill";
import { Select } from "@/components/ax/select";
import { Option, StageBanner } from "@/components/ax/stage-banner";
import { StatusMark } from "@/components/ax/status-mark";
import { MODEL_LABEL, type ModelChoice } from "@/lib/models";
import { formatBytes } from "@/lib/uploads";
import { answerQuestion, changeDefault, editItem } from "@/server/actions/plan";
import type { PlanItem } from "@/server/blueprint/write-plan";
import type { PlanQuestion, ProjectWorkspace, WorkspaceItem } from "@/server/project";
import { CompareVersions } from "./compare-versions";
import { PartComments, type PartComment } from "./part-comments";
import type { WriterState } from "./use-plan-writer";

export const GROUP_LABEL: Record<string, string> = {
  features: "What it does",
  integrations: "Apps it connects to",
  agents: "AI agents",
  data: "Data, sign-in and look",
  quality: "Checks and safety",
};
/** B-8: the stack new projects get; imported projects keep their own. */
export const DEFAULT_STACK = "Next.js + Python (Lyzr SDK)";
export const STACK_NOTE = "New projects use Next.js + Python (Lyzr SDK). Imported projects keep their stack.";

export const GROUP_ORDER = ["features", "integrations", "agents", "data", "quality"];

/**
 * A part's estimate in words (A-4): its credit range, a time range, how sure the estimate is and what drives it.
 * Time scales with credits (BG: 45 s per typical 12-credit unit), so the range follows the credit range.
 */
export function estimateLine(item: Pick<WorkspaceItem, "range" | "estimate" | "seconds" | "confidence" | "driver">): string {
  const parts: string[] = [];
  if (item.range) parts.push(`${item.range.low}–${item.range.high} cr`);
  if (item.seconds && item.estimate && item.range) {
    const min = (credits: number) => Math.max(1, Math.round(((item.seconds as number) * credits) / (item.estimate as number) / 60));
    const lo = min(item.range.low);
    const hi = min(item.range.high);
    parts.push(lo === hi ? `about ${lo} min` : `${lo}–${hi} min`);
  }
  if (item.confidence) parts.push(`${item.confidence} confidence`);
  if (item.driver) parts.push(`mostly ${item.driver}`);
  return parts.join(" · ");
}

/** A streamed part, shaped like a saved one, so writing and written plans render the same. */
export function fromStreamed(i: PlanItem): WorkspaceItem {
  return {
    id: i.id,
    key: i.key,
    title: i.title,
    description: i.description,
    provedWhen: i.proved_when,
    sourceQuote: i.source_quote,
    grp: i.grp,
    status: "proposed",
    statusDetail: null,
    dropReason: null,
    estimate: i.estimate.likely,
    range: { low: i.estimate.low, high: i.estimate.high },
    driver: i.estimate.driver,
    confidence: i.estimate.confidence,
    seconds: i.estimate.seconds,
    provider: i.provider ?? null,
    position: i.position,
    edited: false,
  };
}

function Message({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-small font-semibold text-failed">
      {error}
    </p>
  );
}

function QuestionCard({ q, editReason }: { q: PlanQuestion; editReason?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const chosen = q.answer ?? (q.blocking ? null : q.recommended);
  const pick = (value: string) =>
    start(async () => {
      setError(undefined);
      const r = await answerQuestion({ questionId: q.id, value });
      if (!r.ok) setError(r.message);
      else router.refresh();
    });
  return (
    <StageBanner
      kind="question"
      title={q.text}
      actions={q.options.map((o) => (
        <Option key={o.value} selected={chosen === o.value} onClick={editReason || pending ? undefined : () => pick(o.value)}>
          {o.label}
          {o.value === q.recommended && <Tag>recommended</Tag>}
        </Option>
      ))}
    >
      {q.answer
        ? "Answered. You can change it until you click Build."
        : !q.blocking
          ? "I picked the recommended answer. Change it if you like."
          : q.defaultEffect === "remove"
            ? "The recommended answer would drop something you asked for, so Build waits for your answer."
            : q.defaultEffect === "reduce"
              ? "The recommended answer would do less than you asked, so Build waits for your answer."
              : "There's no safe default, so Build waits for your answer."}
      {editReason && <span className="block text-small">{editReason}</span>}
      <Message error={error} />
    </StageBanner>
  );
}

function ItemRow({ item, editReason, fromRepo = false, projectId, comments }: { item: WorkspaceItem; editReason?: string; fromRepo?: boolean; projectId: string; comments: PartComment[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const ids = { title: useId(), desc: useId(), check: useId() };

  // An edit that weakens the check needs Keep / Set aside / Drop first (A-3), as a chat change does.
  const [conflict, setConflict] = useState<{ before: string; after: string; fields: { title: string; description: string; provedWhen: string } } | null>(null);
  const [choice, setChoice] = useState<"keep" | "defer" | "drop" | null>(null);
  const [reason, setReason] = useState("");
  const send = (fields: { title: string; description: string; provedWhen: string }, decision?: { decision: "keep" | "defer" | "drop"; reason?: string }) =>
    start(async () => {
      setError(undefined);
      const r = await editItem({ itemId: item.id, ...fields, decision });
      if (!r.ok) {
        if (r.conflict) {
          setConflict({ ...r.conflict, fields });
          setChoice(null);
        }
        setError(r.conflict ? undefined : r.message);
        return;
      }
      setConflict(null);
      setEditing(false);
      router.refresh();
    });
  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    send({ title: String(f.get("title")), description: String(f.get("description")), provedWhen: String(f.get("provedWhen")) });
  };

  const field = "w-full rounded-tile border border-line-ctl bg-surface px-3 py-2 text-body";
  return (
    <li id={`part-${item.key}`} className="flex gap-3 border-t border-line px-3.5 py-3 first:border-t-0">
      {/* A part a repo already does, proved by its own tests, is a quiet check (B-2). */}
      {item.status === "built" ? <StatusMark status="works" label="Works" /> : <StatusMark status="todo" icon={item.status === "dropped" ? "minus" : item.status === "deferred" ? "pause" : "dot"} />}
      {editing ? (
        <form onSubmit={save} className="flex min-w-0 flex-1 flex-col gap-2">
          <label htmlFor={ids.title} className="text-small font-semibold">
            Part
          </label>
          <input id={ids.title} name="title" defaultValue={item.title} maxLength={60} className={field} />
          <label htmlFor={ids.desc} className="text-small font-semibold">
            What it does
          </label>
          <textarea id={ids.desc} name="description" defaultValue={item.description ?? ""} maxLength={200} rows={2} className={field} />
          <label htmlFor={ids.check} className="text-small font-semibold">
            Done when
          </label>
          <textarea id={ids.check} name="provedWhen" defaultValue={item.provedWhen} maxLength={160} rows={2} className={field} />
          {conflict && (
            <div className="flex flex-col gap-2 rounded-card border-[1.5px] border-attention px-3 py-2.5">
              <p className="text-small">
                This edit weakens <b>{item.title}</b>.
              </p>
              <p className="text-small text-ink-2">
                Checked now: {conflict.before}
                <br />
                After the edit: {conflict.after}
              </p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={`What happens to ${item.title}`}>
                <Option selected={choice === "keep"} onClick={() => setChoice("keep")}>
                  Keep
                </Option>
                <Option selected={choice === "defer"} onClick={() => setChoice("defer")}>
                  Set aside
                </Option>
                <Option selected={choice === "drop"} onClick={() => setChoice("drop")}>
                  Drop
                </Option>
              </div>
              <p className="text-small text-ink-3">
                {choice === "keep"
                  ? "Keep: the check stays as it is; your other changes are saved."
                  : choice === "defer"
                    ? "Set aside: the part waits in Up next and isn't built or charged."
                    : choice === "drop"
                      ? "Drop: the stronger check goes, and the part is built as edited. Your reason is saved on it."
                      : "Choose one to save the edit."}
              </p>
              {choice === "drop" && (
                <>
                  <label htmlFor={`${ids.check}-why`} className="text-small font-semibold">
                    Why (saved on the plan)
                  </label>
                  <input id={`${ids.check}-why`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className="min-h-8 rounded-full border border-line-ctl bg-surface px-3" />
                </>
              )}
              <Button
                size="sm"
                className="self-start"
                disabledReason={!choice ? "Choose Keep, Set aside or Drop first." : choice === "drop" && !reason.trim() ? "Say why first." : pending ? "Saving…" : undefined}
                onClick={() => send(conflict.fields, { decision: choice!, reason })}
              >
                Save with this choice
              </Button>
            </div>
          )}
          <Message error={error} />
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabledReason={pending ? "Saving…" : conflict ? "Choose what happens to the part above." : undefined}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={item.status === "dropped" ? "font-semibold text-ink-3 line-through" : "font-semibold"}>{item.title}</span>
          {item.description && <span className="text-small text-ink-2">{item.description}</span>}
          <span className="text-small text-ink-2">Done when {item.provedWhen.charAt(0).toLowerCase() + item.provedWhen.slice(1)}</span>
          {item.statusDetail && <span className="text-small font-semibold text-ink-2">{item.statusDetail}</span>}
          {item.sourceQuote && (
            <span className="text-small text-ink-3">
              {fromRepo ? "From the repo" : "From your words"}: “{item.sourceQuote}”
            </span>
          )}
          {item.dropReason && <span className="text-small text-ink-2">Left out: {item.dropReason}</span>}
          {item.status !== "built" && item.range && <span className="text-small text-ink-2 tabular-nums">{estimateLine(item)}</span>}
          <PartComments projectId={projectId} itemKey={item.key} title={item.title} comments={comments} />
        </div>
      )}
      {!editing && (
        <div className="flex flex-none flex-col items-end gap-1">
          {item.status === "built" ? (
            <span className="text-small text-ink-2">Works today</span>
          ) : item.estimate !== null && (
            <span className="text-small text-ink-2 tabular-nums" title={item.range ? `${item.range.low}–${item.range.high} credits · mostly ${item.driver}` : undefined}>
              ~{Math.round(item.estimate)} cr
            </span>
          )}
          <TextLink onClick={() => (editReason ? undefined : setEditing(true))} title={editReason} aria-disabled={editReason ? true : undefined} className={editReason ? "cursor-not-allowed text-ink-3" : undefined}>
            Edit
          </TextLink>
        </div>
      )}
    </li>
  );
}

function DefaultRow({ id, label, value, alternatives, editReason }: { id: string; label: string; value: string; alternatives: string[]; editReason?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const selectId = useId();
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line px-3.5 py-3 first:border-t-0">
      <span className="min-w-[160px] flex-1 text-ink-2">{label}</span>
      <label htmlFor={selectId} className="sr-only">
        {label}
      </label>
      <Select
        id={selectId}
        value={value}
        aria-disabled={editReason || pending || alternatives.length === 0 ? true : undefined}
        title={editReason ?? (alternatives.length === 0 ? "Describe another choice in chat" : undefined)}
        onChange={(e) => {
          if (editReason || alternatives.length === 0) return;
          const v = e.target.value;
          start(async () => {
            const r = await changeDefault({ defaultId: id, value: v });
            if (!r.ok) setError(r.message);
            else router.refresh();
          });
        }}
      >
        {[value, ...alternatives].map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </Select>
      <Message error={error} />
    </div>
  );
}

/** The plan document: what the stage shows before Build (screen 2), while writing, and when writing failed (16). */
export function PlanDocument({
  project,
  writer,
  editReason,
  onRetry,
  onSwitchModel,
  onEditRequest,
}: {
  project: ProjectWorkspace;
  writer: WriterState;
  /** Why the plan can't be edited (Viewers, agreed plans). */
  editReason?: string;
  onRetry: () => void;
  onSwitchModel: (m: ModelChoice) => void;
  onEditRequest: (prompt: string) => void;
}) {
  const plan = project.plan;
  const writing = writer.phase === "writing" || plan?.generation === "writing";
  const failed = writer.phase === "failed" ? writer : plan?.generation === "failed" ? { kind: plan.errorKind ?? "unavailable", message: "" } : null;
  const items = writer.phase !== "idle" && writer.items.length > 0 && (writing || writer.phase === "failed") ? writer.items.map(fromStreamed) : project.items;
  const [editingRequest, setEditingRequest] = useState(false);
  const requestId = useId();
  const others = project.models.filter((m) => m.choice !== (plan?.model ?? project.model));
  const switchTo = others.find((m) => !m.simulated) ?? others[0];
  const modelLabel = writer.phase === "writing" && writer.model ? writer.model.label : MODEL_LABEL[plan?.model ?? project.model];

  const groups = GROUP_ORDER.filter((g) => items.some((i) => i.grp === g));
  const openQuestions = plan?.generation === "ready" ? plan.questions.filter((q) => q.blocking || q.answer) : [];
  const defaultedQuestions = plan?.generation === "ready" ? plan.questions.filter((q) => !q.blocking && !q.answer) : [];

  return (
    <article className="mx-auto flex w-full max-w-[720px] flex-col gap-[22px] px-8 py-9 max-sm:px-4">
      <div className="flex flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2 text-small font-semibold text-ink-2">
          {project.name} · plan v{plan?.version ?? 1}
          {plan?.basedOn ? ` · changed from v${plan.basedOn}` : ""}
          <span className="flex-1" />
          <CompareVersions versions={project.versions} />
          {(plan?.simulatedModel || (writer.phase === "writing" && writer.model?.simulated)) && (
            <SimTag title={`${modelLabel} isn't connected here, so Gemini wrote this plan`} />
          )}
        </span>
        {(() => {
          const heading = plan?.summary && !writing ? plan.summary : writing ? "Writing the plan…" : (plan?.name ?? project.name);
          // A short phrase reads as a title (screen 2); a full sentence would wrap across the page, so it's smaller.
          return <h2 className={heading.length > 60 ? "text-heading font-[650]" : "text-title font-[650]"}>{heading}</h2>;
        })()}
        {project.repo ? (
          // A plan from a repo is asked for with the analysis itself; show where it came from, and the request on demand.
          <details className="text-ink-2">
            <summary className="cursor-pointer text-sub">From {project.repo} on GitHub. What Architect read</summary>
            <p className="mt-2 text-small whitespace-pre-wrap">{project.prompt}</p>
          </details>
        ) : (
          project.prompt && <p className="text-sub text-ink-2">{project.prompt}</p>
        )}
        <p className="flex flex-wrap items-center gap-2 text-small text-ink-2" title={STACK_NOTE}>
          <span>
            <b className="font-semibold text-ink">Stack:</b> {project.stack === "default" ? `${DEFAULT_STACK}, the default for new projects` : `${project.stack}, kept from your repo`}
          </span>
          <SimTag title="The app's code isn't generated in this prototype; the stack says what it would be built with." />
        </p>
      </div>

      {writing && (
        <p role="status" className="flex items-center gap-2.5 text-ink-2">
          <StatusMark status="building" />
          {writer.phase === "writing" && writer.retrying
            ? "The first draft missed a rule, so I'm writing it again."
            : `${modelLabel} is writing the plan. Parts appear here as they're ready${items.length ? ` (${items.length} so far)` : ""}. Nothing is built yet.`}
        </p>
      )}

      {failed && !writing && (
        <>
          {failed.kind === "rate_limited" || failed.kind === "slow" ? (
            <StageBanner
              kind="paused"
              title={failed.kind === "slow" ? `${modelLabel} is taking too long` : `${modelLabel} is busy right now`}
              actions={
                <>
                  {switchTo && (
                    <Button variant="primary" onClick={() => onSwitchModel(switchTo.choice)}>
                      Switch model
                    </Button>
                  )}
                  <Button onClick={onRetry}>Try again</Button>
                </>
              }
            >
              {failed.kind === "slow" ? "The free model didn't finish within 45 seconds." : "The free model reached its limit."}{" "}
              {items.length ? `The ${items.length} parts written so far are kept. ` : ""}Nothing was built or charged.{" "}
              {switchTo ? `Switch to ${switchTo.label}, or try again${failed.kind === "slow" ? "" : " in a minute"}.` : "Try again in a minute."}
            </StageBanner>
          ) : (
            <StageBanner
              kind="error"
              title="I couldn’t finish the plan"
              actions={
                <>
                  <Button variant="primary" onClick={onRetry}>
                    Try again
                  </Button>
                  {switchTo && <Button onClick={() => onSwitchModel(switchTo.choice)}>Try with {switchTo.label}</Button>}
                  <Button variant="quiet" onClick={() => setEditingRequest(true)}>
                    Edit my request
                  </Button>
                </>
              }
            >
              {failed.kind === "invalid"
                ? `The plan didn't pass its checks after two tries.`
                : failed.kind === "refused"
                  ? failed.message
                  : `${modelLabel} stopped answering${items.length ? ` after ${items.length} parts` : ""}.`}{" "}
              {items.length ? `The ${items.length} parts are kept. ` : ""}Nothing was built or charged.
            </StageBanner>
          )}
          {editingRequest && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const text = String(new FormData(e.currentTarget).get("request") ?? "").trim();
                if (text) {
                  setEditingRequest(false);
                  onEditRequest(text);
                }
              }}
              className="flex flex-col gap-2"
            >
              <label htmlFor={requestId} className="font-semibold">
                Your request
              </label>
              <textarea id={requestId} name="request" defaultValue={project.prompt ?? ""} rows={4} maxLength={4000} className="rounded-card border border-line-ctl bg-surface px-3 py-2" />
              <div className="flex gap-2">
                <Button type="submit">Write the plan again</Button>
                <Button variant="quiet" onClick={() => setEditingRequest(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
          <p className="text-small text-ink-2">If it fails twice, Help can look at it with this project attached.</p>
        </>
      )}

      {openQuestions.map((q) => (
        <QuestionCard key={q.id} q={q} editReason={editReason} />
      ))}

      {groups.map((g) => (
        <section key={g} id={`group-${g}`} className="flex scroll-mt-4 flex-col gap-2">
          <h3 className="text-sub font-[650]">{GROUP_LABEL[g]}</h3>
          <ul className="flex flex-col overflow-hidden rounded-card border border-line">
            {items
              .filter((i) => i.grp === g)
              .map((i) => (
                <ItemRow key={i.key} item={i} fromRepo={Boolean(project.repo)} editReason={writing ? "Wait for the plan to finish writing." : editReason} projectId={project.id} comments={project.comments[i.key] ?? []} />
              ))}
          </ul>
        </section>
      ))}

      {plan?.generation === "ready" && (plan.defaults.length > 0 || defaultedQuestions.length > 0) && (
        <section id="group-defaults" className="flex scroll-mt-4 flex-col gap-2">
          <h3 className="text-sub font-[650]">Choices I made for you</h3>
          <div className="rounded-card border border-line">
            {plan.defaults.map((d) => (
              <DefaultRow key={d.id} id={d.id} label={d.label} value={d.value} alternatives={d.alternatives} editReason={editReason} />
            ))}
            {defaultedQuestions.map((q) => (
              <DefaultQuestionRow key={q.id} q={q} editReason={editReason} />
            ))}
          </div>
        </section>
      )}

      {plan?.generation === "ready" && plan.notInThisVersion.length > 0 && (
        <section id="group-left-out" className="flex scroll-mt-4 flex-col gap-2">
          <h3 className="text-sub font-[650]">Left out for now</h3>
          <ul className="flex flex-col rounded-card border border-line">
            {plan.notInThisVersion.map((n) => (
              <li key={n.title} className="flex flex-col border-t border-line px-3.5 py-3 first:border-t-0">
                <span className="font-semibold">{n.title}</span>
                <span className="text-small text-ink-2">{n.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {project.uploads.length > 0 && (
        <section id="group-uploads" className="flex scroll-mt-4 flex-col gap-2">
          <h3 className="text-sub font-[650]">Your uploads</h3>
          <ul className="flex flex-col rounded-card border border-line">
            {project.uploads.map((f) => (
              <li key={f.id} className="flex items-center gap-3 border-t border-line px-3.5 py-3 first:border-t-0">
                <Icon name={f.mime?.startsWith("image/") ? "image" : "file"} size="sm" />
                <span className="min-w-0 flex-1 truncate font-mono text-small">{f.name}</span>
                <span className="text-small text-ink-2">
                  {f.size ? `${formatBytes(f.size)} · ` : ""}
                  {f.read ? (f.mime?.startsWith("image/") ? "Shown to the planner" : "Read for the plan") : "No text could be read"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {plan?.generation === "ready" && plan.totals.likely !== null && (
        <div className="flex items-center gap-3.5 rounded-card border border-line bg-tray px-[18px] py-4">
          <Icon name="credits" />
          <p>
            About <b className="tabular-nums">{Math.round(plan.totals.likely)} credits</b>
            {plan.totals.low !== null && plan.totals.high !== null && <span className="tabular-nums"> ({plan.totals.low}–{plan.totals.high})</span>}
            {plan.totals.minutes ? ` and ${plan.totals.minutes} minutes` : ""} to build, fixes included. Nothing is built or charged until you click Build.
          </p>
        </div>
      )}
    </article>
  );
}

/** A question that got its recommended answer by default, shown with the other choices. */
function DefaultQuestionRow({ q, editReason }: { q: PlanQuestion; editReason?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const selectId = useId();
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line px-3.5 py-3 first:border-t-0">
      <span className="min-w-[160px] flex-1 text-ink-2">{q.text}</span>
      <label htmlFor={selectId} className="sr-only">
        {q.text}
      </label>
      <Select
        id={selectId}
        value={q.answer ?? q.recommended}
        aria-disabled={editReason || pending ? true : undefined}
        title={editReason}
        onChange={(e) => {
          if (editReason) return;
          const v = e.target.value;
          start(async () => {
            const r = await answerQuestion({ questionId: q.id, value: v });
            if (!r.ok) setError(r.message);
            else router.refresh();
          });
        }}
      >
        {q.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <Message error={error} />
    </div>
  );
}
