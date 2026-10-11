"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, TextLink } from "@/components/ax/button";
import { DataFlow } from "@/components/ax/data-flow";
import { NotDoneList } from "@/components/ax/not-done";
import { Icon } from "@/components/ax/icon";
import { SimTag } from "@/components/ax/pill";
import { StageBanner } from "@/components/ax/stage-banner";
import { StatusMark, StatusWord } from "@/components/ax/status-mark";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { runningCredits, type Deployment, type LaunchState } from "@/lib/launch";
import { canBuild, canManageMembers } from "@/lib/permissions";
import { relativeTime } from "@/lib/project-status";
import { providerName } from "@/lib/providers";
import { canHideBadge } from "@/lib/plans";
import { whatsNotDone } from "@/lib/readiness";
import { useUi } from "@/lib/ui-store";
import { cn } from "@/lib/utils";
import { bringBackLive, goBack, shareTestLink, shareWithTeam, takeOffline } from "@/server/actions/launch";
import { allowExternalCall } from "@/server/actions/external-calls";
import { allowHost } from "@/server/actions/policies";
import { setPartAside, setWaitingAside } from "@/server/actions/run";
import type { ProjectWorkspace } from "@/server/project";
import { ConnectButton } from "./connect-button";
import { KeysDialog } from "./launch-keys";
import { AccessSetting, AnalyticsSetting, BadgeSetting, DomainSetting, SignInSetting, MarketplaceSetting } from "./launch-settings";

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";
const ENV_LABEL = { staging: "Team version", production: "Live" } as const;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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

