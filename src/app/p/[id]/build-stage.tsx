"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button, TextLink } from "@/components/ax/button";
import { ArchitectMessage, chatTime } from "@/components/ax/chat-message";
import { Icon } from "@/components/ax/icon";
import { NeedsYouCard } from "@/components/ax/needs-you-card";
import { SimTag } from "@/components/ax/pill";
import { PlanGroup, PlanRow } from "@/components/ax/plan-panel";
import { PreviewDock, PreviewFrame } from "@/components/ax/preview-dock";
import { StageBanner } from "@/components/ax/stage-banner";
import type { Status, StatusIcon } from "@/components/ax/status-mark";
import { canBuild, canManageMembers } from "@/lib/permissions";
import { isSignInService, providerName, WAITING_FOR_KEY } from "@/lib/providers";
import { previewState } from "@/lib/sim/preview";
import type { LiveRun } from "@/lib/sim/replay";
import { usePreviewScheme } from "@/lib/preview-scheme";
import { hasDarkTheme, previewVars, themeOf } from "@/lib/themes";
import { useUi } from "@/lib/ui-store";
import { proposeDarkTheme } from "@/server/actions/chat";
import { raiseBudgetAndContinue, setWaitingAside, stopHere } from "@/server/actions/run";
import type { ProjectWorkspace, WorkspaceItem } from "@/server/project";
import { ConnectButton } from "./connect-button";
import { KeyAction, partsNeedingKey } from "./key-action";
import { BuildLoader } from "@/components/ax/BuildLoader";
import { loaderRoles } from "@/lib/brand";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** How a part shows in the Plan panel after Build (DATA-MODEL "Item statuses"). */
export function rowFor(i: WorkspaceItem): { status: Status; icon?: StatusIcon; detail?: string; struck?: boolean } {
  switch (i.status) {
    case "built":
      return { status: "works", detail: i.statusDetail ?? undefined };
    case "sample_data":
      return { status: "works", detail: "using sample data" };
    case "building":
      // A coding agent's change waiting for the checker (F4), or a code edit's check running again, says so.
      return { status: "building", detail: i.statusDetail?.startsWith("Waiting for its check") || i.statusDetail?.startsWith("Re-running its check") ? i.statusDetail : "Building now" };
    case "failed":
      return { status: "failed", detail: i.statusDetail ?? "A check failed. Fixing it." };
    case "paused":
      return { status: "blocked", icon: "pause", detail: i.statusDetail ?? "Blocked" };
    case "deferred":
      return { status: "todo", icon: "pause", detail: i.statusDetail ?? "Set aside" };
    case "dropped":
      return { status: "todo", icon: "minus", struck: true };
    case "agreed":
      return { status: "todo", detail: i.statusDetail ?? (i.estimate ? `About ${Math.round(i.estimate)} credits` : undefined) };
    case "needs_connection":
      // Skipped from Action needed (M5.8): sample data until its key is added.
      return { status: "todo", icon: "pause", detail: i.statusDetail === WAITING_FOR_KEY ? WAITING_FOR_KEY : "Using sample data until connected" };
    default:
      return { status: "todo" };
  }
}

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const act = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      setError(undefined);
      const r = await fn();
      if (!r.ok) setError(r.message);
      router.refresh();
    });
  return { pending, error, act };
}

