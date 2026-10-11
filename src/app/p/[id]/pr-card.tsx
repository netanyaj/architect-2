"use client";

import { useState } from "react";
import { Button, TextLink } from "@/components/ax/button";
import { Icon } from "@/components/ax/icon";
import { SimTag } from "@/components/ax/pill";
import { reviewStep, syncNotice, type PullRequestView } from "@/lib/pull-requests";
import { useUi } from "@/lib/ui-store";
import type { ProjectWorkspace } from "@/server/project";
import { canMergeThemselves } from "./changes-panel";

/**
 * A pull request in chat (B-4, Simulated): what it is and where it stands. Reviewing and merging happen in one place,
 * the Changes panel, which this links to (M5.5 review).
 */
export function PrCard({ pr, project }: { pr: PullRequestView; project: ProjectWorkspace; governance?: boolean }) {
  const openChanges = useUi((s) => s.openChanges);
  const step = reviewStep(pr, canMergeThemselves(project, pr));
  return (
    <section aria-label={`Pull request #${pr.number}`} className="flex w-full min-w-0 flex-col gap-2 rounded-card border border-line bg-surface px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="branch" size="sm" />
        <h3 className="flex-1 font-[650]">
          PR #{pr.number} · {pr.title}
        </h3>
      </div>
      <p className="text-small text-ink-2">
        <code className="font-mono">{pr.branch}</code> → <code className="font-mono">{pr.base}</code> on {project.repo} · <span className="font-semibold text-ink">{pr.status === "open" && pr.checks === "failing" ? "Checks failing" : step}</span>
        {pr.mergedAt && ` · merged by ${pr.mergedBy ?? "someone"}`} · {pr.parts.length} {pr.parts.length === 1 ? "part" : "parts"}
        {project.codeEdits.edits.some((e) => e.prNumber === pr.number) ? " · code edits" : ""}
      </p>
      <TextLink className="self-start text-small" onClick={() => openChanges(true)}>
        Review changes
      </TextLink>
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