function Copy({ text, href }: { text: string; href?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : `Copy ${text}`}
      title={copied ? "Copied" : "Copy the address"}
      onClick={() => {
        void navigator.clipboard?.writeText(href ?? `https://${text}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="grid size-7 flex-none place-items-center rounded-full hover:bg-selected"
    >
      <Icon name={copied ? "check" : "copy"} size="sm" />
    </button>
  );
}

function VersionCard({
  when,
  title,
  detail,
  url,
  status,
  next,
  children,
}: {
  when: string;
  title: string;
  detail: string;
  url?: string;
  status?: React.ReactNode;
  next?: boolean;
  children?: React.ReactNode;
}) {
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
      {children}
    </div>
  );
}

/** Take offline, or Go live again with the version that was taken offline, after a confirmation. */
function LiveDialog({ kind, projectId, name, version, onClose }: { kind: "offline" | "back"; projectId: string; name: string; version: number; onClose: () => void }) {
  const { pending, error, act } = useAct();
  const off = kind === "offline";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[460px]" showCloseButton={false}>
        <DialogTitle className="text-sub font-semibold">{off ? `Take ${name} offline?` : `Bring back v${version} on Live?`}</DialogTitle>
        <DialogDescription className="text-ink-2">
          {off
            ? `People can't open it until it goes live again. Its data and every version are kept, and Go live again brings back v${version}.`
            : `v${version} serves Live again, with its data as it was when it went offline.`}
        </DialogDescription>
        {error && (
          <p role="alert" className="text-small font-semibold text-failed">
            {error}
          </p>
        )}
        <DialogFooter className="mt-2 gap-2">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabledReason={pending ? (off ? "Taking it offline…" : "Going live…") : undefined}
            onClick={() =>
              act(async () => {
                const r = off ? await takeOffline({ projectId }) : await bringBackLive({ projectId });
                if (r.ok) onClose();
                return r;
              })
            }
          >
            {off ? "Take offline" : `Go live with v${version}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Go back, after a confirmation that says what changes (review gap 11). */
function GoBackDialog({ target, notes, current, onClose }: { target: Deployment; notes: Record<number, string>; current: number | null; onClose: () => void }) {
  const { pending, error, act } = useAct();
  const undone = current !== null ? Array.from({ length: Math.max(0, current - target.version) }, (_, i) => target.version + i + 1) : [];
  const where = ENV_LABEL[target.environment].toLowerCase();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[480px]" showCloseButton={false}>
        <DialogTitle className="text-sub font-semibold">
          Go back to v{target.version} on the {where}?
        </DialogTitle>
        <DialogDescription className="text-ink-2">
          Data stays as it is; the code and settings go back to v{target.version}. You can come forward again from the history.
        </DialogDescription>
        {undone.length > 0 && (
          <div className="flex flex-col gap-1 rounded-card border border-line px-3.5 py-2.5 text-small">
            <span className="font-semibold">What goes away from the {where}</span>
            <ul className="list-disc pl-4 text-ink-2">
              {undone.map((v) => (
                <li key={v}>
                  v{v}: {notes[v] || "changes from that version"}
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <p role="alert" className="text-small font-semibold text-failed">
            {error}
          </p>
        )}
        <DialogFooter className="mt-2 gap-2">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabledReason={pending ? "Going back…" : undefined}
            onClick={() =>
              act(async () => {
                const r = await goBack({ deploymentId: target.id });
                if (r.ok) onClose();
                return r;
              })
            }
          >
            Go back to v{target.version}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Launch (screen 4 and reviews/deploy-flow-review-2026-10-05.md): Test → (Team) → Live, the checklist with inline
 * fixes, the failed and success states, who can open it, domains, analytics, the Marketplace, history and go back.
 */
export function LaunchView({ project, state }: { project: ProjectWorkspace; state: LaunchState }) {
  const { pending, error, note, act } = useAct();
  const { openHelp, openPart } = useUi();
  // A-10: before every deploy, what isn't done yet and why.
  const notDone = whatsNotDone(project.items, { budgetPaused: project.run?.status === "paused_budget" });
  const launch = project.launch!;
  const settings = launch.settings;
  const s = slug(project.name);
  const canAct = canBuild(project.role);
  const isAdmin = canManageMembers(project.role);
  const readOnly = canAct ? undefined : "Viewers can't change launch settings.";
  const version = project.plan?.version ?? 1;
  const busy = pending ? "Working…" : undefined;
  const firstFix = state.rows.find((r) => r.kind !== "fine");
  const fine = state.rows.filter((r) => r.kind === "fine").length;
  const history = [...launch.deployments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [confirm, setConfirm] = useState<Deployment | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const [liveAsk, setLiveAsk] = useState<"offline" | "back" | null>(null);
  // Taken offline (Take offline): the version that was live is kept, and Go live again brings it back.
  const offline = state.live.version === null ? history.find((d) => d.environment === "production" && d.status === "offline") : undefined;
  const liveRule = launch.governance && project.policy.permissions.deploy && !isAdmin ? "Only Owners and Admins can take Live offline or bring it back." : undefined;
  const liveDomain = settings.domains?.production?.status === "secured" ? settings.domains.production.name : `${s}.architect.app`;
  const teamDomain = settings.domains?.staging?.status === "secured" ? settings.domains.staging.name : `${s}--team.architect.space`;
  const testPath = launch.testShareToken ? `/share/${launch.testShareToken}` : null;
  const monthly = runningCredits(project.items);
  const access = settings.access ?? (launch.governance ? "domain" : "link");
  const audience = { link: "Anyone with the link", domain: `People at @${launch.domain}`, invited: "Invited people only" }[access];
  const failedEnvVersion = state.failure ? (state.failure.environment === "production" ? state.live.version : state.team.version) : null;

  return (
    <div className="mx-auto flex w-full max-w-[780px] flex-col gap-7 px-6 py-8 max-md:px-4">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-title font-[650]">Launch {project.name}</h1>
          <SimTag title="Deploys are simulated in this prototype" />
        </div>
        <p className="text-ink-2">
          {state.fast
            ? "Go live straight from your test version. Sharing a team version first is optional. You can go back in one click."
            : "Move it from your test version to your team, then live. Each step keeps the one before it, and you can go back in one click."}
        </p>
      </header>

      {/* Failed deploy (review gap 9): what failed, and that the version before is still running. */}
      {state.failure && (
        <StageBanner
          kind="error"
          title={`${state.failure.environment === "production" ? "Going live" : "Sharing with your team"} failed at the ${state.failure.step.toLowerCase()}`}
          actions={
            <>
              <TextLink onClick={() => openHelp(project.id)}>Ask a person</TextLink>
              <span className="text-small text-ink-2">or try again with the button at the top.</span>
            </>
          }
        >
          {state.failure.reason}{" "}
          {failedEnvVersion !== null
            ? `v${failedEnvVersion} is still running, so nothing changed for the people using it.`
            : "Nothing was switched on, and nothing was charged."}
        </StageBanner>
      )}

      {/* Success (review gap 13): the address, and what happens next. */}
      {state.live.current && !state.failure && (
        <section role="status" aria-label="It's live" className="flex flex-col gap-2.5 rounded-card border-[1.5px] border-works bg-surface px-4 py-3.5">
          <div className="flex items-start gap-2.5">
            <StatusMark status="works" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h2 className="font-semibold">v{state.live.version} is live</h2>
              <span className="flex min-w-0 items-center gap-1">
                <span className="truncate font-mono text-small">{liveDomain}</span>
                <Copy text={liveDomain} />
              </span>
              <p className="text-small text-ink-2">
                Architect watches it and tells you if a check starts failing. Changes you apply build a new version in Test first; then Update live sends it out.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pl-[30px]">
            <Button size="sm" icon="external" disabledReason="Opening the live app is simulated in this prototype: the address isn't real.">
              Open
            </Button>
            <Button size="sm" variant="quiet" onClick={() => void navigator.clipboard?.writeText(`https://${liveDomain}`)}>
              Copy to share
            </Button>
          </div>
        </section>
      )}

      <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
        <VersionCard when="Now" title="Test version" detail={testPath ? "You, and anyone with the view-only link · sample data allowed" : "Only you · sample data allowed"} url={`${s}--test.architect.space`}>
          {testPath ? (
            <span className="flex flex-col gap-1">
              <span className="flex min-w-0 items-center gap-1 text-small">
                <a href={testPath} target="_blank" rel="noreferrer" className="truncate underline decoration-line-ctl underline-offset-[3px]">
                  View-only link shared
                </a>
                <Copy text="the view-only link" href={typeof window !== "undefined" ? `${window.location.origin}${testPath}` : testPath} />
              </span>
              <TextLink className="self-start text-small" onClick={() => act(() => shareTestLink({ projectId: project.id, on: false }), "The view-only link no longer works.")}>
                Stop sharing
              </TextLink>
            </span>
          ) : (
            <Button
              size="sm"
              className="self-start"
              disabledReason={readOnly ?? busy}
              onClick={() => act(() => shareTestLink({ projectId: project.id, on: true }), "The view-only test link is ready. Copy it from the Test card.")}
            >
              Share test link
            </Button>
          )}
        </VersionCard>
        <VersionCard
          when={state.team.current ? "Shared" : state.fast ? "Optional" : "Next"}
          next={!state.fast && !state.team.current}
          title="Team version"
          detail="Your workspace · real data only"
          url={state.team.version !== null ? teamDomain : undefined}
          status={
            state.team.current ? (
              <StatusWord status="works">v{state.team.version} shared</StatusWord>
            ) : state.toFix && !state.fast ? (
              <StatusWord status="attention">{plural(state.toFix, "thing")} to fix</StatusWord>
            ) : (
              <StatusWord status="todo">
                {state.team.version !== null ? `v${state.team.version} shared · v${version} ready` : state.fast ? "Not needed to go live" : "Ready to share"}
              </StatusWord>
            )
          }
        >
          {state.repo && (
            <span className="text-small text-ink-2">
              Builds from the PR branch{state.repo.branch ? <> <code className="font-mono">{state.repo.branch}</code></> : ""}
              {state.repo.prNumber ? ` (PR #${state.repo.prNumber})` : ""}
            </span>
          )}
          {state.fast && !state.team.current && (
            <Button size="sm" className="self-start" disabledReason={state.share.disabledReason ?? busy} onClick={() => act(() => shareWithTeam({ projectId: project.id }), `Your team has v${version}.`)}>
              Share with your team
            </Button>
          )}
        </VersionCard>
        <VersionCard
          when={state.live.current ? "Running now" : "Then"}
          next={(state.fast || state.team.current) && !state.live.current}
          title="Live"
          detail={audience}
          url={state.live.version !== null ? liveDomain : undefined}
          status={
            offline ? (
              <StatusWord status="blocked">Offline · v{offline.version} kept</StatusWord>
            ) : state.live.current ? (
              <StatusWord status="works">v{state.live.version} is live</StatusWord>
            ) : state.live.behind ? (
              // Live is behind (review gap 8): the change is built but not out yet; Update live is the stage action.
              <StatusWord status="attention">{plural(state.live.behind, "change")} not live yet · Update live</StatusWord>
            ) : state.live.blocker ? (
              <StatusWord status="approval">Needs IT approval</StatusWord>
            ) : state.live.requested ? (
              <StatusWord status="approval">Waiting for approval</StatusWord>
            ) : state.live.decision?.status === "rejected" ? (
              <StatusWord status="blocked">Not approved</StatusWord>
            ) : (
              <StatusWord status="todo">{state.fast ? "Ready when the checklist is" : "After the team version"}</StatusWord>
            )
          }
        >
          {!state.live.current && !state.live.requested && state.live.decision && (
            <span className="text-small text-ink-2">
              {state.live.decision.status === "approved"
                ? `${state.live.decision.by} approved Live for this version.`
                : `${state.live.decision.by} didn't approve Live: ${state.live.decision.reason ?? "no reason given"}. Fix that, then ask again.`}
            </span>
          )}
          {state.repo && (
            <span className="text-small text-ink-2">
              {state.repo.merged ? `Deploys from main · PR #${state.repo.prNumber} merged` : `Deploys from main after ${state.repo.prNumber ? `PR #${state.repo.prNumber}` : "the pull request"} merges`}
            </span>
          )}
          {offline ? (
            <span className="flex flex-col items-start gap-1.5 text-small text-ink-2">
              People can&apos;t open it. Its data and every version are kept.
              <Button size="sm" disabledReason={readOnly ?? liveRule ?? busy} onClick={() => setLiveAsk("back")}>
                Go live again with v{offline.version}
              </Button>
            </span>
          ) : (
            state.live.version !== null && (
              <Button size="sm" variant="quiet" className="self-start" disabledReason={readOnly ?? liveRule ?? busy} onClick={() => setLiveAsk("offline")}>
                Take offline
              </Button>
            )
          )}
          {/* Where it runs (C-1): the organisation's choice, shown where the app goes live. */}
          {project.policy.location && (
            <span className="flex flex-wrap items-center gap-1.5 text-small text-ink-2">
              Runs in {project.policy.location} · your organisation&apos;s choice <SimTag title="Where an app runs is simulated in this prototype." />
            </span>
          )}
          {/* Running cost before going live (review gap 5). */}
          <span className="text-small text-ink-2 tabular-nums">
            About {monthly} credits a month (estimate)
            {project.budgetCredits ? ` · within the ${project.budgetCredits}-credit project budget` : " · no project budget set"}
          </span>
        </VersionCard>
      </div>

      {(error || note) && (
        <p role={error ? "alert" : "status"} className={cn("rounded-card border-[1.5px] px-4 py-2.5 font-semibold", error ? "border-failed text-failed" : "border-line text-ink")}>
          {error ?? note}
        </p>
      )}

      {notDone.length > 0 && (
        <section aria-labelledby="not-done" className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="not-done" className="text-sub font-semibold">
              What&apos;s not done
            </h2>
            <span className="text-small text-ink-2">
              {plural(notDone.length, "part")} of this version {notDone.length === 1 ? "doesn't" : "don't"} work yet. A deploy ships what works.
            </span>
          </div>
          <div className="rounded-card border border-line bg-surface p-1.5">
            <NotDoneList rows={notDone} onOpen={openPart} />
          </div>
        </section>
      )}

      <section aria-labelledby="checklist" className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="checklist" className="text-sub font-semibold">
            {state.fast || state.team.current ? "Before it goes live" : "Before your team can use it"}
          </h2>
          <span className="text-small text-ink-2">
            Architect checked {plural(state.rows.length, "thing")} · {fine} {fine === 1 ? "is" : "are"} fine
          </span>
        </div>
        <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
          {state.rows.map((r) => {
            const primary = r === firstFix;
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <StatusMark status={r.status} icon={r.kind === "connect" ? "plug" : r.kind === "sample" ? "lines" : r.status === "blocked" ? "pause" : r.status === "approval" ? "lock" : undefined} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{r.title}</span>
                  <span className="block text-small text-ink-2">{r.detail}</span>
                </span>
                {r.kind === "connect" && (
                  <ConnectButton
                    itemId={r.itemId}
                    provider={r.provider}
                    label={`Connect ${r.title.replace(/^Connect (.+) for your team$/, "$1")}`}
                    variant={primary ? "primary" : "secondary"}
                    disabledReason={!canAct ? "Viewers can't connect accounts." : busy}
                    policy={project.policy}
                  />
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
                {r.kind === "egress" &&
                  (r.path.kind === "app" ? (
                    isAdmin ? (
                      <Button variant={primary ? "primary" : "secondary"} size="sm" disabledReason={busy} onClick={() => act(() => allowHost({ host: r.path.host, projectId: project.id }), `${r.path.host} is allowed. Its data can go there now.`)}>
                        Allow {r.path.host}
                      </Button>
                    ) : (
                      <span className="flex flex-col items-end gap-0.5 text-right text-small text-ink-2">
                        An Owner or Admin can allow it.
                        <TextLink href="#data-flow">See where data goes</TextLink>
                      </span>
                    )
                  ) : (
                    <Button variant={primary ? "primary" : "secondary"} size="sm" href={`/p/${project.id}?view=agents`}>
                      Switch the agents&apos; model
                    </Button>
                  ))}
                {r.kind === "keys" && (
                  <Button variant={primary ? "primary" : "secondary"} size="sm" onClick={() => setKeysOpen(true)}>
                    Set keys
                  </Button>
                )}
                {r.kind === "external" &&
                  (isAdmin ? (
                    <Button variant={primary ? "primary" : "secondary"} size="sm" disabledReason={busy} onClick={() => act(() => allowExternalCall({ projectId: project.id, provider: r.provider }), `${providerName(r.provider)} can be called with its key on Live.`)}>
                      Allow {providerName(r.provider)} calls
                    </Button>
                  ) : r.waiting ? (
                    <StatusWord status="approval">Waiting for an Owner or Admin</StatusWord>
                  ) : (
                    <Button variant={primary ? "primary" : "secondary"} size="sm" disabledReason={!canAct ? "Viewers can't ask for approval." : busy} onClick={() => act(() => allowExternalCall({ projectId: project.id, provider: r.provider }), "Asked. An Owner or Admin decides in Approvals.")}>
                      Ask for approval
                    </Button>
                  ))}
                {r.id === "tests" && <SimTag title="Checks run in the simulated build: tests, the security scan and the personal-data check" />}
              </li>
            );
          })}
        </ul>
        {state.goLive.disabledReason && (state.fast || state.team.current) && !state.live.current && !firstFix && <p className="text-small text-ink-2">{state.goLive.disabledReason}</p>}
      </section>

      {project.launch!.flows.length > 0 && (
        <section id="data-flow" aria-labelledby="data-flow-title" className="flex scroll-mt-6 flex-col gap-2.5">
          <h2 id="data-flow-title" className="flex items-center gap-2 text-sub font-semibold">
            Where data goes <SimTag title="Where data goes is worked out from the plan's apps and agents; nothing is sent in this prototype." />
          </h2>
          <p className="text-small text-ink-2">Your organisation decides which hosts and models data may go to. A path it doesn&apos;t allow holds every deploy until it&apos;s fixed.</p>
          <DataFlow project={project.name} paths={project.launch!.flows} />
        </section>
      )}

      <section aria-labelledby="settings" className="flex flex-col gap-2.5">
        <h2 id="settings" className="text-sub font-semibold">
          Settings for the shared versions
        </h2>
        <div className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
          <AccessSetting projectId={project.id} value={access} domain={launch.domain} readOnly={readOnly} />
          {!state.fast && <DomainSetting projectId={project.id} env="staging" state={settings.domains?.staging} fallback={`${s}--team.architect.space`} readOnly={readOnly} />}
          <DomainSetting projectId={project.id} env="production" state={settings.domains?.production} fallback={`${s}.architect.app`} readOnly={readOnly} />
          <AnalyticsSetting projectId={project.id} on={Boolean(settings.analytics)} readOnly={readOnly} />
          <BadgeSetting projectId={project.id} on={settings.badge !== false} canHide={canHideBadge(launch.plan)} readOnly={readOnly} />
          <SignInSetting projectId={project.id} value={settings.signIn ?? "google"} governance={launch.governance} access={access} readOnly={readOnly} />
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 font-semibold">
                Keys and passwords <SimTag title="Keys are simulated: values are checked and thrown away." />
              </span>
              <span className="block text-small text-ink-2">
                Saved per version, never in the code
                {launch.keys.length ? ` · ${launch.keys.length} ${launch.keys.length === 1 ? "key" : "keys"}` : ""}
              </span>
            </span>
            <Button size="sm" onClick={() => setKeysOpen(true)}>
              Manage
            </Button>
          </div>
        </div>
      </section>

      <section aria-label="Marketplace" className="rounded-card border border-line bg-surface">
        <MarketplaceSetting projectId={project.id} listing={settings.listing} isLive={state.live.version !== null} readOnly={readOnly} name={project.name} />
      </section>

      <section id="history" aria-labelledby="history-title" className="flex scroll-mt-4 flex-col gap-2.5">
        <h2 id="history-title" className="text-sub font-semibold">
          Version history
        </h2>
        {history.length === 0 ? (
          <p className="rounded-card border border-line bg-surface px-4 py-3 text-ink-2">
            Nothing shared yet. Every version you share or put live shows here, and you can go back to any of them in one click.
            {project.versions.length > 1 && ` Your plan has ${project.versions.length} versions; compare them in Plan.`}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
            {history.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <StatusMark status={d.status === "live" ? "works" : d.status === "failed" ? "failed" : "todo"} icon={d.status === "live" ? "check" : d.status === "failed" ? "alert" : "dot"} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    {ENV_LABEL[d.environment]} · v{d.version}
                    {d.status === "live" && <span className="font-normal text-ink-2"> · running now</span>}
                    {d.status === "failed" && <span className="font-normal text-failed"> · failed at the {d.failure?.step.toLowerCase() ?? "deploy"}</span>}
                  </span>
                  <span className="block text-small text-ink-2">
                    {launch.versionNotes[d.version] ? `${launch.versionNotes[d.version]} · ` : ""}
                    {relativeTime(d.createdAt)}
                    {d.by ? ` by ${d.by}` : ""}
                  </span>
                </span>
                {d.status === "rolled_back" && (
                  <Button size="sm" disabledReason={!canAct ? "Viewers can't change what's live." : busy} onClick={() => setConfirm(d)}>
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

      <KeysDialog projectId={project.id} rows={launch.keys} open={keysOpen} onOpenChange={setKeysOpen} canSet={canAct} liveNeedsApproval={launch.governance && project.policy.permissions.secrets && !isAdmin} />
      {liveAsk && (
        <LiveDialog
          kind={liveAsk}
          projectId={project.id}
          name={project.name}
          version={liveAsk === "back" ? (offline?.version ?? 1) : (state.live.version ?? 1)}
          onClose={() => setLiveAsk(null)}
        />
      )}
      {confirm && (
        <GoBackDialog
          target={confirm}
          notes={launch.versionNotes}
          current={confirm.environment === "production" ? state.live.version : state.team.version}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
