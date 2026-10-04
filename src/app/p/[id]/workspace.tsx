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
import { PreviewFrame } from "@/components/ax/preview-dock";
import { Segmented } from "@/components/ax/segmented";
import type { Status, StatusIcon } from "@/components/ax/status-mark";
import { Stepper } from "@/components/ax/stepper";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MODEL_LABEL, type ModelChoice } from "@/lib/models";
import { canBuild } from "@/lib/permissions";
import { relativeTime } from "@/lib/project-status";
import { useUi } from "@/lib/ui-store";
import { workspaceState } from "@/lib/workspace-state";
import { buildPlan, setProjectModel } from "@/server/actions/plan";
import { duplicateProject } from "@/server/actions/projects";
import type { ProjectWorkspace, WorkspaceItem } from "@/server/project";
import { ChatPane } from "./chat-pane";
import { fromStreamed, GROUP_LABEL, GROUP_ORDER, PlanDocument } from "./plan-document";
import { usePlanWriter } from "./use-plan-writer";

type View = "app" | "agents" | "data" | "files";
const VIEWS: View[] = ["app", "agents", "data", "files"];

/** How a part shows in the Plan panel after Build (DATA-MODEL "Item statuses"). */
function rowFor(i: WorkspaceItem): { status: Status; icon?: StatusIcon; detail?: string; struck?: boolean } {
  switch (i.status) {
    case "built":
      return { status: "works" };
    case "sample_data":
      return { status: "attention", icon: "lines", detail: "using sample data" };
    case "building":
      return { status: "building", detail: "Building now" };
    case "failed":
      return { status: "failed", detail: i.statusDetail ?? "A check failed. Fixing it." };
    case "deferred":
      return { status: "todo", icon: "pause", detail: "Set aside" };
    case "dropped":
      return { status: "todo", icon: "minus", struck: true };
    default:
      return { status: "todo" };
  }
}

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

/** Plan panel contents after Build: Needs you → In progress → Works → Up next. */
function BuildStagePanel({ project }: { project: ProjectWorkspace }) {
  const needs = project.items.filter((i) => ["needs_connection", "needs_approval", "paused"].includes(i.status));
  const doing = project.items.filter((i) => ["building", "failed"].includes(i.status));
  const works = project.items.filter((i) => ["built", "sample_data"].includes(i.status));
  const next = project.items.filter((i) => ["proposed", "agreed", "deferred", "dropped"].includes(i.status));
  return (
    <>
      {needs.length > 0 && (
        <PlanGroup title="Needs you" count={needs.length}>
          {needs.map((i) =>
            i.status === "needs_approval" ? (
              <NeedsYouCard key={i.id} status="approval" icon="lock" name={i.title} action={<TextLink href="/governance/approvals">See the request</TextLink>}>
                {i.statusDetail ?? "Waiting for IT."} Everything else works.
              </NeedsYouCard>
            ) : i.status === "needs_connection" ? (
              <NeedsYouCard key={i.id} status="attention" icon="plug" name={i.title} action={<Button variant="primary" size="sm" href="/connections">Open Connections</Button>}>
                Works with sample data until the app is connected.
              </NeedsYouCard>
            ) : (
              <NeedsYouCard key={i.id} status="blocked" icon="pause" name={i.title}>
                Blocked. {i.statusDetail ?? "It needs a decision."}
              </NeedsYouCard>
            ),
          )}
        </PlanGroup>
      )}
      {doing.length > 0 && (
        <PlanGroup title="In progress" count={doing.length}>
          {doing.map((i) => (
            <PlanRow key={i.id} title={i.title} {...rowFor(i)} />
          ))}
        </PlanGroup>
      )}
      {works.length > 0 && (
        <PlanGroup title="Works" count={works.length} collapseAfter={3}>
          {works.map((i) => (
            <PlanRow key={i.id} title={i.title} {...rowFor(i)} />
          ))}
        </PlanGroup>
      )}
      {next.length > 0 && (
        <PlanGroup title="Up next" count={next.length}>
          {next.map((i) => (
            <PlanRow key={i.id} title={i.title} {...rowFor(i)} />
          ))}
        </PlanGroup>
      )}
    </>
  );
}