/** Plan panel after Build: Needs you → In progress → Works → Up next, or Waiting for budget (screens 3, 6, 7). */
export function BuildPanel({ project, items, budgetPaused }: { project: ProjectWorkspace; items: WorkspaceItem[]; budgetPaused: boolean }) {
  const { partKey, openPart } = useUi();
  const { pending, error } = useAct();
  const canAct = canBuild(project.role);
  // Parts connected in this tab leave Needs you at once, even if a slower page refresh lands later.
  const [connectedHere, setConnectedHere] = useState<Set<string>>(new Set());
  // Sign-in services get Connect; key services get Add key · Skip, the same item as chat's Action needed (M5.8).
  const connect = items.filter((i) => i.status === "needs_connection" && isSignInService(i.provider) && !connectedHere.has(i.id));
  const keys = partsNeedingKey(items);
  const skipped = items.filter((i) => i.status === "needs_connection" && i.statusDetail === WAITING_FOR_KEY);
  const blocked = items.filter((i) => i.status === "paused");
  const approval = items.filter((i) => i.status === "needs_approval");
  const doing = items.filter((i) => i.status === "building" || i.status === "failed");
  const works = items.filter((i) => i.status === "built" || i.status === "sample_data");
  const waiting = budgetPaused ? items.filter((i) => i.status === "agreed") : [];
  const next = [...skipped, ...items.filter((i) => (!budgetPaused && i.status === "agreed") || ["proposed", "deferred", "dropped"].includes(i.status))];
  const needs = blocked.length + connect.length + keys.length + approval.length;
  const row = (i: WorkspaceItem) => <PlanRow key={i.id} title={i.title} {...rowFor(i)} selected={partKey === i.key} onClick={() => openPart(i.key)} />;

  return (
    <>
      {needs > 0 && (
        <PlanGroup title="Needs you" count={needs}>
          {[
            ...blocked.map((i) => (
              <PlanRow key={i.id} status="blocked" icon="pause" title={`${i.title} is blocked`} detail="Stopped after 3 fixes to protect your credits" selected={partKey === i.key} onClick={() => openPart(i.key)} />
            )),
            ...connect.map((i, n) => (
              <NeedsYouCard
                key={i.id}
                status="attention"
                icon="plug"
                name={`Connect ${providerName(i.provider)}`}
                action={
                  <span className="flex flex-wrap items-center gap-2">
                  <ConnectButton
                    itemId={i.id}
                    provider={i.provider}
                    // One primary per screen: a blocked part or the budget banner comes first.
                    variant={n === 0 && blocked.length === 0 && !budgetPaused ? "primary" : "secondary"}
                    disabledReason={!canAct ? "Viewers can't connect accounts." : pending ? "Connecting…" : undefined}
                    onDone={() => setConnectedHere((prev) => new Set(prev).add(i.id))}
                    policy={project.policy}
                  />
                  <SimTag title="Connecting is simulated in this prototype: no real sign-in happens" />
                  </span>
                }
              >
                {i.title} uses sample data until Architect can read yours. Everything else keeps building.
              </NeedsYouCard>
            )),
            ...keys.map((i) => (
              <NeedsYouCard key={i.id} status="attention" icon="lock" name={`Add the ${providerName(i.provider)} key`} action={<KeyAction item={i} project={project} primary={blocked.length === 0 && connect.length === 0 && !budgetPaused} />}>
                {i.title} uses sample data until it has the key. Everything else keeps building.
              </NeedsYouCard>
            )),
            ...approval.map((i) => (
              <NeedsYouCard key={i.id} status="approval" icon="lock" name={`${i.title} is waiting for IT`} action={<TextLink href="/governance/approvals">See the request</TextLink>}>
                An Owner or Admin approves new tools. Everything else keeps building.
              </NeedsYouCard>
            )),
          ]}
        </PlanGroup>
      )}
      {error && (
        <p role="alert" className="mx-3 mb-2 text-small font-semibold text-failed">
          {error}
        </p>
      )}
      {waiting.length > 0 && <PlanGroup title="Waiting for budget" count={waiting.length}>{waiting.map((i) => <PlanRow key={i.id} status="todo" icon="pause" title={i.title} detail={i.estimate ? `About ${Math.round(i.estimate)} credits` : undefined} onClick={() => openPart(i.key)} />)}</PlanGroup>}
      {doing.length > 0 && <PlanGroup title="In progress" count={doing.length}>{doing.map(row)}</PlanGroup>}
      {works.length > 0 && <PlanGroup title="Works" count={works.length} collapseAfter={3}>{works.map(row)}</PlanGroup>}
      {next.length > 0 && <PlanGroup title="Up next" count={next.length}>{next.map(row)}</PlanGroup>}
    </>
  );
}

