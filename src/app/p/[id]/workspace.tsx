"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Button, IconButton, TextLink } from "@/components/ax/button";
import { EmptyState } from "@/components/ax/empty-state";
import { Icon } from "@/components/ax/icon";
import { IconTile } from "@/components/ax/list-row";
import { NeedsYouCard } from "@/components/ax/needs-you-card";
import { SimTag } from "@/components/ax/pill";
import { PlanGroup, PlanPanel, PlanRow } from "@/components/ax/plan-panel";
import { Segmented } from "@/components/ax/segmented";
import { Stepper } from "@/components/ax/stepper";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { missingForLive } from "@/lib/keys";
import { BUDGET_STOPPED } from "@/lib/policies";
import { MODEL_LABEL, type ModelChoice } from "@/lib/models";
import { canBuild, canManageMembers } from "@/lib/permissions";
import { relativeTime } from "@/lib/project-status";
import { etaWords, withLive, type LiveRun } from "@/lib/sim/replay";
import { useUi } from "@/lib/ui-store";
import { workspaceState } from "@/lib/workspace-state";
import { launchState } from "@/lib/launch";
import { goLive, shareWithTeam } from "@/server/actions/launch";
import { buildPlan, setProjectModel } from "@/server/actions/plan";
import { settleEdits } from "@/server/actions/dev";
import { duplicateProject } from "@/server/actions/projects";
import type { ProjectWorkspace, WorkspaceItem } from "@/server/project";
import { AgentSessionLines, useAgentSession, withSession } from "./agent-session";
import { AgentsPlanPanel, AgentsView } from "./agents-view";
import { CodeEditCard } from "./code-edit-card";
import { DataView } from "./data-view";
import { OrgBudgetBanner } from "@/components/ax/org-budget-banner";
import { CodeView, DevActivity, downloadCode, PrStatus, TerminalView } from "./dev-view";
import { HandoffBanner, TransferDialog } from "./handoff";
import { SyncBanner } from "./pr-card";
import { AppPreview, BudgetBanner, BuildActivity, BuildPanel, TestTheApp } from "./build-stage";
import { ChatPane } from "./chat-pane";
import { PartDrawer } from "./part-drawer";
import { LaunchView } from "./launch-view";
import { useRun } from "./use-run";
import { fromStreamed, GROUP_LABEL, GROUP_ORDER, PlanDocument } from "./plan-document";
import { usePlanWriter } from "./use-plan-writer";

type View = "app" | "agents" | "data" | "files" | "code" | "terminal";
const VIEWS: View[] = ["app", "agents", "data", "files"];
/** Developer view (?dev=1, screen 8) adds Code and Terminal, and opens on Code. */
const DEV_VIEWS: View[] = [...VIEWS, "code", "terminal"];

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

/** Plan panel contents before Build: what needs the person, then the plan in groups (screen 2). */
function PlanStagePanel({ project, items, writing, failed }: { project: ProjectWorkspace; items: WorkspaceItem[]; writing: boolean; failed: boolean }) {
  const plan = project.plan;
  if (writing || failed || !plan || plan.generation !== "ready") {
    return items.length ? (
      <PlanGroup title="Written so far" count={items.length}>
        {items.map((i) => (
          <PlanRow key={i.key} status="todo" title={i.title} onClick={() => scrollTo(`part-${i.key}`)} />
        ))}
      </PlanGroup>
    ) : (
      <div className="mx-2.5 rounded-card border border-line bg-surface p-4 text-small text-ink-2">
        {writing ? "The parts appear here as Architect writes them." : "The plan appears here: every part of the app, how Architect checks it works, and what it costs."}
      </div>
    );
  }
  const open = plan.questions.filter((q) => q.blocking && !q.answer);
  const groups = GROUP_ORDER.filter((g) => items.some((i) => i.grp === g));
  const choices = plan.defaults.length + plan.questions.filter((q) => !q.blocking && !q.answer).length;
  return (
    <>
      {open.length > 0 && (
        <PlanGroup title="Needs you" count={open.length}>
          {open.map((q) => (
            <NeedsYouCard key={q.id} status="attention" name={q.text} action={<TextLink onClick={() => scrollTo("plan-top")}>Answer it</TextLink>}>
              Answer to unlock Build.
            </NeedsYouCard>
          ))}
        </PlanGroup>
      )}
      <PlanGroup title="In this plan" count={`${items.length} parts`}>
        {[
          ...groups.map((g) => {
            const inGroup = items.filter((i) => i.grp === g);
            const providers = Array.from(new Set(inGroup.map((i) => i.provider).filter(Boolean))) as string[];
            const detail = g === "integrations" && providers.length ? providers.map((p) => p.replace(/_/g, " ")).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(", ") : g === "agents" ? inGroup.map((i) => i.title).join(", ") : `${inGroup.length} ${inGroup.length === 1 ? "part" : "parts"}`;
            return <PlanRow key={g} status="todo" title={GROUP_LABEL[g]} detail={detail} onClick={() => scrollTo(`group-${g}`)} />;
          }),
          ...(choices ? [<PlanRow key="choices" status="todo" title="Choices I made for you" detail={`${choices} you can change`} onClick={() => scrollTo("group-defaults")} />] : []),
          ...(plan.notInThisVersion.length
            ? [<PlanRow key="left" status="todo" title="Left out for now" detail={`${plan.notInThisVersion.length} ${plan.notInThisVersion.length === 1 ? "thing" : "things"}, with the reason`} onClick={() => scrollTo("group-left-out")} />]
            : []),
        ]}
      </PlanGroup>
    </>
  );
}