function StageBody({ view, project, planDocument }: { view: View; project: ProjectWorkspace; planDocument: ReactNode }) {
  if (view === "files") return planDocument;
  if (view === "agents") {
    const agents = project.items.filter((i) => i.grp === "agents");
    return (
      <EmptyState icon="agent" title={agents.length ? `${agents.length} ${agents.length === 1 ? "agent" : "agents"} in this plan` : "No agents in this plan"}>
        {agents.length ? `${agents.map((a) => a.title).join(", ")}. ` : ""}The agent graph, settings and test runs arrive in M4.
      </EmptyState>
    );
  }
  if (view === "data") {
    return (
      <EmptyState icon="grid" title="No data yet">
        Once the app is built, its tables and sign-in users show here, Test data first. The Data view arrives in M4.
      </EmptyState>
    );
  }
  if (project.runStatus === "queued") {
    return (
      <EmptyState icon="window" title="Your build is queued">
        You clicked Build, so the plan is agreed and saved as v{project.plan?.version ?? 1}. The simulated build that plays it, part by part with
        checks, arrives in M3. Nothing else will start without you.
      </EmptyState>
    );
  }
  return (
    <PreviewFrame
      url={`${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}--test.architect.space`}
      badge={
        <span className="flex items-center gap-2">
          <span className="inline-flex h-6 items-center rounded-full bg-building-bg px-2.5 text-small font-[650] text-building">Test version</span>
          <SimTag />
        </span>
      }
    >
      <EmptyState icon="window" title="The preview arrives with the simulated build">
        The running app shows here, full size, with device sizes and Point at something (M3).
      </EmptyState>
    </PreviewFrame>
  );
}

function Rail({ label, icon, onOpen }: { label: string; icon: "panelLeft" | "panelRight"; onOpen: () => void }) {
  return (
    <aside aria-label={label} className="flex w-14 flex-none flex-col items-center rounded-pane border border-line bg-tray py-3 shadow-pane max-md:hidden">
      <IconButton icon={icon} label={`Open ${label.toLowerCase()}`} quiet onClick={onOpen} />
    </aside>
  );
}

