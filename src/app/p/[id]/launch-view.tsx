"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, TextLink } from "@/components/ax/button";
import { Icon } from "@/components/ax/icon";
import { SimTag } from "@/components/ax/pill";
import { StatusMark, StatusWord } from "@/components/ax/status-mark";
import { canBuild } from "@/lib/permissions";
import type { LaunchState } from "@/lib/launch";
import { relativeTime } from "@/lib/project-status";
import { cn } from "@/lib/utils";
import { goBack, goLive } from "@/server/actions/launch";
import { connectPart, setPartAside, setWaitingAside } from "@/server/actions/run";
import type { ProjectWorkspace } from "@/server/project";

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";
const ENV_LABEL = { staging: "Team version", production: "Live" } as const;

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const act = (fn: () => Promise<{ ok: boolean; message?: string; requested?: boolean }>, done?: string) =>
    start(async () => {
      setError(undefined);
      setNote(undefined);
      const r = await fn();
      if (!r.ok) setError(r.message);
      else if (r.requested) setNote("Sent to your Owners and Admins. Live goes out when one of them approves.");
      else if (done) setNote(done);
      router.refresh();
    });
  return { pending, error, note, act };
}

function Copy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : `Copy ${text}`}
      title={copied ? "Copied" : "Copy the address"}
      onClick={() => {
        void navigator.clipboard?.writeText(`https://${text}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="grid size-7 flex-none place-items-center rounded-full hover:bg-selected"
    >
      <Icon name={copied ? "check" : "copy"} size="sm" />
    </button>
  );
}

function VersionCard({ when, title, detail, url, status, next }: { when: string; title: string; detail: string; url?: string; status?: React.ReactNode; next?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 rounded-card border bg-surface px-4 py-3.5", next ? "border-2 border-ink" : "border-line")}>
      <span className="text-small font-semibold text-ink-2">{when}</span>
      <h3 className="text-sub font-semibold">{title}</h3>
      <p className="text-small text-ink-2">{detail}</p>
      {url && (
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate font-mono text-small">{url}</span>
          <Copy text={url} />
        </span>
      )}
      {status}
    </div>
  );
}

/** Launch (screen 4): Test → Team → Live, the checklist with inline fixes, settings, history and go back. */
export function LaunchView({ project, state }: { project: ProjectWorkspace; state: LaunchState }) {
  const { pending, error, note, act } = useAct();
  const launch = project.launch!;
  const s = slug(project.name);
  const canAct = canBuild(project.role);
  const version = project.plan?.version ?? 1;
  const busy = pending ? "Working…" : undefined;
  const firstFix = state.rows.find((r) => r.kind !== "fine");
  const fine = state.rows.filter((r) => r.kind === "fine").length;
  const history = [...launch.deployments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sim = "Simulated: comes with the governance layer (M5).";

  return (
    <div className="mx-auto flex w-full max-w-[780px] flex-col gap-7 px-6 py-8 max-md:px-4">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-title font-[650]">Launch {project.name}</h1>
          <SimTag title="Deploys are simulated in this prototype" />
        </div>
        <p className="text-ink-2">Move it from your test version to your team, then live. Each step keeps the one before it, and you can go back in one click.</p>
      </header>

      <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
        <VersionCard when="Now" title="Test version" detail="Only you · sample data allowed" url={`${s}--test.architect.space`} />
        <VersionCard
          when={state.team.current ? "Shared" : "Next"}
          next={!state.team.current}
          title="Team version"
          detail="Your workspace · real data only"
          url={state.team.version !== null ? `${s}--team.architect.space` : undefined}
          status={
            state.team.current ? (
              <StatusWord status="works">v{state.team.version} shared</StatusWord>
            ) : state.toFix ? (
              <StatusWord status="attention">{state.toFix} {state.toFix === 1 ? "thing" : "things"} to fix</StatusWord>
            ) : (
              <StatusWord status="todo">{state.team.version !== null ? `v${state.team.version} shared · v${version} ready` : "Ready to share"}</StatusWord>
            )
          }
        />
        <VersionCard
          when={state.live.current ? "Live" : "Then"}
          next={state.team.current && !state.live.current}
          title="Live"
          detail={`${s}.architect.app · anyone you allow`}
          url={state.live.version !== null ? `${s}.architect.app` : undefined}
          status={
            state.live.current ? (
              <StatusWord status="works">v{state.live.version} is live</StatusWord>
            ) : state.live.blocker ? (
              <StatusWord status="approval">Needs IT approval</StatusWord>
            ) : state.live.requested ? (
              <StatusWord status="approval">Waiting for approval</StatusWord>
            ) : (
              <StatusWord status="todo">{state.live.version !== null ? `v${state.live.version} live` : "After the team version"}</StatusWord>
            )
          }
        />
      </div>

      {(error || note) && (
        <p role={error ? "alert" : "status"} className={cn("rounded-card border-[1.5px] px-4 py-2.5 font-semibold", error ? "border-failed text-failed" : "border-line text-ink")}>
          {error ?? note}
        </p>
      )}

      <section aria-labelledby="checklist" className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="checklist" className="text-sub font-semibold">
            {state.team.current ? "Before it goes live" : "Before your team can use it"}
          </h2>
          <span className="text-small text-ink-2">
            Architect checked {state.rows.length} {state.rows.length === 1 ? "thing" : "things"} · {fine} {fine === 1 ? "is" : "are"} fine
          </span>
        </div>
        <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
          {state.rows.map((r) => {
            const primary = r === firstFix;
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <StatusMark status={r.status} icon={r.kind === "connect" ? "plug" : r.kind === "sample" ? "lines" : r.status === "blocked" ? "pause" : undefined} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{r.title}</span>
                  <span className="block text-small text-ink-2">{r.detail}</span>
                </span>
                {r.kind === "connect" && (
                  <Button variant={primary ? "primary" : "secondary"} size="sm" disabledReason={!canAct ? "Viewers can't connect accounts." : busy} onClick={() => act(() => connectPart({ itemId: r.itemId }))}>
                    Connect {r.title.replace(/^Connect (.+) for your team$/, "$1")}
                  </Button>
                )}
                {r.kind === "sample" && (
                  <Button variant={primary ? "primary" : "secondary"} size="sm" disabledReason={!canAct ? "Viewers can't change the plan." : busy} onClick={() => act(() => setPartAside({ itemId: r.itemId }))}>
                    Leave it out for now
                  </Button>
                )}
                {r.kind === "blocked" && (
                  <Button variant={primary ? "primary" : "secondary"} size="sm" href={`/p/${project.id}`}>
                    Open it
                  </Button>
                )}
                {r.kind === "unbuilt" && (
                  <Button variant={primary ? "primary" : "secondary"} size="sm" disabledReason={!canAct ? "Viewers can't change the plan." : busy} onClick={() => act(() => setWaitingAside({ projectId: project.id }))}>
                    Leave {r.count === 1 ? "it" : "them"} out for now
                  </Button>
                )}
                {r.kind === "fine" && <SimTag title="Checks run in the simulated build" />}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="go-live" className="flex flex-col gap-2.5">
        <h2 id="go-live" className="text-sub font-semibold">
          Share and go live
        </h2>
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface px-4 py-3.5">
          <span className="min-w-0 flex-1 text-ink-2">
            {state.team.current
              ? state.live.current
                ? `v${version} is live. Changes you apply build a new version; you share it when it's ready.`
                : "Your team has this version. Live follows it, with the same checks."
              : "Your workspace gets the team version first. Live always follows it."}
          </span>
          {state.team.current && !state.live.current && (
            <Button
              variant={!state.goLive.disabledReason && !firstFix ? "primary" : "secondary"}
              disabledReason={state.goLive.disabledReason ?? busy}
              onClick={() => act(() => goLive({ projectId: project.id }), "It's live.")}
            >
              {state.goLive.label}
            </Button>
          )}
          {state.goLive.disabledReason && state.team.current && !state.live.current && <span className="w-full text-small text-ink-2">{state.goLive.disabledReason}</span>}
        </div>
      </section>

      <section aria-labelledby="settings" className="flex flex-col gap-2.5">
        <h2 id="settings" className="text-sub font-semibold">
          Settings for the shared versions
        </h2>
        <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
          {[
            ["Who can sign in", "Anyone in your workspace with Google sign-in", "Change"],
            ["Web address", `${s}.architect.app for the live version`, "Change"],
            ["Keys and passwords", "Saved for the team and live versions, never in the code", "Manage"],
          ].map(([title, detail, label]) => (
            <li key={title} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{title}</span>
                <span className="block text-small text-ink-2">{detail}</span>
              </span>
              <Button size="sm" disabledReason={sim}>
                {label}
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section id="history" aria-labelledby="history-title" className="flex scroll-mt-4 flex-col gap-2.5">
        <h2 id="history-title" className="text-sub font-semibold">
          Version history
        </h2>
        {history.length === 0 ? (
          <p className="rounded-card border border-line bg-surface px-4 py-3 text-ink-2">
            Nothing shared yet. Every version you share or put live shows here, and you can go back to any of them in one click.
            {project.versions.length > 1 && ` Your plan has ${project.versions.length} versions; compare them in Files.`}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
            {history.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <StatusMark status={d.status === "live" ? "works" : "todo"} icon={d.status === "live" ? "check" : "dot"} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    {ENV_LABEL[d.environment]} · v{d.version}
                    {d.status === "live" && <span className="font-normal text-ink-2"> · running now</span>}
                  </span>
                  <span className="block text-small text-ink-2">
                    {relativeTime(d.createdAt)}
                    {d.by ? ` by ${d.by}` : ""}
                  </span>
                </span>
                {d.status !== "live" && (
                  <Button size="sm" disabledReason={!canAct ? "Viewers can't change what's live." : busy} onClick={() => act(() => goBack({ deploymentId: d.id }), `Went back to v${d.version}.`)}>
                    Go back to this
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-small text-ink-2">
        This project has used {Math.round(project.spent.total)} credits. <TextLink href="/usage">See Usage</TextLink>
      </p>
    </div>
  );
}