function StageBody({
  view,
  project,
  planDocument,
  items,
  live,
  budgetPaused,
}: {
  view: View;
  project: ProjectWorkspace;
  planDocument: ReactNode;
  items: WorkspaceItem[];
  live: LiveRun;
  budgetPaused: boolean;
}) {
  if (view === "files") return planDocument;
  if (view === "agents") return <AgentsView project={project} items={items} />;
  if (view === "code") return <CodeView project={project} items={items} live={live} />;
  if (view === "terminal") return <TerminalView project={project} items={items} live={live} />;
  if (view === "data") return <DataView project={project} items={items} />;
  if (project.runStatus === "queued") {
    return (
      <EmptyState icon="window" title="Starting your build">
        The plan is agreed and saved as v{project.plan?.version ?? 1}. Architect is about to build it, part by part, with a check for each.
      </EmptyState>
    );
  }
  return (
    <>
      {budgetPaused && <BudgetBanner project={project} items={items} live={live} />}
      <AppPreview project={project} items={items} />
    </>
  );
}

function Rail({ label, icon, onOpen }: { label: string; icon: "panelLeft" | "panelRight"; onOpen: () => void }) {
  return (
    <aside aria-label={label} className="flex w-14 flex-none flex-col items-center rounded-pane border border-line bg-tray py-3 shadow-pane max-md:hidden">
      <IconButton icon={icon} label={`Open ${label.toLowerCase()}`} quiet onClick={onOpen} />
    </aside>
  );
}