/** Paused at the budget (screen 7): what's kept, what's needed, what's spent, and three choices. */
export function BudgetBanner({ project, items, live }: { project: ProjectWorkspace; items: WorkspaceItem[]; live: LiveRun }) {
  const { pending, error, act } = useAct();
  const waiting = items.filter((i) => i.status === "agreed");
  const finished = items.filter((i) => i.status === "built" || i.status === "sample_data" || i.status === "needs_connection").length;
  const need = Math.round(waiting.reduce((s, i) => s + (i.estimate ?? 0), 0));
  const budget = project.budgetCredits ?? live.budgetPause?.budget ?? 0;
  const raiseTo = Math.ceil((Math.max(project.spent.total, live.budgetPause?.used ?? 0) + need + 3) / 5) * 5;
  const canRaise = canManageMembers(project.role);
  const canAct = canBuild(project.role);
  return (
    <StageBanner
      kind="paused"
      className="mx-3 mb-3"
      title={`Paused: this project used its ${budget}-credit budget`}
      actions={
        <>
          <Button
            variant={canRaise ? "primary" : "secondary"}
            disabledReason={!canRaise ? "Only Owners and Admins can raise a budget." : pending ? "Starting…" : undefined}
            onClick={() => act(() => raiseBudgetAndContinue({ projectId: project.id, budget: raiseTo }))}
          >
            Raise budget to {raiseTo} and continue
          </Button>
          <Button variant={canRaise ? "secondary" : "primary"} disabledReason={!canAct ? "Viewers can't change the build." : undefined} onClick={() => act(() => setWaitingAside({ projectId: project.id }))}>
            Set the {plural(waiting.length, "part")} aside
          </Button>
          <Button variant="quiet" disabledReason={!canAct ? "Viewers can't change the build." : undefined} onClick={() => act(() => stopHere({ projectId: project.id }))}>
            Stop here
          </Button>
        </>
      }
    >
      The {plural(finished, "finished part")} are kept and working. The {waiting.length} left need about <b className="text-ink">{need}</b> credits. Nothing more is spent until you choose.
      You have {project.creditsLeft.toLocaleString("en-US")} credits in your plan.
      {error && (
        <span role="alert" className="mt-1 block font-semibold text-failed">
          {error}
        </span>
      )}
    </StageBanner>
  );
}

/** "Test the app": runs every check plus a browser pass over the preview (simulated). */
export function TestTheApp({ items }: { items: WorkspaceItem[] }) {
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const works = items.filter((i) => i.status === "built" || i.status === "sample_data" || i.status === "needs_connection").length;
  const failing = items.filter((i) => i.status === "failed" || i.status === "paused").length;
  return (
    <span className="flex items-center gap-2">
      {state === "done" && (
        <span role="status" className="text-small text-ink-2">
          {failing ? `${works} checks pass · ${plural(failing, "check")} failing` : `All ${works} checks pass · browser pass: no problems`}
        </span>
      )}
      <Button
        size="sm"
        icon="play"
        disabledReason={state === "running" ? "Testing…" : works === 0 ? "Nothing is built yet." : undefined}
        onClick={() => {
          setState("running");
          setTimeout(() => setState("done"), 1800);
        }}
      >
        {state === "running" ? "Testing…" : "Test the app"}
      </Button>
    </span>
  );
}

/** The Dark view of an app with no dark theme (M5.8): it says so, and "Add to plan" makes the change card in chat. */
function NoDarkTheme({ project }: { project: ProjectWorkspace }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const canAct = canBuild(project.role);
  return (
    <div role="status" className="absolute top-[58px] left-1/2 z-10 flex max-w-[calc(100%-24px)] -translate-x-1/2 flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-line bg-surface py-1 pr-1 pl-3.5 text-small shadow-pop">
      <span>{error ?? "This app has no dark theme yet"}</span>
      <Button
        size="sm"
        disabledReason={!canAct ? "Viewers can't change the plan." : pending ? "Adding…" : undefined}
        onClick={() =>
          start(async () => {
            setError(undefined);
            const r = await proposeDarkTheme({ projectId: project.id });
            if (!r.ok) setError(r.message);
            router.refresh();
          })
        }
      >
        {pending ? "Adding…" : "Add to plan"}
      </Button>
    </div>
  );
}

/**
 * The preview's size and Light / Dark view (M5.8), in the project header's middle zone beside the tabs. The scheme
 * is remembered per project; it colours the app's preview only, whatever Architect's theme is.
 */
