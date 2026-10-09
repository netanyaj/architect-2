"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ax/button";
import { Icon } from "@/components/ax/icon";
import { SimTag } from "@/components/ax/pill";
import { StatusMark } from "@/components/ax/status-mark";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { canBuild, canManageMembers } from "@/lib/permissions";
import { mergeBlocker, syncNotice, type PullRequestView } from "@/lib/pull-requests";
import { cn } from "@/lib/utils";
import { mergePullRequest } from "@/server/actions/pull-requests";
import type { ProjectWorkspace } from "@/server/project";

const STATE: Record<PullRequestView["checks"], string> = { running: "Checks running", passing: "Checks passing", failing: "Checks failing" };

/**
 * A pull request (B-4, Simulated): the branch into main, the parts it implements with their tests, and Merge into
 * main, which is the push to main and always waits for the person's click (and, for a Builder under governance,
 * for an Owner or Admin).
 */
export function PrCard({ pr, project, governance }: { pr: PullRequestView; project: ProjectWorkspace; governance: boolean }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const owner = !governance || canManageMembers(project.role) || pr.pushAllowed;
  const viewer = canBuild(project.role) ? null : "Viewers can't merge pull requests.";
  const blocked = viewer ?? mergeBlocker(pr, owner);
  const word = pr.status === "merged" ? "Merged" : pr.status === "closed" ? "Closed" : pr.pushRequested ? "Waiting for approval" : pr.checks === "passing" ? "Ready to merge" : STATE[pr.checks];
  const merge = () =>
    start(async () => {
      setError(undefined);
      const r = await mergePullRequest({ prId: pr.id });
      setAsking(false);
      if (!r.ok) return setError(r.message);
      if (r.requested) setNotice("Asked an Owner or Admin to approve the push to main.");
      router.refresh();
    });
  return (
    <section aria-label={`Pull request #${pr.number}`} className="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="branch" size="sm" />
        <h3 className="flex-1 font-[650]">
          PR #{pr.number} · {pr.title}
        </h3>
        <SimTag title="Pull requests are simulated in this prototype: nothing is written to GitHub." />
      </div>
      <p className="text-small text-ink-2">
        <code className="font-mono">{pr.branch}</code> → <code className="font-mono">{pr.base}</code> on {project.repo} ·{" "}
        <span className={cn("font-semibold", pr.status === "merged" || pr.checks === "passing" ? "text-works" : pr.checks === "failing" && pr.status === "open" ? "text-failed" : pr.checks === "running" ? "text-building" : "text-ink-2")}>{word}</span>
        {pr.mergedAt && ` · merged by ${pr.mergedBy ?? "someone"}`}
      </p>
      {pr.status === "open" && !pr.pushRequested && pr.pushDecision && (
        <p className="text-small text-ink-2">
          {pr.pushDecision.status === "approved"
            ? `${pr.pushDecision.by} approved the push to main. You can merge it.`
            : `${pr.pushDecision.by} didn't approve the push: ${pr.pushDecision.reason ?? "no reason given"}. Fix that, then ask again.`}
        </p>
      )}
      <div>
        <h4 className="text-small font-semibold text-ink-2">Implements</h4>
        <ul className="mt-1 flex flex-col gap-1.5">
          {pr.parts.map((p) => (
            <li key={p.key} className="flex items-start gap-2">
              <StatusMark status={p.status === "built" || p.status === "sample_data" ? "works" : p.status === "failed" ? "failed" : p.status === "paused" ? "blocked" : "todo"} />
              <span className="flex min-w-0 flex-col">
                <span>{p.title}</span>
                {p.tests.map((t, i) => (
                  <span key={i} className="text-small text-ink-2">
                    Test: {t}
                  </span>
                ))}
                {!p.tests.length && <span className="text-small text-ink-2">Its test is written when the build starts.</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {pr.status === "open" && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabledReason={blocked ?? (pending ? "Merging…" : undefined)} onClick={() => setAsking(true)}>
            {owner ? "Merge into main" : "Ask to merge"}
          </Button>
          <span className="text-small text-ink-2">{blocked ?? "Nothing reaches main until you merge."}</span>
        </div>
      )}
      {notice && (
        <p role="status" className="text-small font-semibold">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-small font-semibold text-failed">
          {error}
        </p>
      )}
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent className="rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[460px]" showCloseButton={false}>
          <DialogTitle className="text-sub font-semibold">{owner ? `Merge PR #${pr.number} into main?` : `Ask to merge PR #${pr.number}?`}</DialogTitle>
          <DialogDescription className="text-ink-2">
            {owner
              ? `This pushes ${pr.branch} to main on ${project.repo}. Live deploys from main after this. In this prototype nothing is written to GitHub.`
              : "Pushing to main needs an Owner or Admin in this workspace. They'll see it in Approvals."}
          </DialogDescription>
          <DialogFooter className="mt-2 gap-2">
            <Button variant="quiet" onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabledReason={pending ? "Merging…" : undefined} onClick={merge}>
              {owner ? "Merge into main" : "Ask to merge"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** Sync (B-5, Simulated with ?sim=sync): commits on main from outside Architect, and the checks they re-ran. */
export function SyncBanner({ project, items }: { project: ProjectWorkspace; items: { key: string; title: string; status: string }[] }) {
  const [hidden, setHidden] = useState(false);
  if (hidden || !project.repo) return null;
  const n = syncNotice(items);
  return (
    <section role="status" aria-label="Sync with main" className="mx-3 mb-2 flex flex-col gap-2 rounded-card border-[1.5px] border-ink bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="branch" size="sm" />
        <h3 className="flex-1 font-semibold">{n.title}</h3>
        <SimTag title="Sync is simulated in this prototype." />
      </div>
      <ul className="flex flex-col gap-0.5 pl-6 text-small text-ink-2">
        {n.commits.map((c) => (
          <li key={c.sha}>
            <code className="font-mono">{c.sha}</code> “{c.message}” · {c.author}
          </li>
        ))}
      </ul>
      <p className="pl-6 text-small">
        {n.rerun ? (
          <>
            Re-ran the check for <b className="font-semibold">{n.rerun.title}</b>: <span className="font-semibold text-works">passed</span>. Architect&apos;s branch is up to date with main.
          </>
        ) : (
          "None of the plan's parts were touched, so no checks re-ran. Architect's branch is up to date with main."
        )}
      </p>
      <div className="pl-6">
        <Button size="sm" variant="quiet" onClick={() => setHidden(true)}>
          Dismiss
        </Button>
      </div>
    </section>
  );
}
