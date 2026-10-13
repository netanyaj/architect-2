"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ax/button";
import { EmptyState } from "@/components/ax/empty-state";
import { Icon } from "@/components/ax/icon";
import { SimTag, Tag } from "@/components/ax/pill";
import { Segmented } from "@/components/ax/segmented";
import { MasterDetail, MasterRow } from "@/components/ax/master-detail";
import { StatusMark } from "@/components/ax/status-mark";
import { formatDay, type ApprovalView, type DecisionScope } from "@/lib/approvals";
import { relativeTime } from "@/lib/project-status";
import { cn } from "@/lib/utils";
import { decideApproval, removeAllowRule } from "@/server/actions/approvals";

type Tab = "waiting" | "decided" | "rules";
type Request = ApprovalView & { createdAt: string };
export type RuleItem =
  | { id: string; kind: "policy"; title: string; detail: string }
  | { id: string; kind: "allow"; title: string; detail: string; createdByName: string; createdAt: string; reason: string | null };

/** "2 h", "1 d": the list's short age, as on screen 11. */
function age(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${Math.max(1, mins)} min`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h`;
  return `${Math.round(mins / 60 / 24)} d`;
}

/**
 * Screen 11: the requests on the left (Waiting · Decided · Rules), the one selected on the right with who asked, why,
 * where its data would go, a reason (needed to reject) and the decision. Everything is simulated except the record.
 */
export function ApprovalsView({ approvals, rules, initialTab, initialId }: { approvals: Request[]; rules: RuleItem[]; initialTab: Tab; initialId?: string }) {
  const waiting = approvals.filter((a) => a.status === "waiting");
  const decided = approvals.filter((a) => a.status !== "waiting");
  const [tab, setTab] = useState<Tab>(initialTab);
  const [selected, setSelected] = useState<string | undefined>(initialId);
  // What the last decision did. Kept here, because the decided request leaves Waiting and the next one opens.
  const [notice, setNotice] = useState<string>();
  const list = tab === "waiting" ? waiting : tab === "decided" ? decided : [];
  const current = tab === "rules" ? undefined : (list.find((a) => a.id === selected) ?? list[0]);
  const rule = tab === "rules" ? (rules.find((r) => r.id === selected) ?? rules[0]) : undefined;

  const choose = (next: Tab) => {
    setNotice(undefined);
    setTab(next);
    setSelected(undefined);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    url.searchParams.delete("id");
    window.history.replaceState(null, "", url);
  };
  const pick = (id: string) => {
    setNotice(undefined);
    setSelected(id);
    const url = new URL(window.location.href);
    url.searchParams.set("id", id);
    window.history.replaceState(null, "", url);
  };

  return (
    <MasterDetail
      title="Approvals"
      intro="Requests that your rules send to an admin. Everything else in a project keeps working while it waits."
      filters={
        <Segmented
          mode="filter"
          label="Show"
          className="self-start"
          value={tab}
          onChange={choose}
          options={[
            { value: "waiting", label: "Waiting", count: waiting.length },
            { value: "decided", label: "Decided" },
            { value: "rules", label: "Rules" },
          ]}
        />
      }
      listLabel="Requests"
      detailLabel="Request"
      rows={
        <>
          {tab === "rules"
            ? rules.map((r) => (
                <MasterRow key={r.id} on={r.id === rule?.id} onClick={() => pick(r.id)} icon={r.kind === "allow" ? "check" : "lines"} status={r.kind === "allow" ? "works" : "todo"} title={r.title} meta={r.kind === "allow" ? `${r.createdByName} · ${formatDay(r.createdAt)}` : "Sends requests here"} />
              ))
            : list.map((a) => (
                <MasterRow
                  key={a.id}
                  on={a.id === current?.id}
                  onClick={() => pick(a.id)}
                  icon={a.status === "waiting" ? a.icon : a.status === "approved" ? "check" : "minus"}
                  status={a.status === "waiting" ? "approval" : a.status === "approved" ? "works" : "blocked"}
                  title={a.title}
                  meta={a.status === "waiting" ? a.meta : `${a.status === "approved" ? "Approved" : "Rejected"} · ${a.meta}`}
                  aside={age(a.createdAt)}
                />
              ))}
          {tab === "decided" && !decided.length && <li className="px-2.5 py-3 text-small text-ink-2">Nothing decided yet. Decisions stay here with who, when and why.</li>}
        </>
      }
    >
      {notice && (
        <p role="status" className="mx-6 mt-5 rounded-card border-[1.5px] border-line px-4 py-2.5 font-semibold max-sm:mx-4">
          {notice}
        </p>
      )}
      {tab === "rules" && rule ? (
        <RuleDetail key={rule.id} rule={rule} />
      ) : current ? (
        <Detail
          key={current.id}
          request={current}
          onDecided={(note) => {
            setSelected(undefined);
            setNotice(note);
          }}
        />
      ) : (
        <EmptyState
          icon="approvals"
          title="Nothing waiting"
          className="my-auto"
          primary={
            <Button variant="primary" onClick={() => choose("rules")}>
              See the rules
            </Button>
          }
        >
          When a project asks for something your rules hold back, like a new app or a Live deploy, it shows up here.
        </EmptyState>
      )}
    </MasterDetail>
  );
}