export function PreviewControls({ projectId }: { projectId: string }) {
  const { previewSize, setPreviewSize } = useUi();
  const [scheme, setScheme] = usePreviewScheme(projectId);
  const btn = "grid size-8 place-items-center rounded-full text-ink-2 hover:text-ink aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-[0_1px_2px_rgba(0,0,0,.08)]";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span role="group" aria-label="Preview size" className="inline-flex gap-0.5 rounded-full bg-selected p-[3px]">
        <button type="button" aria-label="Desktop size" title="Desktop size" aria-pressed={previewSize === "desktop"} onClick={() => setPreviewSize("desktop")} className={btn}>
          <Icon name="desktop" size="sm" />
        </button>
        <button type="button" aria-label="Phone size" title="Phone size" aria-pressed={previewSize === "phone"} onClick={() => setPreviewSize("phone")} className={btn}>
          <Icon name="phone" size="sm" />
        </button>
      </span>
      <span role="group" aria-label="Preview colours" className="inline-flex gap-0.5 rounded-full bg-selected p-[3px]">
        <button type="button" aria-label="Light view of the app" title="Light view of the app" aria-pressed={scheme === "light"} onClick={() => setScheme("light")} className={btn}>
          <Icon name="sun" size="sm" />
        </button>
        <button type="button" aria-label="Dark view of the app" title="Dark view of the app" aria-pressed={scheme === "dark"} onClick={() => setScheme("dark")} className={btn}>
          <Icon name="moon" size="sm" />
        </button>
      </span>
    </span>
  );
}

/** The app in its Test version, with the dock: sizes, Point at something, N problems (BL-6). */
/** The loader's line under the shape: "Build 2/6 · Building Talking points generator" (Geist Mono). */
export function buildProgressLine(live: Pick<LiveRun, "done" | "total" | "activity">, parts = 0): string {
  const last = live.activity.at(-1);
  const now = last ? `${last.verb} ${last.object}`.trim() : "Starting";
  // Before the run's first event, its total isn't known yet: the plan's part count stands in.
  const total = live.total || parts;
  return total ? `Build ${Math.min(live.done + 1, total)}/${total} · ${now}` : now;
}

