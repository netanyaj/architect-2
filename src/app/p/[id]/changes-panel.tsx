"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ax/button";
import { Drawer } from "@/components/ax/drawer";
import { Icon } from "@/components/ax/icon";
import { SimTag } from "@/components/ax/pill";
import { StatusMark } from "@/components/ax/status-mark";
import { canBuild, canManageMembers } from "@/lib/permissions";
import { mergeBlocker, REVIEW_STEPS, reviewStep, type PullRequestView } from "@/lib/pull-requests";
import { useUi } from "@/lib/ui-store";
import { cn } from "@/lib/utils";
import { mergePullRequest, openPullRequestNow } from "@/server/actions/pull-requests";
import type { ProjectWorkspace } from "@/server/project";

/** Whether this person can push to main without an Owner or Admin (the push rule, C-10). */
export function canMergeThemselves(project: ProjectWorkspace, pr: PullRequestView | null): boolean {
  return !project.governance || canManageMembers(project.role) || Boolean(pr?.pushAllowed) || !project.policy.permissions.push;
}

/** The change in progress: the open PR, or edits on the branch not on a PR yet. */
export function currentChange(project: ProjectWorkspace) {
  const open = project.pullRequests.find((p) => p.status === "open") ?? null;
  const unmergedEdits = project.codeEdits.edits.filter((e) => e.prNumber === null || e.prNumber === open?.number);
  const parts = open ? open.parts.length : new Set(unmergedEdits.map((e) => e.partKey)).size;
  return { open, parts, edits: unmergedEdits };
}

/**
 * Changes (M5.5 review): the one home for code review on a project from a repo. The change by part (its tests and
 * code edits), where it stands (Draft · Checks running · Ready to merge · Needs approval · Merged), and the one action
 * for that step: Open PR, Merge into main, or Ask to merge. Chat's PR cards link here. Simulated: nothing reaches GitHub.
 */