function Detail({ request: r, onDecided }: { request: Request; onDecided: (note: string) => void }) {
  const router = useRouter();
  const id = useId();
  const [reason, setReason] = useState("");
  // Approving an app whose data host isn't allowed: allow the host too, in the same step (ticked by default).
  const hostHeld = Boolean(r.flow && !r.flow.allowed);
  const [alsoHost, setAlsoHost] = useState(true);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const waiting = r.status === "waiting";
  const act = (decision: "approve" | "reject", scope: DecisionScope = "once") =>
    start(async () => {
      setError(undefined);
      const res = await decideApproval({ approvalId: r.id, decision, scope, reason, allowHost: decision === "approve" && hostHeld && alsoHost });
      if (!res.ok) return setError(res.message);
      onDecided(`${r.title}: ${res.note ?? (decision === "approve" ? "Approved. The person who asked can carry on." : "Rejected. The person who asked sees your reason.")}`);
      router.refresh();
    });
  const busy = pending ? "Saving…" : undefined;

  return (
    <>
      <div className="flex-1 overflow-auto">
        <div className="mx-auto flex max-w-[680px] flex-col gap-[18px] px-6 pt-7 pb-8 max-sm:px-4">
          <div className="flex flex-col gap-1.5">
            <span className="flex flex-wrap items-center gap-2 text-small font-semibold text-ink-2">
              {r.ruleLine}
              <SimTag title="The request and your decision are real records; what approving unblocks is simulated in this prototype." />
            </span>
            <h2 className="text-title font-[650]">{r.title}</h2>
            <p className="text-ink-2">{r.consequence}</p>
          </div>

          <dl className="grid grid-cols-[150px_minmax(0,1fr)] rounded-card border border-line bg-surface max-sm:grid-cols-1">
            {r.facts.map((f, i) => (
              <div key={f.label} className={cn("contents")}>
                <dt className={cn("px-3.5 py-3 text-ink-2 max-sm:pb-1", i > 0 && "border-t border-line")}>{f.label}</dt>
                <dd className={cn("px-3.5 py-3 max-sm:pt-0", i > 0 && "border-t border-line max-sm:border-t-0")}>{f.value}</dd>
              </div>
            ))}
          </dl>

          {r.flow && (
            <div className={cn("flex flex-col gap-2.5 rounded-card border p-4", r.flow.allowed ? "border-line" : "border-attention")}>
              <div className="flex items-center gap-2.5">
                <StatusMark status={r.flow.allowed ? "works" : "attention"} icon={r.flow.allowed ? "check" : "alert"} />
                <strong className="font-[650]">
                  {r.flow.allowed ? `${cap(r.flow.data)} would go to ${r.flow.host}, which is on your allowed list` : `${cap(r.flow.data)} would leave your environment`}
                </strong>
              </div>
              <div className="ml-7 flex flex-wrap items-center gap-1.5 text-small">
                <Tag>{r.flow.from}</Tag>
                <Icon name="arrowRight" size="sm" className="text-ink-3" />
                <Tag>{r.flow.data}</Tag>
                <Icon name="arrowRight" size="sm" className="text-ink-3" />
                <Tag className={r.flow.allowed ? undefined : "bg-attention-bg text-attention"}>
                  {r.flow.host}
                  {r.flow.allowed ? "" : " · not on your allowed list"}
                </Tag>
              </div>
              {waiting && hostHeld && (
                <label className="ml-7 flex items-start gap-2.5">
                  <input type="checkbox" checked={alsoHost} onChange={(e) => setAlsoHost(e.target.checked)} className="mt-1 size-4 accent-[var(--ink)]" />
                  <span className="flex flex-col">
                    <span className="font-semibold">Also allow {r.flow.host} for data</span>
                    <span className="text-small text-ink-2">
                      {alsoHost ? "Approving adds it to your allowed hosts too, so Launch doesn't hold the deploy on it." : "Approving allows the app only. Launch then holds the deploy until the host is allowed."}
                    </span>
                  </span>
                </label>
              )}
            </div>
          )}

          {waiting ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={id} className="text-small font-semibold text-ink-2">
                Reason <span className="font-normal">(saved to the audit log; needed to reject)</span>
              </label>
              <textarea
                id={id}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Why are you approving or rejecting?"
                className="min-h-[72px] resize-none rounded-[12px] border border-line-ctl bg-surface px-3 py-2.5 text-body"
              />
            </div>
          ) : (
            r.decided && (
              <div className="flex flex-col gap-1 rounded-card border border-line p-4">
                <span className="flex items-center gap-2 font-[650]">
                  <StatusMark status={r.status === "approved" ? "works" : "blocked"} icon={r.status === "approved" ? "check" : "minus"} />
                  {r.decided.line}
                </span>
                <span className="ml-7 text-ink-2">{r.decided.reason ? `“${r.decided.reason}”` : "No reason given."}</span>
              </div>
            )
          )}

          {error && (
            <p role="alert" className="rounded-card border-[1.5px] border-failed px-4 py-2.5 font-semibold text-failed">
              {error}
            </p>
          )}
        </div>
      </div>
      {waiting && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-6 py-3.5 max-sm:px-4">
          {r.actions.map((a, i) => (
            <Button
              key={a.scope}
              data-tour={i === 0 && r.kind === "deploy" ? "approve" : undefined}
              variant={i === 0 ? "primary" : "secondary"}
              title={a.consequence}
              disabledReason={busy}
              onClick={() => act("approve", a.scope)}
            >
              {a.label}
            </Button>
          ))}
          <span className="flex-1" />
          <Button disabledReason={busy ?? (reason.trim() ? undefined : "Write a reason first. The person who asked sees it.")} onClick={() => act("reject")}>
            Reject
          </Button>
        </div>
      )}
    </>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function RuleDetail({ rule }: { rule: RuleItem }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto flex max-w-[680px] flex-col gap-[18px] px-6 pt-7 pb-8 max-sm:px-4">
        <div className="flex flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2 text-small font-semibold text-ink-2">
            {rule.kind === "allow" ? "Allow-rule · made from an approval" : "Rule · sends requests to an admin"}
            <SimTag title="Rules are real settings; enforcing them on deploys, pushes and apps is simulated in this prototype." />
          </span>
          <h2 className="text-title font-[650]">{rule.title}</h2>
          <p className="text-ink-2">{rule.detail}</p>
        </div>
        {rule.kind === "allow" && (
          <>
            <dl className="grid grid-cols-[150px_minmax(0,1fr)] rounded-card border border-line max-sm:grid-cols-1">
              <dt className="px-3.5 py-3 text-ink-2">Made by</dt>
              <dd className="px-3.5 py-3">
                {rule.createdByName} · {formatDay(rule.createdAt)} ({relativeTime(rule.createdAt)})
              </dd>
              <dt className="border-t border-line px-3.5 py-3 text-ink-2">Reason</dt>
              <dd className="border-t border-line px-3.5 py-3">{rule.reason ? `“${rule.reason}”` : "No reason given."}</dd>
            </dl>
            {confirm ? (
              <div role="group" aria-label="Remove this rule?" className="flex flex-col gap-2.5 rounded-card border border-line p-4">
                <strong className="font-[650]">Remove this rule?</strong>
                <p className="text-ink-2">Requests it covers wait for an admin again. Anything already approved stays approved.</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    disabledReason={pending ? "Removing…" : undefined}
                    onClick={() =>
                      start(async () => {
                        const r = await removeAllowRule({ ruleId: rule.id });
                        if (!r.ok) return setError(r.message);
                        router.refresh();
                      })
                    }
                  >
                    Remove rule
                  </Button>
                  <Button variant="quiet" onClick={() => setConfirm(false)}>
                    Keep it
                  </Button>
                </div>
              </div>
            ) : (
              <Button className="self-start" onClick={() => setConfirm(true)}>
                Remove rule
              </Button>
            )}
            {error && (
              <p role="alert" className="font-semibold text-failed">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