function MoreMenu({ project, items, canAct, dev, onToggleDev, onTransfer }: { project: ProjectWorkspace; items: WorkspaceItem[]; canAct: boolean; dev: boolean; onToggleDev: () => void; onTransfer: () => void }) {
  const router = useRouter();
  const [, start] = useTransition();
  const item = "flex min-h-10 items-center gap-2.5 rounded-tile px-2.5";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="More for this project" className="grid size-[38px] place-items-center rounded-full border border-line-ctl bg-surface hover:bg-selected">
        <Icon name="more" size="sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 rounded-card border border-line bg-surface p-1.5 shadow-pop">
        <DropdownMenuItem className={item} onSelect={onToggleDev}>
          {dev ? "Leave Developer view" : "Developer view"}
        </DropdownMenuItem>
        <DropdownMenuItem
          className={item}
          disabled={!canAct}
          title={canAct ? undefined : "Viewers can't duplicate projects."}
          onSelect={() =>
            start(async () => {
              const r = await duplicateProject({ projectId: project.id });
              if (r.ok) router.push(`/p/${r.projectId}`);
            })
          }
        >
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem className={item} onSelect={() => downloadCode(project, items)}>
          <span className="flex-1">{project.repo ? "Download code from GitHub" : "Download code"}</span>
          {!project.repo && <SimTag title="Architect's code is simulated in this prototype; the .zip says so." />}
        </DropdownMenuItem>
        <DropdownMenuItem className={item} onSelect={() => (project.repo ? window.open(`https://github.com/${project.repo}`, "_blank", "noopener") : router.push("/settings#github"))}>
          {project.repo ? `GitHub · ${project.repo}` : "GitHub settings"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className={item}
          disabled={!project.handoff.canTransfer}
          title={project.handoff.canTransfer ? undefined : "Only the project's owner, or an Owner or Admin, can hand it over."}
          onSelect={onTransfer}
        >
          Transfer ownership…
        </DropdownMenuItem>
        <DropdownMenuItem className={item} onSelect={() => router.push(`/p/${project.id}/settings`)}>
          Project settings
        </DropdownMenuItem>
        <DropdownMenuItem className={item} onSelect={() => router.push("/settings")}>
          Workspace settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Share: copy a version's address, or open Launch to share with the team and go live. */
function ShareMenu({ project }: { project: ProjectWorkspace }) {
  const router = useRouter();
  const [copied, setCopied] = useState<string | null>(null);
  const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";
  const built = project.status === "built" || project.status === "live";
  const item = "flex min-h-10 items-center gap-2.5 rounded-tile px-2.5";
  const copy = (label: string, url: string) => {
    void navigator.clipboard?.writeText(`https://${url}`);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };
  if (project.status === "draft") return <Button disabledReason="Build the plan first. Then you can share a test version.">Share</Button>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex min-h-[38px] items-center rounded-full border border-line-ctl bg-surface px-4 font-[550] hover:bg-selected">{copied ? "Copied" : "Share"}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 rounded-card border border-line bg-surface p-1.5 shadow-pop">
        <DropdownMenuItem className={item} onSelect={() => copy("test", `${slug}--test.architect.space`)}>
          <Icon name="copy" size="sm" />
          <span className="flex-1">Copy the test version link</span>
          <SimTag />
        </DropdownMenuItem>
        {project.status === "live" && (
          <DropdownMenuItem className={item} onSelect={() => copy("live", `${slug}.architect.app`)}>
            <Icon name="copy" size="sm" />
            <span className="flex-1">Copy the live link</span>
            <SimTag />
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem className={item} disabled={!built} title={built ? undefined : "Launch opens when the build finishes."} onSelect={() => router.push(`/p/${project.id}/launch`)}>
          Share with your team or go live…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The project workspace: header on the canvas, Plan panel, stage, Chat (BUILD-SPEC §2, screens 2, 3, 16). */
export function Workspace({ project, page = "workspace" }: { project: ProjectWorkspace; page?: "workspace" | "launch" }) {
  const onLaunch = page === "launch" && project.launch !== null;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openHelp = useUi((s) => s.openHelp);
  const sendToChat = useUi((s) => s.sendToChat);
  const agentChanges = useUi((s) => s.agentChanges);
  const agentOpen = useUi((s) => s.agentKey !== null);
  const raw = params.get("view");
  const planStage = project.status === "draft";
  const dev = params.get("dev") === "1";
  const allowed: View[] = dev ? (planStage ? ["files", "code", "terminal"] : DEV_VIEWS) : VIEWS;
  const view: View = allowed.includes(raw as View) ? (raw as View) : dev ? "code" : "app";
  const fullWidth = onLaunch || (!planStage && view !== "app");
  const [planOpen, setPlanOpen] = useState<boolean | null>(null);
  const [chatOpen, setChatOpen] = useState<boolean | null>(null);
  // Launch keeps the plan open and folds chat to a rail (screen 4).
  // Agents keeps the plan open too, listing the agents and the apps they connect to (screen 9).
  const showPlan = planOpen ?? (onLaunch || !fullWidth || (!planStage && view === "agents") || dev);
  const showChat = chatOpen ?? (!fullWidth || (dev && !onLaunch));
  const canAct = canBuild(project.role);

  const writingId = project.plan?.generation === "writing" ? project.plan.id : null;
  const { state: writer, write } = usePlanWriter({ projectId: project.id, writingBlueprintId: writingId });
  const writingNow = writer.phase === "writing";
  const writing = writingNow || project.plan?.generation === "writing";
  const failed = writer.phase === "failed" || (!writingNow && project.plan?.generation === "failed");

  // Write the plan once, straight after Write the plan on Home (the project has a request but no plan yet).
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !planStage || project.plan || !project.prompt || !canAct || writer.phase !== "idle") return;
    autoStarted.current = true;
    void write();
  }, [planStage, project.plan, project.prompt, canAct, writer.phase, write]);

  const [modelAsk, setModelAsk] = useState<ModelChoice | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [pending, start] = useTransition();
  const [actionError, setActionError] = useState<string>();

  const switchModel = (m: ModelChoice, thenWrite: boolean) =>
    start(async () => {
      const r = await setProjectModel({ projectId: project.id, model: m });
      if (!r.ok) return setActionError(r.message);
      router.refresh();
      if (thenWrite) void write({ model: m });
    });

  // The picker's label (a registered private model goes by its own name).
  const modelName = (m: ModelChoice) => project.models.find((o) => o.choice === m)?.label ?? MODEL_LABEL[m];

  // A code edit's re-run check (simulated) finishes after a few seconds: settle it then, without a reload.
  const recheckRunning = project.codeEdits.edits.some((e) => e.check === "running");
  useEffect(() => {
    if (!recheckRunning) return;
    const t = setTimeout(() => void settleEdits({ projectId: project.id }).then(() => router.refresh()), 6500);
    return () => clearTimeout(t);
  }, [recheckRunning, project.id, router]);

  // The build as it plays: the run's events replayed on the clock, laid over the saved parts.
  const live = useRun(project.id, project.run, project.serverNow);
  const running = project.run?.status === "running";
  const builtItems = withLive(project.items, live, running).map((i) =>
    // Connected while the build plays: it works with real data (settling agrees).
    i.status === "needs_connection" && i.provider && project.connected.includes(i.provider) ? { ...i, status: "built", statusDetail: null } : i,
  );
  // ?sim=byoagent (F4): a coding agent's scripted session; its changed part waits for its check.
  const agentSession = useAgentSession(project, builtItems, params.get("sim") === "byoagent");
  const items = withSession(builtItems, agentSession);

  // Projects › ⋯ › Download code opens the project with ?download=1: download once, then drop the parameter.
  const wantsDownload = params.get("download") === "1";
  useEffect(() => {
    if (!wantsDownload) return;
    downloadCode(project, items);
    router.replace(pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per visit
  }, [wantsDownload]);

  const counted = items.filter((i) => i.status !== "deferred" && i.status !== "dropped");
  const worksNow = counted.filter((i) => i.status === "built" || i.status === "sample_data").length;
  const budgetPaused = Boolean(live.budgetPause) && (running || (project.status === "paused" && project.run?.status === "paused_budget" && items.some((i) => i.status === "agreed")));

  const blockingOpen = project.plan?.questions.filter((q) => q.blocking && !q.answer).length ?? 0;
  const launch = onLaunch
    ? launchState({
        parts: items.map((i) => ({ id: i.id, key: i.key, title: i.title, status: i.status, provider: i.provider, estimate: i.estimate })),
        deployments: project.launch!.deployments,
        envLive: project.launch!.envLive,
        currentVersion: project.plan?.version ?? 1,
        role: project.role,
        governance: project.launch!.governance,
        liveRequested: project.launch!.liveRequested,
        liveDecisions: project.launch!.liveDecisions,
        liveRule: project.launch!.liveRule,
        flows: project.launch!.flows,
        deployNeedsApproval: project.policy.permissions.deploy,
        keysMissingForLive: missingForLive(project.launch!.keys),
        testsPassed: project.launch!.testsPassed,
        repo: project.repo
          ? { prNumber: project.pullRequests[0]?.number ?? null, branch: project.pullRequests[0]?.branch ?? null, merged: project.pullRequests[0]?.status === "merged" }
          : null,
      })
    : null;

  const baseState = workspaceState({
    status: project.status,
    role: project.role,
    summary: project.summary,
    plan: project.plan ? { generation: project.plan.generation, blockingOpen, total: project.plan.totals.likely, parts: project.items.length, agreed: Boolean(project.plan.agreedAt) } : null,
    writingNow,
    runStatus: project.runStatus,
    creditsLeft: project.creditsLeft,
    build: project.run
      ? { works: worksNow, total: counted.length, blocked: counted.filter((i) => i.status === "paused").length, eta: etaWords(live.etaSeconds), playing: live.playing, budgetPaused }
      : undefined,
  });
  // On Launch the stage action is Share with your team, disabled until the checklist is clear (BUILD-SPEC §2).
  // Without governance it's Go live (the team version is optional); with it, Share first, then Go live.
  const launchAction = launch ? (launch.fast || launch.team.current ? { ...launch.goLive, kind: "live" as const } : { ...launch.share, kind: "share" as const }) : null;
  const stageState = launch
    ? { stage: "launch" as const, progress: launch.progress, paused: false, action: { label: launchAction!.label, disabledReason: launchAction!.disabledReason, beside: undefined } }
    : baseState;
  // Unsaved agent settings come first: the stage action waits for Save or Discard (screen 9).
  const agentsWaiting = !planStage && !onLaunch && view === "agents" && agentChanges > 0;
  const agentsState = agentsWaiting ? { ...stageState, action: { ...stageState.action, disabledReason: "Save or discard your agent changes first." } } : stageState;
  // The organisation's monthly cap (C-7): at 100%, Build and the other paid actions stop until an admin raises it.
  const state =
    !launch && project.policy.budget.level === "stopped" && !agentsState.action.disabledReason ? { ...agentsState, action: { ...agentsState.action, disabledReason: BUDGET_STOPPED } } : agentsState;

  const toggleDev = () => {
    const next = new URLSearchParams(params);
    if (dev) {
      next.delete("dev");
      if (next.get("view") === "code" || next.get("view") === "terminal") next.delete("view");
    } else next.set("dev", "1");
    router.replace(`/p/${project.id}${next.size ? `?${next}` : ""}`, { scroll: false });
  };
  const setView = (v: View) => {
    const next = new URLSearchParams(params);
    if (v === "app" && !dev) next.delete("view");
    else next.set("view", v);
    setPlanOpen(null);
    setChatOpen(null);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  const streamedItems = writer.phase !== "idle" && writer.items.length && (writing || writer.phase === "failed") ? writer.items.map(fromStreamed) : project.items;
  const editReason = !canAct ? "Viewers can't change the plan." : project.plan?.agreedAt ? "This version is agreed. Ask for changes in chat." : undefined;
  const planDocument = (
    <div id="plan-top">
      <PlanDocument
        project={project}
        writer={writer}
        editReason={editReason}
        onRetry={() => void write()}
        onSwitchModel={(m) => switchModel(m, true)}
        onEditRequest={(prompt) => void write({ prompt })}
      />
    </div>
  );

  const versionLabel = writing ? "writing" : failed ? "unfinished" : project.plan ? (project.plan.agreedAt ? "agreed" : "draft") : undefined;
  const planPanel: ReactNode = showPlan ? (
    <PlanPanel
      version={project.plan || writing ? `v${project.plan?.version ?? 1}${versionLabel ? ` · ${versionLabel}` : ""}` : undefined}
      intro={planStage && !writing && !failed ? "Read it, change anything in plain words, then click Build. Nothing is built or charged before that." : undefined}
      progress={
        !planStage && counted.length
          ? {
              value: worksNow / counted.length,
              label: `${worksNow} of ${counted.length} parts work · ${Math.round(project.spent.build + project.spent.fix + (running ? live.spent : 0))} of ${
                project.budgetCredits ? `${project.budgetCredits} budget` : `~${Math.round(project.plan?.totals.likely ?? 0)} credits`
              }`,
            }
          : undefined
      }
      onToggleCollapsed={() => setPlanOpen(false)}
    >
      {planStage ? (
        <PlanStagePanel project={project} items={streamedItems} writing={writing} failed={failed} />
      ) : view === "agents" && !onLaunch ? (
        <AgentsPlanPanel project={project} items={items} />
      ) : (
        <BuildPanel project={project} items={items} budgetPaused={budgetPaused} />
      )}
    </PlanPanel>
  ) : (
    <Rail label="Plan" icon="panelLeft" onOpen={() => setPlanOpen(true)} />
  );

  return (
    <div className="flex h-dvh flex-col bg-canvas px-2.5 pb-2.5 max-lg:h-auto max-lg:min-h-dvh">
      <header className="flex min-h-[66px] flex-wrap items-center gap-3 px-1 py-2">
        <Link href="/projects" aria-label="Back to projects" className="grid size-[38px] place-items-center rounded-full hover:bg-selected">
          <Icon name="chevronLeft" size="sm" />
        </Link>
        <div className="flex min-w-0 items-center gap-2.5">
          <IconTile icon={project.icon} dark />
          <div className="flex min-w-0 flex-col leading-tight">
            <h1 className="flex items-center gap-2 truncate text-sub font-semibold">
              {project.name}
              {dev && <span className="rounded-full bg-selected px-2 py-0.5 text-small font-semibold text-ink-2">Developer view</span>}
            </h1>
            <span className="truncate text-small text-ink-2">
              Edited by {project.ownerName} · {relativeTime(project.updatedAt)}
            </span>
          </div>
        </div>
        <Stepper
          current={state.stage}
          progress={state.progress}
          paused={state.paused}
          onSelect={(stage) => {
            if (stage === "launch" && (project.status === "built" || project.status === "live")) router.push(`/p/${project.id}/launch`);
            else if (stage !== "launch" && onLaunch) router.push(`/p/${project.id}`);
          }}
        />
        <div className="flex items-center gap-2">
          <IconButton icon="help" label="Help with this project" onClick={() => openHelp(project.id)} />
          <ShareMenu project={project} />
          <MoreMenu project={project} items={items} canAct={canAct} dev={dev} onToggleDev={toggleDev} onTransfer={() => setTransferOpen(true)} />
          {state.action.beside && <span className="max-w-[190px] text-right text-small leading-tight text-ink-2 max-md:hidden">{state.action.beside}</span>}
          <Button
            // The stage action is the primary only when nothing on screen needs the person first (BUILD-SPEC §2).
            variant={
              (view === "agents" && !onLaunch && (agentOpen || agentsWaiting))
                ? "secondary"
                : launch
                ? launchAction!.disabledReason
                  ? "secondary"
                  : "primary"
                : planStage || (state.stage === "launch" && !items.some((i) => i.status === "needs_connection" || i.status === "paused"))
                  ? "primary"
                  : "secondary"
            }
            disabledReason={pending ? (launch ? "Sharing…" : "Starting the build…") : state.action.disabledReason}
            href={!launch && state.stage === "launch" ? `/p/${project.id}/launch` : undefined}
            onClick={() => {
              if (launch) {
                setActionError(undefined);
                start(async () => {
                  // ?sim=deployfail: the deploy fails at its health check (docs/SIMULATOR.md "Deploys").
                  const sim = params.get("sim") ?? undefined;
                  const r = launchAction!.kind === "share" ? await shareWithTeam({ projectId: project.id, sim }) : await goLive({ projectId: project.id, sim });
                  // A failed deploy shows as its own state on the page (what failed, what's still running), not here.
                  if (!r.ok && !/ failed at the /.test(r.message)) setActionError(r.message);
                  router.refresh();
                });
                return;
              }
              if (!planStage || !project.plan) return;
              setActionError(undefined);
              start(async () => {
                // ?sim=paused, ?sim=budget, ?sim=fast: the demo variants (docs/SIMULATOR.md).
                const r = await buildPlan({ blueprintId: project.plan!.id, sim: params.get("sim") ?? undefined });
                if (!r.ok) setActionError(r.message);
                else router.refresh();
              });
            }}
          >
            {state.action.label}
          </Button>
        </div>
      </header>
      {actionError && (
        <p role="alert" className="mb-2 rounded-card border-[1.5px] border-failed bg-surface px-4 py-2.5 font-semibold text-failed">
          {actionError}
        </p>
      )}

      <OrgBudgetBanner budget={project.policy.budget} isAdmin={canManageMembers(project.role)} canBuild={canAct} />

      <div className="flex min-h-0 flex-1 gap-2.5 max-lg:flex-col">
        {planPanel}
        <section aria-label="Stage" className="flex min-h-[480px] min-w-0 flex-1 flex-col overflow-hidden rounded-pane border border-line bg-surface shadow-pane">
          {launch ? (
            <div className="min-h-0 flex-1 overflow-auto">
              <LaunchView project={project} state={launch} />
            </div>
          ) : (
            <>
          {(!planStage || dev) && (
            <div className="flex flex-wrap items-center gap-2.5 px-3 py-2.5">
              <Segmented
                label="Stage view"
                value={view}
                onChange={setView}
                options={[
                  // Before Build, Developer view shows the plan beside the code (an imported repo's files are real already).
                  ...(planStage
                    ? [{ value: "files" as const, label: "Plan" }]
                    : [
                        { value: "app" as const, label: "App" },
                        { value: "agents" as const, label: "Agents" },
                        { value: "data" as const, label: "Data" },
                        { value: "files" as const, label: "Files" },
                      ]),
                  ...(dev
                    ? [
                        { value: "code" as const, label: "Code" },
                        { value: "terminal" as const, label: "Terminal" },
                      ]
                    : []),
                ]}
              />
              {dev && (
                <span className="ml-auto">
                  <PrStatus project={project} items={items} />
                </span>
              )}
              {view === "app" && (
                <span className="ml-auto flex items-center gap-2">
                  <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line px-2.5 text-small font-[650] text-building">
                    <i className="size-1.5 rounded-full bg-building" aria-hidden="true" />
                    Test version
                  </span>
                  <TestTheApp items={items} />
                </span>
              )}
              {view === "agents" && (
                <span className="ml-auto">
                  <Button
                    size="sm"
                    icon="plus"
                    disabledReason={canAct ? undefined : "Viewers can't change the plan."}
                    onClick={() => {
                      // A new agent is a change to the plan: chat proposes it with its cost, and Apply builds it.
                      setChatOpen(true);
                      sendToChat("Add an agent that ");
                    }}
                  >
                    Add an agent
                  </Button>
                </span>
              )}
            </div>
          )}
          {/* Hand-off (F8): an offer to you, your offer waiting, or what you now own. */}
          <div className={planStage && !dev ? "pt-3" : undefined}>
            <HandoffBanner project={project} items={items} onOpenPlan={() => (planStage ? scrollTo("plan-top") : setView("files"))} />
          </div>
          {/* ?sim=sync: commits landed on main from outside Architect (B-5, Simulated). */}
          {project.repo && params.get("sim") === "sync" && <SyncBanner project={project} items={items} />}
          <div role={planStage && !dev ? undefined : "tabpanel"} aria-label={planStage && !dev ? "The plan" : view} className="flex min-h-0 flex-1 flex-col overflow-auto">
            {planStage && (!dev || view === "files") ? planDocument : <StageBody view={view} project={project} planDocument={planDocument} items={items} live={live} budgetPaused={budgetPaused} />}
          </div>
            </>
          )}
        </section>
        {showChat ? (
          <ChatPane
            project={project}
            writing={writing}
            activity={
              planStage ? null : (
                <>
                  <BuildActivity project={project} items={items} live={live} />
                  <AgentSessionLines project={project} state={agentSession} />
                </>
              )
            }
            title={dev && !planStage ? "Activity" : undefined}
            body={
              dev && !planStage ? (
                <>
                  {/* Edits saved in Developer view, newest first: each re-runs its part's check. */}
                  {[...project.codeEdits.edits].reverse().map((e) => (
                    <CodeEditCard key={`edit-${e.id}`} edit={e} />
                  ))}
                  <AgentSessionLines project={project} state={agentSession} />
                  <DevActivity project={project} items={items} live={live} />
                </>
              ) : undefined
            }
            onCollapse={() => setChatOpen(false)}
            onPickModel={(m) => (project.plan ? setModelAsk(m) : switchModel(m, false))}
          />
        ) : (
          <Rail label="Chat" icon="panelRight" onOpen={() => setChatOpen(true)} />
        )}
      </div>

      {!planStage && <PartDrawer project={project} items={items} />}
      {transferOpen && <TransferDialog project={project} open={transferOpen} onOpenChange={setTransferOpen} />}

      {/* Switching models mid-project asks first (BL-3). */}
      <Dialog open={modelAsk !== null} onOpenChange={(o) => !o && setModelAsk(null)}>
        <DialogContent className="rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[460px]" showCloseButton={false}>
          <DialogTitle className="text-sub font-semibold">Switch this project to {modelAsk ? modelName(modelAsk) : ""}?</DialogTitle>
          <DialogDescription className="text-ink-2">
            Chat answers and new plan versions use {modelAsk ? modelName(modelAsk) : ""} from now on. The plan you have stays as it is, and its prices
            change only when a new version is written.
            {modelAsk && project.models.find((m) => m.choice === modelAsk)?.simulated && " In this prototype it's answered by Gemini."}
          </DialogDescription>
          <DialogFooter className="mt-2 gap-2">
            <Button variant="quiet" onClick={() => setModelAsk(null)}>
              Keep {modelName(project.model)}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const m = modelAsk!;
                setModelAsk(null);
                switchModel(m, false);
              }}
            >
              Switch to {modelAsk ? modelName(modelAsk) : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