export function AppPreview({ project, items, live }: { project: ProjectWorkspace; items: WorkspaceItem[]; live?: LiveRun }) {
  const { partKey, openPart, sendToChat } = useUi();
  // The size and the Light / Dark view are switched in the project header (M5.8), beside the tabs.
  const size = useUi((s) => s.previewSize);
  const frame = useRef<HTMLIFrameElement>(null);
  const [pointing, setPointing] = useState(false);
  const [console_, setConsole] = useState(false);
  const preview = previewState(items, project.connected, { name: project.name });
  const selected = items.find((i) => i.key === partKey);
  const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const post = (m: Record<string, unknown>) => frame.current?.contentWindow?.postMessage(m, window.location.origin);
  // The selected part is outlined in the app, never isolated.
  // Keyed on what's shown, not the part object (rebuilt on every tick of the build's clock).
  const section = selected ? preview.highlight(selected) : null;
  const label = selected?.title;
  useEffect(() => {
    post({ type: "highlight", part: section, label });
  }, [section, label]);
  useEffect(() => post({ type: "point", on: pointing }), [pointing]);
  // Look and feel (Plan › Design): the chosen theme, sent to the preview as CSS variables. The Light / Dark view
  // (M5.8) picks its light or dark variables; an app without a dark theme stays light, with a note saying so.
  const theme = themeOf(project.look);
  const [scheme] = usePreviewScheme(project.id);
  const dark = hasDarkTheme(theme.id, items);
  const shown = scheme === "dark" && dark ? "dark" : "light";
  const vars = previewVars(theme.id, shown);
  const themeMessage = { type: "theme", id: theme.id, vars, scheme: shown };
  const themeKey = JSON.stringify(themeMessage);
  useEffect(() => post(JSON.parse(themeKey)), [themeKey]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== "select") return;
      sendToChat(`About “${e.data.text}” in the app: `);
      setPointing(false);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [sendToChat]);

  return (
    <PreviewFrame
      url={`${slug}--test.architect.space/today`}
      badge={<SimTag title={preview.kind === "shell" ? "The preview is a stand-in shell showing this plan's parts" : "The preview is a pre-built sample app in this prototype"} />}
      dock={
        <>
          {console_ && preview.problems.length > 0 && (
            <div role="dialog" aria-label="Problems" className="absolute right-3 bottom-[70px] left-3 mx-auto flex max-w-[560px] flex-col gap-2 rounded-card border border-line bg-surface p-3 shadow-pop">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{plural(preview.problems.length, "problem")}</h3>
                <TextLink onClick={() => setConsole(false)}>Close</TextLink>
              </div>
              {preview.problems.map((p) => (
                <div key={p.key} className="flex flex-wrap items-start gap-2 rounded-tile border border-line px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <b>{p.title}</b>
                    <span className="block text-small text-ink-2">{p.text}</span>
                  </span>
                  <TextLink onClick={() => openPart(p.key)}>Open</TextLink>
                  <Button
                    size="sm"
                    onClick={() => {
                      sendToChat(`Fix ${p.title}: ${p.text}`);
                      setConsole(false);
                    }}
                  >
                    Fix with AI
                  </Button>
                </div>
              ))}
            </div>
          )}
          {scheme === "dark" && !dark && <NoDarkTheme project={project} />}
          <PreviewDock pointing={pointing} onPointToggle={() => setPointing((p) => !p)} problems={preview.problems.length} onOpenProblems={() => setConsole((c) => !c)} />
        </>
      }
    >
      {live?.playing && preview.reveal.length === 0 ? (
        // Nothing to show yet while the build runs: the brand loader and where the build is (Soft Tray v4).
        <div className="grid h-full place-items-center bg-surface p-8">
          <BuildLoader step={buildProgressLine(live, items.filter((i) => i.status !== "dropped" && i.status !== "deferred").length)} roles={loaderRoles(items)} seed={project.id}>
            <p className="text-ink-2">The app appears here, section by section, as its parts start to work.</p>
          </BuildLoader>
        </div>
      ) : preview.kind === "meeting-prep" && preview.reveal.length === 0 ? (
        <div className="grid h-full place-items-center bg-surface p-8 text-center text-ink-2">
          <p>The app appears here, section by section, as its parts start to work.</p>
        </div>
      ) : (
        <iframe
          ref={frame}
          title={`${project.name}, test version`}
          src={preview.src}
          onLoad={() => {
            post(themeMessage);
            post({ type: "point", on: pointing });
            if (selected) post({ type: "highlight", part: preview.highlight(selected), label: selected.title });
          }}
          className={size === "phone" ? "mx-auto block h-full w-[390px] border-x border-line" : "block h-full w-full"}
        />
      )}
    </PreviewFrame>
  );
}

/** The build's steps by part, in the order each part started; steps without a part ("Setting up") come first. */
function stepGroups(activity: LiveRun["activity"], items: WorkspaceItem[]) {
  const groups = new Map<string, { key: string; title: string; lines: LiveRun["activity"] }>();
  for (const a of activity) {
    const key = a.itemKey ?? "_setup";
    if (!groups.has(key)) groups.set(key, { key, title: a.itemKey ? (items.find((i) => i.key === a.itemKey)?.title ?? a.itemKey.replace(/-/g, " ")) : "Setting up", lines: [] });
    groups.get(key)!.lines.push(a);
  }
  return [...groups.values()];
}