export function ChangesPanel({ project }: { project: ProjectWorkspace }) {
  const router = useRouter();
  const { changesOpen, openChanges } = useUi();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  if (!project.repo) return null;
  const { open, edits } = currentChange(project);
  const latest = open ?? project.pullRequests[0] ?? null;
  const shown = open ?? (edits.length ? null : latest);
  const self = canMergeThemselves(project, shown);
  const step = reviewStep(shown, self);
  const viewer = canBuild(project.role) ? null : "Viewers can review changes but can't open or merge them.";
  const blocked = shown && shown.status === "open" ? (viewer ?? mergeBlocker(shown, self)) : viewer;
  const act = (fn: () => Promise<{ ok: boolean; message?: string; requested?: boolean }>, done?: string) =>
    start(async () => {
      setError(undefined);
      setNotice(undefined);
      const r = await fn();
      setConfirm(false);
      if (!r.ok) return setError(r.message);
      setNotice(r.requested ? "Asked an Owner or Admin to approve the push to main. It's in Approvals." : done);
      router.refresh();
    });

  // No open PR: offer to open one once the branch has work (edits, or what the build made); the server says if not.
  const draftWork = edits.length > 0 || project.items.some((i) => ["built", "sample_data", "needs_connection"].includes(i.status));
  const footer =
    step === "Draft" && draftWork ? (
      <Button variant="primary" disabledReason={viewer ?? (pending ? "Opening…" : undefined)} onClick={() => act(() => openPullRequestNow({ projectId: project.id }), "Pull request opened.")}>
        Open PR
      </Button>
    ) : shown?.status === "open" ? (
      confirm ? (
        <div className="flex w-full flex-col gap-2">
          <p className="text-small">
            {self
              ? `This pushes ${shown.branch} to main on ${project.repo}. Live deploys from main after this. Nothing is written to GitHub in this prototype.`
              : "Pushing to main needs an Owner or Admin in this workspace. They'll see it in Approvals."}
          </p>
          <div className="flex gap-2">
            <Button variant="primary" disabledReason={pending ? "Merging…" : undefined} onClick={() => act(() => mergePullRequest({ prId: shown.id }), "Merged into main.")}>
              {self ? "Merge into main" : "Ask to merge"}
            </Button>
            <Button variant="quiet" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <Button variant="primary" disabledReason={blocked ?? (pending ? "Merging…" : undefined)} onClick={() => setConfirm(true)}>
            {self ? "Merge into main" : "Ask to merge"}
          </Button>
          <span className="text-small text-ink-2">{blocked ?? "Nothing reaches main until it's merged."}</span>
        </>
      )
    ) : undefined;

  return (
    <Drawer
      open={changesOpen}
      onOpenChange={openChanges}
      icon={<Icon name="branch" />}
      title="Changes"
      state={
        <span className="flex flex-wrap items-center gap-2">
          {shown ? (
            <>
              PR #{shown.number} · <code className="font-mono">{shown.branch}</code> → <code className="font-mono">{shown.base}</code> on {project.repo}
            </>
          ) : (
            <>Edits on the branch, not on a pull request yet</>
          )}
          <SimTag title="Pull requests are simulated in this prototype: nothing is written to GitHub." />
        </span>
      }
      footer={
        footer || error || notice ? (
          <>
            {footer}
            {notice && (
              <p role="status" className="w-full text-small font-semibold">
                {notice}
              </p>
            )}
            {error && (
              <p role="alert" className="w-full text-small font-semibold text-failed">
                {error}
              </p>
            )}
          </>
        ) : undefined
      }
    >
      <ol aria-label="Where it stands" className="flex flex-wrap items-center gap-1.5">
        {REVIEW_STEPS.map((s, i) => {
          const at = REVIEW_STEPS.indexOf(step);
          const failing = s === "Checks running" && step === s && shown?.checks === "failing";
          return (
            <li key={s} aria-current={s === step ? "step" : undefined} className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-small font-semibold", s === step ? "bg-ink text-surface" : i < at ? "text-ink" : "text-ink-3")}>
              {i < at && <Icon name="check" size="sm" />}
              {failing ? "Checks failing" : s}
            </li>
          );
        })}
      </ol>

      {shown && shown.status === "open" && !shown.pushRequested && shown.pushDecision && (
        <p className="text-small text-ink-2">
          {shown.pushDecision.status === "approved" ? `${shown.pushDecision.by} approved the push to main. You can merge it.` : `${shown.pushDecision.by} didn't approve the push: ${shown.pushDecision.reason ?? "no reason given"}. Fix that, then ask again.`}
        </p>
      )}

      <section aria-label="Changed parts" className="flex flex-col gap-2">
        <h3 className="font-semibold">By part</h3>
        {shown ? (
          <ul className="flex flex-col gap-2">
            {shown.parts.map((p) => {
              const partEdits = edits.filter((e) => e.partKey === p.key);
              return (
                <li key={p.key} className="flex items-start gap-2 rounded-card border border-line px-3 py-2.5">
                  <StatusMark status={p.status === "built" || p.status === "sample_data" ? "works" : p.status === "failed" ? "failed" : p.status === "paused" ? "blocked" : "todo"} />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold">{p.title}</span>
                    {p.tests.map((t, i) => (
                      <span key={i} className="text-small text-ink-2">
                        Test: {t}
                      </span>
                    ))}
                    {partEdits.map((e) => (
                      <span key={e.id} className="text-small text-ink-2">
                        <code className="font-mono">{e.path}</code> +{e.added} −{e.removed} · by {e.by}
                      </span>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : edits.length ? (
          <ul className="flex flex-col gap-2">
            {[...new Set(edits.map((e) => e.partKey))].map((key) => {
              const partEdits = edits.filter((e) => e.partKey === key);
              return (
                <li key={key} className="flex items-start gap-2 rounded-card border border-line px-3 py-2.5">
                  <StatusMark status={partEdits.some((e) => e.check === "running") ? "building" : "works"} />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold">{partEdits[0].partTitle}</span>
                    {partEdits.map((e) => (
                      <span key={e.id} className="text-small text-ink-2">
                        <code className="font-mono">{e.path}</code> +{e.added} −{e.removed} · by {e.by}
                      </span>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-small text-ink-2">No changes yet. A build, a change in chat or an edit in Developer view shows here.</p>
        )}
      </section>

      {project.pullRequests.filter((p) => p !== shown).length > 0 && (
        <section aria-label="Earlier pull requests" className="flex flex-col gap-1.5">
          <h3 className="font-semibold">Earlier</h3>
          <ul className="flex flex-col gap-1 text-small text-ink-2">
            {project.pullRequests
              .filter((p) => p !== shown)
              .map((p) => (
                <li key={p.id}>
                  PR #{p.number} · {p.title} · {p.status === "merged" ? `Merged${p.mergedBy ? ` by ${p.mergedBy}` : ""}` : p.status === "closed" ? "Closed" : reviewStep(p, canMergeThemselves(project, p))}
                </li>
              ))}
          </ul>
        </section>
      )}
    </Drawer>
  );
}