function MoreMenu({ project, canAct }: { project: ProjectWorkspace; canAct: boolean }) {
  const router = useRouter();
  const [, start] = useTransition();
  const item = "flex min-h-10 items-center gap-2.5 rounded-tile px-2.5";
  const later = (label: string, when: string, sim = false) => (
    <DropdownMenuItem className={item} disabled title={`${label} comes in ${when}.`}>
      <span className="flex-1">{label}</span>
      {sim ? <SimTag /> : <span className="text-small text-ink-3">{when}</span>}
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="More for this project" className="grid size-[38px] place-items-center rounded-full border border-line-ctl bg-surface hover:bg-selected">
        <Icon name="more" size="sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 rounded-card border border-line bg-surface p-1.5 shadow-pop">
        {later("Developer view", "M4")}
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
        {later("Download code", "M3", true)}
        {later("GitHub", "M4")}
        <DropdownMenuSeparator />
        <DropdownMenuItem className={item} onSelect={() => router.push("/settings")}>
          Settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The project workspace: header on the canvas, Plan panel, stage, Chat (BUILD-SPEC §2, screens 2, 3, 16). */
export function Workspace({ project }: { project: ProjectWorkspace }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openHelp = useUi((s) => s.openHelp);
  const raw = params.get("view");
  const planStage = project.status === "draft";
  const view: View = VIEWS.includes(raw as View) ? (raw as View) : "app";
  const fullWidth = !planStage && view !== "app";
  const [planOpen, setPlanOpen] = useState<boolean | null>(null);
  const [chatOpen, setChatOpen] = useState<boolean | null>(null);
  const showPlan = planOpen ?? !fullWidth;
  const showChat = chatOpen ?? !fullWidth;
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
  const [pending, start] = useTransition();
  const [actionError, setActionError] = useState<string>();

  const switchModel = (m: ModelChoice, thenWrite: boolean) =>
    start(async () => {
      const r = await setProjectModel({ projectId: project.id, model: m });
      if (!r.ok) return setActionError(r.message);
      router.refresh();
      if (thenWrite) void write({ model: m });
    });

  const blockingOpen = project.plan?.questions.filter((q) => q.blocking && !q.answer).length ?? 0;
  const state = workspaceState({
    status: project.status,
    role: project.role,
    summary: project.summary,
    plan: project.plan ? { generation: project.plan.generation, blockingOpen, total: project.plan.totals.likely, parts: project.items.length, agreed: Boolean(project.plan.agreedAt) } : null,
    writingNow,
    runStatus: project.runStatus,
    creditsLeft: project.creditsLeft,
  });

  const setView = (v: View) => {
    const next = new URLSearchParams(params);
    if (v === "app") next.delete("view");
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
        !planStage && project.summary.total
          ? { value: project.summary.works / project.summary.total, label: `${project.summary.works} of ${project.summary.total} parts work` }
          : undefined
      }
      onToggleCollapsed={() => setPlanOpen(false)}
    >
      {planStage ? <PlanStagePanel project={project} items={streamedItems} writing={writing} failed={failed} /> : <BuildStagePanel project={project} />}
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
            <h1 className="truncate text-sub font-semibold">{project.name}</h1>
            <span className="truncate text-small text-ink-2">
              Edited by {project.ownerName} · {relativeTime(project.updatedAt)}
            </span>
          </div>
        </div>
        <Stepper current={state.stage} progress={state.progress} paused={state.paused} />
        <div className="flex items-center gap-2">
          <IconButton icon="help" label="Help with this project" onClick={() => openHelp(project.id)} />
          <Button disabledReason="Sharing comes with Launch (M3).">Share</Button>
          <MoreMenu project={project} canAct={canAct} />
          {state.action.beside && <span className="max-w-[190px] text-right text-small leading-tight text-ink-2 max-md:hidden">{state.action.beside}</span>}
          <Button
            variant="primary"
            disabledReason={pending ? "Starting the build…" : state.action.disabledReason}
            onClick={() => {
              if (!planStage || !project.plan) return;
              setActionError(undefined);
              start(async () => {
                const r = await buildPlan({ blueprintId: project.plan!.id });
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

      <div className="flex min-h-0 flex-1 gap-2.5 max-lg:flex-col">
        {planPanel}
        <section aria-label="Stage" className="flex min-h-[480px] min-w-0 flex-1 flex-col overflow-hidden rounded-pane border border-line bg-surface shadow-pane">
          {!planStage && (
            <div className="flex items-center gap-2.5 px-3 py-2.5">
              <Segmented
                label="Stage view"
                value={view}
                onChange={setView}
                options={[
                  { value: "app", label: "App" },
                  { value: "agents", label: "Agents" },
                  { value: "data", label: "Data" },
                  { value: "files", label: "Files" },
                ]}
              />
            </div>
          )}
          <div role={planStage ? undefined : "tabpanel"} aria-label={planStage ? "The plan" : view} className="flex min-h-0 flex-1 flex-col overflow-auto">
            {planStage ? planDocument : <StageBody view={view} project={project} planDocument={planDocument} />}
          </div>
        </section>
        {showChat ? (
          <ChatPane project={project} writing={writing} onCollapse={() => setChatOpen(false)} onPickModel={(m) => (project.plan ? setModelAsk(m) : switchModel(m, false))} />
        ) : (
          <Rail label="Chat" icon="panelRight" onOpen={() => setChatOpen(true)} />
        )}
      </div>

      {/* Switching models mid-project asks first (BL-3). */}
      <Dialog open={modelAsk !== null} onOpenChange={(o) => !o && setModelAsk(null)}>
        <DialogContent className="rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[460px]" showCloseButton={false}>
          <DialogTitle className="text-sub font-semibold">Switch this project to {modelAsk ? MODEL_LABEL[modelAsk] : ""}?</DialogTitle>
          <DialogDescription className="text-ink-2">
            Chat answers and new plan versions use {modelAsk ? MODEL_LABEL[modelAsk] : ""} from now on. The plan you have stays as it is, and its prices
            change only when a new version is written.
            {modelAsk && project.models.find((m) => m.choice === modelAsk)?.simulated && " In this prototype it's answered by Gemini."}
          </DialogDescription>
          <DialogFooter className="mt-2 gap-2">
            <Button variant="quiet" onClick={() => setModelAsk(null)}>
              Keep {MODEL_LABEL[project.model]}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const m = modelAsk!;
                setModelAsk(null);
                switchModel(m, false);
              }}
            >
              Switch to {modelAsk ? MODEL_LABEL[modelAsk] : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