function StepGroup({ title, lines }: { title: string; lines: { id: number; at: string; verb: string; object: string }[] }) {
  const [open, setOpen] = useState(false);
  const last = lines[lines.length - 1];
  return (
    <li>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-h-7 w-full items-center gap-1.5 text-left hover:text-ink">
        <Icon name={open ? "chevronDown" : "chevronRight"} size="sm" className="text-ink-3" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold">{title}</span>
          <span className="text-ink-2">
            {" "}
            · {last.verb} {last.object}
          </span>
        </span>
        <span className="flex-none text-ink-3 tabular-nums">{lines.length}</span>
      </button>
      {open && (
        <ol className="mb-1 ml-[22px] flex flex-col gap-0.5">
          {lines.map((a) => (
            <li key={a.id}>
              <span className="text-ink-3">{a.at} · </span>
              <span className="font-semibold">{a.verb}</span> <span className={/[/.]/.test(a.object) ? "font-mono" : undefined}>{a.object}</span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

/** What Architect is doing, in chat: a short summary, then the steps behind it (screen 3). */
export function BuildActivity({ project, items, live }: { project: ProjectWorkspace; items: WorkspaceItem[]; live: LiveRun }) {
  const [open, setOpen] = useState(false);
  const run = project.run;
  if (!run || !run.startedAt) return null;
  const counted = items.filter((i) => i.status !== "deferred" && i.status !== "dropped");
  const works = counted.filter((i) => i.status === "built" || i.status === "sample_data").length;
  const connect = counted.filter((i) => i.status === "needs_connection");
  const approval = counted.filter((i) => i.status === "needs_approval");
  const blocked = counted.filter((i) => i.status === "paused");
  const pause = run.status === "paused_budget" || run.status === "running" ? live.budgetPause : null;
  // Until the run settles its credits aren't in Usage yet; show what the run has used so far.
  const unsettled = run.status === "running";
  const build = project.spent.build + (unsettled ? live.spent - live.fixSpent : 0);
  const fix = project.spent.fix + (unsettled ? live.fixSpent : 0);

  const sentences: string[] = [];
  if (live.playing && !pause) sentences.push(`Building your app. ${works} of ${counted.length} parts already work.`);
  else if (pause) sentences.push(`I've paused at your ${project.budgetCredits ?? pause.budget}-credit budget. The ${plural(counted.filter((i) => i.status === "agreed").length, "part")} left should cost about ${pause.remainingEst} credits.`);
  else sentences.push(`${run.kind === "change" ? "The change is built" : "Build finished"}. ${works} of ${counted.length} parts work.`);
  if (blocked.length) sentences.push(`${blocked[0].title} is blocked after 3 fixes. Open it to see what I suggest.`);
  if (connect.length)
    sentences.push(
      isSignInService(connect[0].provider)
        ? `I need you for one thing: connect ${providerName(connect[0].provider)} so ${connect[0].title.toLowerCase()} uses your real data.`
        : `I need you for one thing: the ${providerName(connect[0].provider)} key, so ${connect[0].title.toLowerCase()} uses your real data.`,
    );
  if (approval.length) sentences.push(`${providerName(approval[0].provider)} is waiting for IT, and nothing else is blocked by it.`);

  return (
    <ArchitectMessage time={chatTime(run.startedAt)}>
      <p>{sentences.join(" ")}</p>
      {pause && (
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-card border border-line px-3.5 py-3 text-small tabular-nums">
          <dt className="text-ink-2">Finished parts</dt>
          <dd className="text-right">{Math.round(build)} cr</dd>
          <dt className="text-ink-2">Fixes</dt>
          <dd className="text-right">{Math.round(fix)} cr</dd>
          <dt className="border-t border-line pt-1 font-semibold">Spent</dt>
          <dd className="border-t border-line pt-1 text-right font-semibold">{Math.round(build + fix)} cr</dd>
          <dt className="text-ink-2">Still to build</dt>
          <dd className="text-right">~{pause.remainingEst} cr</dd>
        </dl>
      )}
      {live.activity.length > 0 && (
        <>
          <TextLink className="self-start" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? "Hide the steps" : `Show what I did (${plural(live.activity.length, "step")})`}
          </TextLink>
          {/* Each part's progress lines fold into one line that expands (M5.8). */}
          {open && (
            <ol aria-label="Steps by part" className="flex flex-col gap-0.5 border-l-2 border-line pl-3 text-small">
              {stepGroups(live.activity, items).map((g) => (
                <StepGroup key={g.key} title={g.title} lines={g.lines.map((a) => ({ id: a.id, at: run.startedAt ? time(new Date(new Date(run.startedAt).getTime() + a.atMs).toISOString()) : "", verb: a.verb, object: a.object }))} />
              ))}
            </ol>
          )}
        </>
      )}
    </ArchitectMessage>
  );
}
