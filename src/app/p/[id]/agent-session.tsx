"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SimTag } from "@/components/ax/pill";
import { agentSession, sessionLine, sessionPart, type AgentSession, type SessionStep } from "@/lib/mcp";
import { cn } from "@/lib/utils";
import type { ProjectWorkspace, WorkspaceItem } from "@/server/project";

export type SessionState = { session: AgentSession; played: SessionStep[]; waiting: boolean; done: boolean } | { blocked: string } | null;

/**
 * ?sim=byoagent (F4): plays a short scripted session by the project's coding agent over MCP, from when the page
 * opens. Needs an active project token. While the part waits for its check it isn't Works.
 */
export function useAgentSession(project: ProjectWorkspace, items: WorkspaceItem[], enabled: boolean): SessionState {
  const [elapsed, setElapsed] = useState(0);
  const part = useMemo(() => sessionPart(items), [items]);
  const session = useMemo(
    () => (part ? agentSession({ part, partCount: items.filter((i) => i.status !== "dropped").length, version: project.plan?.version ?? 1, owner: project.ownerName === "you" ? "you" : project.ownerName, repo: Boolean(project.repo) }) : null),
    // The script is fixed once it starts: the part it picked stays the same while it plays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [part?.key, project.id],
  );
  const ready = enabled && project.tokens.active > 0 && session !== null;
  useEffect(() => {
    if (!ready || !session) return;
    const start = Date.now();
    const t = setInterval(() => {
      const ms = Date.now() - start;
      setElapsed(ms);
      if (ms > session.endMs) clearInterval(t);
    }, 250);
    return () => clearInterval(t);
  }, [ready, session]);
  if (!enabled) return null;
  if (project.tokens.active === 0) {
    return { blocked: project.tokens.waiting ? "The project's coding agent token is waiting for approval." : "No coding agent is connected: make a project token first." };
  }
  if (!session) return { blocked: "Nothing works yet for a coding agent to change. Build the plan first." };
  return { session, played: session.steps.filter((s) => s.atMs <= elapsed), waiting: elapsed >= session.waitFromMs && elapsed < session.worksAtMs, done: elapsed >= session.endMs };
}

/** While the session's change waits for the checker, the part shows it (it isn't Works until the check passes). */
export function withSession(items: WorkspaceItem[], state: SessionState): WorkspaceItem[] {
  if (!state || "blocked" in state || !state.waiting) return items;
  return items.map((i) => (i.key === state.session.partKey ? { ...i, status: "building", statusDetail: `Waiting for its check · changed by ${state.session.agent}` } : i));
}

/** The session's activity lines ("Coding agent: Claude Code (Sam) · via MCP · updated ‘Brief writer’"). */
export function AgentSessionLines({ project, state }: { project: ProjectWorkspace; state: SessionState }) {
  if (!state) return null;
  if ("blocked" in state) {
    return (
      <section aria-label="Coding agent session" className="flex flex-col gap-1 rounded-card border border-line p-3 text-small">
        <span className="flex items-center gap-2 font-semibold">
          Coding agent session <SimTag />
        </span>
        <span className="text-ink-2">
          {state.blocked}{" "}
          <Link href={`/p/${project.id}/settings`} className="font-semibold text-ink underline decoration-line-ctl underline-offset-[3px]">
            Project settings › Coding agents
          </Link>
        </span>
      </section>
    );
  }
  return (
    <section aria-label="Coding agent session" className="flex flex-col gap-1.5 rounded-card border border-line p-3">
      <span className="flex items-center gap-2 text-small font-semibold">
        Coding agent session <SimTag title="A scripted session (?sim=byoagent). No coding agent is connected in this prototype." />
      </span>
      <ol aria-label="Coding agent activity" className="flex flex-col gap-1 text-small">
        {state.played.map((s) => (
          <li key={s.atMs} className={cn(s.kind === "fail" && "text-failed", s.kind === "ok" && "text-works")}>
            {sessionLine(state.session, s)}
          </li>
        ))}
      </ol>
      {state.waiting && (
        <p role="status" className="text-small font-semibold text-building">
          ‘{state.session.partTitle}’ is waiting for its check. Only the checker can mark it Works.
        </p>
      )}
    </section>
  );
}
