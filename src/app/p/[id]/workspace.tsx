"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Button, IconButton, TextLink } from "@/components/ax/button";
import { EmptyState } from "@/components/ax/empty-state";
import { Icon } from "@/components/ax/icon";
import { BuildLoader } from "@/components/ax/BuildLoader";
import { loaderRoles } from "@/lib/brand";
import { MosaicThumb } from "@/components/ax/MosaicThumb";
import { NeedsYouCard } from "@/components/ax/needs-you-card";
import { SimTag } from "@/components/ax/pill";
import { cn } from "@/lib/utils";
import { PlanGroup, PlanPanel, PlanRow } from "@/components/ax/plan-panel";
import { Segmented } from "@/components/ax/segmented";
import { Stepper } from "@/components/ax/stepper";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials } from "@/components/ax/account-menu";
import { missingForLive } from "@/lib/keys";
import { BUDGET_STOPPED } from "@/lib/policies";
import { AUTO, AUTO_LABEL, AUTO_NOTE, MODEL_LABEL, type ModelPick } from "@/lib/models";
import { canBuild, canManageMembers, ROLE_INFO } from "@/lib/permissions";
import { relativeTime } from "@/lib/project-status";
import { etaWords, withLive, type LiveRun } from "@/lib/sim/replay";
import { whatsNotDone } from "@/lib/readiness";
import { useUi } from "@/lib/ui-store";
import { workspaceState } from "@/lib/workspace-state";
import { launchState } from "@/lib/launch";
import { goLive, shareWithTeam } from "@/server/actions/launch";
import { buildPlan, setProjectModel } from "@/server/actions/plan";
import { settleEdits } from "@/server/actions/dev";
import { deleteProject, duplicateProject } from "@/server/actions/projects";
import type { ProjectWorkspace, WorkspaceItem } from "@/server/project";
import { AgentSessionLines, useAgentSession, withSession } from "./agent-session";
import { AgentsPlanPanel, AgentsView } from "./agents-view";
import { CodeEditCard } from "./code-edit-card";
import { DataView } from "./data-view";
import { OrgBudgetBanner } from "@/components/ax/org-budget-banner";
import { CodeView, DevActivity, downloadCode, PrStatus } from "./dev-view";
import { HandoffBanner, TransferDialog } from "./handoff";
import { SyncBanner } from "./pr-card";
import { AppPreview, buildProgressLine, BudgetBanner, BuildActivity, BuildPanel, PreviewControls, TestTheApp } from "./build-stage";
import { ChatPane } from "./chat-pane";
import { ChangesPanel, currentChange } from "./changes-panel";
import { ActionNeeded } from "./key-action";
import { LookAndFeel } from "./look-and-feel";
import { PartDrawer } from "./part-drawer";
import { LaunchView } from "./launch-view";
import { useRun } from "./use-run";
import { fromStreamed, GROUP_LABEL, GROUP_ORDER, PlanDocument } from "./plan-document";
import { usePlanWriter } from "./use-plan-writer";
import { savePane } from "@/server/actions/preferences";
import { DevPanel } from "./dev-panel";
import { useTourActive } from "@/components/ax/tour-guide";

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
  if (view === "files")
    return (
      <>
        {planDocument}
        {project.status !== "draft" && <LookAndFeel project={project} />}
      </>
    );
  if (view === "agents") return <AgentsView project={project} items={items} />;
  if (view === "code") return <CodeView project={project} items={items} live={live} />;
  // The Developer panel (M5.10): Terminal, Console, Build logs and Live logs, in place of the old terminal.
  if (view === "terminal") return <DevPanel project={project} items={items} live={live} />;
  if (view === "data") return <DataView project={project} items={items} />;
  if (project.runStatus === "queued") {
    return (
      <EmptyState icon="window" picture={<BuildLoader step={buildProgressLine(live, items.filter((i) => i.status !== "dropped" && i.status !== "deferred").length)} roles={loaderRoles(items)} seed={project.id} />} title="Starting your build">
        The plan is agreed and saved as v{project.plan?.version ?? 1}. Architect is about to build it, part by part, with a check for each.
      </EmptyState>
    );
  }
  return (
    <>
      {budgetPaused && <BudgetBanner project={project} items={items} live={live} />}
      <AppPreview project={project} items={items} live={live} />
    </>
  );
}

function Rail({ label, icon, onOpen, children }: { label: string; icon: "panelLeft" | "panelRight"; onOpen: () => void; children?: ReactNode }) {
  return (
    <aside aria-label={label} className="flex w-14 flex-none flex-col items-center rounded-pane border border-line bg-tray py-3 shadow-pane max-md:hidden">
      <IconButton icon={icon} label={`Open ${label.toLowerCase()}`} quiet onClick={onOpen} />
      {children}
    </aside>
  );
}

const RANK: Record<string, number> = { viewer: 0, builder: 1, admin: 2, owner: 3 };

/**
 * The project's ⋯ (M5.8): View as role, Download code, GitHub, Hand off to coding agent, Activity and Duplicate, then
 * Developer view, ownership and settings, and Delete. Everything that used to sit in the header beside it is here.
 */
function MoreMenu({ project, items, canAct, dev, onToggleDev, onTransfer, onDelete }: { project: ProjectWorkspace; items: WorkspaceItem[]; canAct: boolean; dev: boolean; onToggleDev: () => void; onTransfer: () => void; onDelete: () => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const [, start] = useTransition();
  const item = "flex min-h-10 items-center gap-2.5 rounded-tile px-2.5";
  const realRole = project.viewingAs?.real ?? project.role;
  const viewAs = (role: "builder" | "viewer" | null) => {
    const next = new URLSearchParams(params);
    if (role) next.set("as", role);
    else next.delete("as");
    if (role === "viewer") next.delete("dev");
    router.replace(`/p/${project.id}${next.size ? `?${next}` : ""}`, { scroll: false });
  };
  const roles = (["builder", "viewer"] as const).filter((r) => RANK[r] < RANK[realRole]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="More for this project" className="grid size-[38px] place-items-center rounded-full border border-transparent bg-(--btn) hover:bg-(--btn-hover)">
        <Icon name="more" size="sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={12} className="w-72 rounded-card border border-line bg-surface p-1.5 shadow-pop">
        {project.viewingAs ? (
          <DropdownMenuItem className={item} onSelect={() => viewAs(null)}>
            <Icon name="person" size="sm" className="text-ink-2" />
            Stop viewing as {project.viewingAs.role === "viewer" ? "Viewer" : "Builder"}
          </DropdownMenuItem>
        ) : (
          roles.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={item}>
                <Icon name="person" size="sm" className="text-ink-2" />
                View as role
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56 rounded-card border border-line bg-surface p-1.5 shadow-pop">
                {roles.map((r) => (
                  <DropdownMenuItem key={r} className="flex min-h-10 flex-col items-start gap-0 rounded-tile px-2.5 py-1" onSelect={() => viewAs(r)}>
                    <span className="font-semibold">{r === "viewer" ? "Viewer" : "Builder"}</span>
                    <span className="text-small text-ink-2">{r === "viewer" ? "Sees and comments, can't change" : "Builds and changes, can't approve"}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )
        )}
        <DropdownMenuItem className={item} onSelect={() => downloadCode(project, items)}>
          <Icon name="download" size="sm" className="text-ink-2" />
          <span className="flex-1">{project.repo ? "Download code from GitHub" : "Download code"}</span>
          {!project.repo && <SimTag title="Architect's code is simulated in this prototype; the .zip says so." />}
        </DropdownMenuItem>
        <DropdownMenuItem className={item} onSelect={() => (project.repo ? window.open(`https://github.com/${project.repo}`, "_blank", "noopener") : router.push("/settings/github"))}>
          <Icon name="repo" size="sm" className="text-ink-2" />
          <span className="truncate">{project.repo ? `GitHub · ${project.repo}` : "GitHub settings"}</span>
        </DropdownMenuItem>
        <DropdownMenuItem className={item} disabled={!canAct} title={canAct ? undefined : "Viewers can't hand a project to a coding agent."} onSelect={() => router.push(`/p/${project.id}/settings#coding-agents`)}>
          <Icon name="code" size="sm" className="text-ink-2" />
          Hand off to coding agent
        </DropdownMenuItem>
        <DropdownMenuItem className={item} onSelect={() => (dev ? undefined : onToggleDev())} title="The checker, Architect, coding agents and GitHub, in Developer view">
          <Icon name="lines" size="sm" className="text-ink-2" />
          Activity
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
          <Icon name="copy" size="sm" className="text-ink-2" />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {canAct && (
          <DropdownMenuItem className={item} onSelect={onToggleDev}>
            {dev ? "Leave Developer view" : "Developer view"}
          </DropdownMenuItem>
        )}
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
        {/* Owners and Admins; a Builder their own project unless it's Live (the server checks the rest). */}
        {(canManageMembers(project.role) || (project.role === "builder" && project.isOwner && project.status !== "live")) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className={item} onSelect={onDelete}>
              Delete project…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "Changes (N)" in the header of a project from a repo: opens the review panel. */
function ChangesButton({ project }: { project: ProjectWorkspace }) {
  const openChanges = useUi((s) => s.openChanges);
  const { parts } = currentChange(project);
  return (
    <button type="button" onClick={() => openChanges(true)} className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full border border-transparent bg-(--btn) px-3.5 font-[550] hover:bg-(--btn-hover)">
      <Icon name="branch" size="sm" />
      Changes <span className="tabular-nums text-ink-2">({parts})</span>
    </button>
  );
}

/** Delete project (Owners and Admins), after a confirmation; then back to Projects. */
function DeleteProjectDialog({ project, open, onOpenChange }: { project: ProjectWorkspace; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const showToast = useUi((s) => s.showToast);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[440px]" showCloseButton={false}>
        <DialogTitle className="text-sub font-semibold">Delete {project.name}?</DialogTitle>
        <DialogDescription className="text-ink-2">
          You can restore it from Trash for 30 days{project.status === "live" ? ". Live goes offline first" : ""}. After that it&apos;s gone for good.
        </DialogDescription>
        {error && (
          <p role="alert" className="text-small font-semibold text-failed">
            {error}
          </p>
        )}
        <DialogFooter className="mt-2 gap-2">
          <Button variant="quiet" onClick={() => onOpenChange(false)}>
            Keep it
          </Button>
          <Button
            variant="primary"
            disabledReason={pending ? "Deleting…" : undefined}
            onClick={() =>
              start(async () => {
                setError(undefined);
                const r = await deleteProject({ projectId: project.id });
                if (!r.ok) return setError(r.message);
                showToast({ text: "Moved to Trash", undo: { label: "Undo", projectId: project.id }, link: { label: "View Trash", href: "/trash" } });
                router.push("/projects");
              })
            }
          >
            {pending ? "Deleting…" : "Delete project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * People (M5.8, in place of the Share button): who's in the workspace, as initials; the menu shares the project
 * (copy a version's address, share with the team or go live on Launch) and invites people.
 */
function PeopleMenu({ project }: { project: ProjectWorkspace }) {
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
  const shown = project.people.slice(0, 3);
  const more = project.people.length - shown.length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`People and sharing: ${project.people.length} ${project.people.length === 1 ? "person" : "people"} in this workspace`}
        title="People and sharing"
        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full border border-transparent bg-(--btn) py-1 pr-3 pl-1.5 font-[550] hover:bg-(--btn-hover)"
      >
        <span className="flex -space-x-1.5" aria-hidden="true">
          {shown.map((p) => (
            <span key={`${p.name}-${p.role}`} className="grid size-[26px] place-items-center rounded-full border-2 border-surface bg-selected text-[11px] font-bold">
              {initials(p.name)}
            </span>
          ))}
        </span>
        {copied ? "Copied" : more > 0 ? `+${more}` : "Share"}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={12} className="w-72 rounded-card border border-line bg-surface p-1.5 shadow-pop">
        <DropdownMenuLabel className="px-2.5 py-1 text-small font-[650] text-ink-3">People in this workspace</DropdownMenuLabel>
        {project.people.slice(0, 6).map((p) => (
          <div key={`${p.name}-${p.role}`} className="flex min-h-9 items-center gap-2.5 px-2.5">
            <span className="grid size-6 place-items-center rounded-full bg-selected text-[11px] font-bold" aria-hidden="true">
              {initials(p.name)}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {p.name}
              {p.you ? " (you)" : ""}
            </span>
            <span className="text-small text-ink-2">{ROLE_INFO[p.role].label}</span>
          </div>
        ))}
        <DropdownMenuItem className={item} onSelect={() => router.push("/settings/members")}>
          <Icon name="invite" size="sm" className="text-ink-2" />
          Invite people
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {project.status === "draft" ? (
          <DropdownMenuItem className={item} disabled title="Build the plan first. Then you can share a test version.">
            <Icon name="copy" size="sm" className="text-ink-3" />
            <span className="flex-1">Copy the test version link</span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem className={item} onSelect={() => copy("test", `${slug}--test.architect.space`)}>
            <Icon name="copy" size="sm" />
            <span className="flex-1">Copy the test version link</span>
            <SimTag />
          </DropdownMenuItem>
        )}
        {project.status === "live" && (
          <DropdownMenuItem className={item} onSelect={() => copy("live", `${slug}.architect.app`)}>
            <Icon name="copy" size="sm" />
            <span className="flex-1">Copy the live link</span>
            <SimTag />
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className={item} disabled={!built} title={built ? undefined : "Launch opens when the build finishes."} onSelect={() => router.push(`/p/${project.id}/launch`)}>
          Share with your team or go live…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The project workspace: header on the canvas, Plan panel, stage, Chat (BUILD-SPEC section 2, screens 2, 3, 16). */
export function Workspace({ project, page = "workspace" }: { project: ProjectWorkspace; page?: "workspace" | "launch" }) {
  const onLaunch = page === "launch" && project.launch !== null;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const sendToChat = useUi((s) => s.sendToChat);
  const agentChanges = useUi((s) => s.agentChanges);
  const agentOpen = useUi((s) => s.agentKey !== null);
  // "Plan" is the tab's name; its old address (?view=files) still works.
  const raw = params.get("view") === "plan" ? "files" : params.get("view");
  const planStage = project.status === "draft";
  const dev = params.get("dev") === "1";
  // No terminal for Viewers (M5.5): Developer view shows them the code and the files only.
  const devViews: View[] = (planStage ? (["files", "code", "terminal"] as View[]) : DEV_VIEWS).filter((v) => v !== "terminal" || canBuild(project.role));
  const allowed: View[] = dev ? devViews : VIEWS;
  // Before Build the plan is the default; Mockup (the preview shell) and Workflow (the agents graph) are a click away.
  const view: View = allowed.includes(raw as View) ? (raw as View) : dev ? "code" : planStage ? "files" : "app";
  const fullWidth = onLaunch || (!planStage && view !== "app");
  // The person's own choice wins (M5.10), saved per person: null until they touch a pane, then the per-tab default
  // (full-width tabs fold the panes) no longer applies to it, on any tab or project, after reloads too.
  const [planOpen, setPlanOpenState] = useState<boolean | null>(project.panes.parts ?? null);
  const [chatOpen, setChatOpenState] = useState<boolean | null>(project.panes.chat ?? null);
  // Toggled on this page (Tour v3): during the tour, only these count, so the panes never fold by themselves.
  const [touched, setTouched] = useState<{ parts?: boolean; chat?: boolean }>({});
  // Panes slide open and closed once the page is showing (never on first paint). Closing slides out, then folds.
  const [paneMotion, setPaneMotion] = useState<{ parts?: "in" | "out"; chat?: "in" | "out" }>({});
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const togglePane = (pane: "parts" | "chat", open: boolean) => {
    const apply = () => {
      (pane === "parts" ? setPlanOpenState : setChatOpenState)(open);
      setTouched((t) => ({ ...t, [pane]: open }));
      setPaneMotion((m) => ({ ...m, [pane]: open ? "in" : undefined }));
      void savePane({ pane, open });
    };
    if (open || reduced) return apply();
    setPaneMotion((m) => ({ ...m, [pane]: "out" }));
    window.setTimeout(apply, 300);
  };
  const setPlanOpen = (open: boolean) => togglePane("parts", open);
  const setChatOpen = (open: boolean) => togglePane("chat", open);
  const tourOn = useTourActive();
  // Launch keeps the plan open and folds chat to a rail (screen 4).
  // Agents keeps the plan open too, listing the agents and the apps they connect to (screen 9).
  // While the tour is on, both stay open unless the person folds one here.
  const showPlan = tourOn ? (touched.parts ?? true) : (planOpen ?? (onLaunch || !fullWidth || (!planStage && view === "agents") || dev));
  const showChat = tourOn ? (touched.chat ?? true) : (chatOpen ?? (!fullWidth || (dev && !onLaunch)));
  const paneClass = (pane: "parts" | "chat") =>
    paneMotion[pane] === "out" ? (pane === "parts" ? "ax-slide-to-left" : "ax-slide-to-right") : paneMotion[pane] === "in" ? (pane === "parts" ? "ax-slide-from-left" : "ax-slide-from-right") : undefined;

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

  const [modelAsk, setModelAsk] = useState<ModelPick | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, start] = useTransition();
  const [actionError, setActionError] = useState<string>();

  const switchModel = (m: ModelPick, thenWrite: boolean) =>
    start(async () => {
      const r = await setProjectModel({ projectId: project.id, model: m });
      if (!r.ok) return setActionError(r.message);
      router.refresh();
      // Auto resolves on the server; a picked model is passed straight to the writer.
      if (thenWrite) void write(m === AUTO ? {} : { model: m });
    });

  // The picker's label (a registered private model goes by its own name).
  const modelName = (m: ModelPick) => (m === AUTO ? AUTO_LABEL : (project.models.find((o) => o.choice === m)?.label ?? MODEL_LABEL[m]));

  // A code edit's re-run check (simulated) finishes after a few seconds: settle it then, without a reload.
  // An edited check (A-7) re-runs the same way.
  const recheckRunning = project.codeEdits.edits.some((e) => e.check === "running") || project.items.some((i) => i.status === "building" && Boolean(i.statusDetail?.startsWith("Re-running its check")));
  useEffect(() => {
    if (!recheckRunning) return;
    const t = setTimeout(() => void settleEdits({ projectId: project.id }).then(() => router.refresh()), 6500);
    return () => clearTimeout(t);
  }, [recheckRunning, project.id, router]);

  // Launch is the next screen once something is built: fetch it ahead, so the click paints at once.
  useEffect(() => {
    if (project.status === "built" || project.status === "live") router.prefetch(`/p/${project.id}/launch`);
  }, [project.status, project.id, router]);

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
        externalCalls: project.launch!.externalCalls,
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
    toFix: whatsNotDone(items).filter((r) => r.reason !== "Set aside: not in this version").length,
    build: project.run
      ? { works: worksNow, total: counted.length, blocked: counted.filter((i) => i.status === "paused").length, eta: etaWords(live.etaSeconds), playing: live.playing, budgetPaused }
      : undefined,
  });
  // On Launch the stage action is Share with your team, disabled until the checklist is clear (BUILD-SPEC section 2).
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
    !launch && !agentsState.action.opensLaunch && project.policy.budget.level === "stopped" && !agentsState.action.disabledReason ? { ...agentsState, action: { ...agentsState.action, disabledReason: BUDGET_STOPPED } } : agentsState;

  // The stage tabs, now in the header's middle zone (M5.8).
  const tabs: { value: View; label: string }[] = !planStage || dev || (project.plan && !writing && !failed) ? [
                  // Before Build, Developer view shows the plan beside the code (an imported repo's files are real already).
                  ...(planStage && dev
                    ? [{ value: "files" as const, label: "Plan" }]
                    : planStage
                    ? [
                        { value: "app" as const, label: "App" },
                        { value: "files" as const, label: "Plan" },
                        { value: "agents" as const, label: "Agents" },
                      ]
                    : [
                        { value: "app" as const, label: "App" },
                        { value: "files" as const, label: "Plan" },
                        { value: "agents" as const, label: "Agents" },
                        { value: "data" as const, label: "Data" },
                      ]),
                  ...(dev ? [{ value: "code" as const, label: "Code" }, ...(canAct ? [{ value: "terminal" as const, label: "Terminal & logs" }] : [])] : []),
                ] : [];

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
    // The default view needs no parameter: the app after Build, the plan before it.
    if (!dev && v === (planStage ? "files" : "app")) next.delete("view");
    else next.set("view", v);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  const streamedItems = writer.phase !== "idle" && writer.items.length && (writing || writer.phase === "failed") ? writer.items.map(fromStreamed) : project.items;
  const editReason = !canAct ? "Viewers can't change the plan." : project.plan?.agreedAt ? "This version is agreed. Ask for changes in chat." : undefined;
  const planDocument = (
    <div id="plan-top" data-tour="plan-doc">
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

  // "Plan v1" once agreed (M5.10: "agreed" was jargon); a draft, a plan being written or an unfinished one says so.
  const versionLabel = writing ? "writing" : failed ? "unfinished" : project.plan && !project.plan.agreedAt ? "draft" : undefined;
  const planPanel: ReactNode = showPlan ? (
    <PlanPanel
      version={project.plan || writing ? `Plan v${project.plan?.version ?? 1}${versionLabel ? ` · ${versionLabel}` : ""}` : undefined}
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
      className={paneClass("parts")}
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
    <Rail label="Parts" icon="panelLeft" onOpen={() => setPlanOpen(true)} />
  );

  return (
    <div className="flex h-dvh flex-col bg-canvas px-2.5 pb-2.5 max-lg:h-auto max-lg:min-h-dvh">
      {/* View as role (M5.8): the page shows the project as that role sees it; the server still checks the real role. */}
      {project.viewingAs && (
        <div role="status" className="mt-2 flex items-center justify-center gap-2 rounded-card bg-selected px-4 py-2 text-small">
          <Icon name="person" size="sm" />
          <span>
            Viewing as <b>{project.viewingAs.role === "viewer" ? "Viewer" : "Builder"}</b>
          </span>
          ·
          <TextLink
            className="text-small"
            onClick={() => {
              const next = new URLSearchParams(params);
              next.delete("as");
              router.replace(`/p/${project.id}${next.size ? `?${next}` : ""}`, { scroll: false });
            }}
          >
            Stop
          </TextLink>
        </div>
      )}
      {/* Three zones (M5.8): back, name and stepper · the tabs and the preview's size · Changes, people, ⋯ and Launch. */}
      {/* One row on wide screens; below 1600px the name and stepper take the first row, the rest the second. */}
      <header className="flex min-h-[66px] flex-wrap items-center gap-x-3 gap-y-2 px-1 py-2 min-[1600px]:grid min-[1600px]:grid-cols-[auto_minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5 max-[1599px]:basis-full">
          <Link href="/projects" aria-label="Back to projects" className="grid size-[38px] flex-none place-items-center rounded-full hover:bg-selected">
            <Icon name="chevronLeft" size="sm" />
          </Link>
          {/* The project's mosaic, cropped to its first 4 parts (Soft Tray v4). */}
          <MosaicThumb seed={project.id} parts={items} crop={4} />
          <div className="flex min-w-0 flex-col leading-tight">
            <h1 className="flex min-w-0 items-center gap-2 text-sub font-semibold">
              <span className="truncate">{project.name}</span>
              {dev && <span className="flex-none rounded-full bg-selected px-2 py-0.5 text-small font-semibold text-ink-2">Developer view</span>}
            </h1>
            <span className="truncate text-small text-ink-2">
              Edited by {project.ownerName} · {relativeTime(project.updatedAt)}
            </span>
          </div>
          {/* The stepper: the stage, progress inside it, and navigation. Nothing to act on lives in it (M5.5 review). */}
          <Stepper
            className="ml-2 max-sm:ml-0"
            current={state.stage}
            progress={state.progress}
            paused={state.paused}
            onSelect={(stage) => {
              if (stage === "launch") {
                // No Launch before a build: until the plan is agreed, Launch isn't a place yet.
                if (project.plan?.agreedAt) router.push(`/p/${project.id}/launch`);
              } else router.push(`/p/${project.id}${stage === "plan" && !planStage ? "?view=plan" : ""}`);
            }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {!launch && tabs.length > 0 && <Segmented label="Stage view" value={view} onChange={setView} options={tabs} />}
          {!launch && view === "app" && <PreviewControls projectId={project.id} />}
        </div>
        <div className="flex items-center justify-end gap-2 max-[1599px]:ml-auto">
          {/* Developer view is a mode that stays on, so it's a switch (M5.5 review). Builders and up; Viewers don't see it. */}
          {canAct && (
            <button
              type="button"
              role="switch"
              data-tour="dev-toggle"
              aria-checked={dev}
              aria-label="Developer view"
              onClick={toggleDev}
              title="The code, files and terminal for this project"
              className="inline-flex min-h-8 items-center gap-2 rounded-full px-2 text-small font-[600] text-ink hover:bg-selected max-sm:hidden"
            >
              {/* Always labelled (M5.9): the bare <> icon didn't say what the switch does. */}
              <span>Developer view</span>
              <span aria-hidden="true" className={cn("relative h-[18px] w-[30px] flex-none rounded-full", dev ? "bg-ink" : "bg-line-ctl")}>
                <span className={cn("absolute top-[2px] size-[14px] rounded-full bg-surface transition-[left]", dev ? "left-[14px]" : "left-[2px]")} />
              </span>
            </button>
          )}
          {project.repo && <ChangesButton project={project} />}
          <PeopleMenu project={project} />
          <MoreMenu project={project} items={items} canAct={canAct} dev={dev} onToggleDev={toggleDev} onTransfer={() => setTransferOpen(true)} onDelete={() => setDeleteOpen(true)} />
          {state.action.beside && <span className="max-w-[190px] text-right text-small leading-tight text-ink-2 max-md:hidden">{state.action.beside}</span>}
          <Button
            // The tour's Build step (planStage) and Launch step (on the Launch page) point here.
            data-tour={planStage ? "build" : launch ? "launch-action" : undefined}
            // The stage action is the primary only when nothing on screen needs the person first (BUILD-SPEC section 2).
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
            href={!launch && state.action.opensLaunch ? `/p/${project.id}/launch` : undefined}
            onClick={() => {
              if (launch) {
                setActionError(undefined);
                start(async () => {
                  // ?sim=deployfail: the deploy fails at its health check (docs/build/SIMULATOR.md "Deploys").
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
                // ?sim=paused, ?sim=budget, ?sim=fast: the demo variants (docs/build/SIMULATOR.md).
                const r = await buildPlan({ blueprintId: project.plan!.id, sim: params.get("sim") ?? undefined });
                if (!r.ok) return setActionError(r.message);
                // Build from the Plan tab goes to the App view, the live preview, with Parts and Chat open, rather than
                // leaving a full-width tab that folds the panes.
                if (!dev && view !== "app") {
                  setPlanOpenState(true);
                  setChatOpenState(true);
                  setTouched({ parts: true, chat: true });
                  const next = new URLSearchParams(params);
                  next.delete("view");
                  router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
                }
                router.refresh();
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
        <section aria-label="Stage" data-tour="stage" className="flex min-h-[480px] min-w-0 flex-1 flex-col overflow-hidden rounded-pane border border-line bg-surface shadow-pane">
          {launch ? (
            <div className="min-h-0 flex-1 overflow-auto">
              <LaunchView project={project} state={launch} />
            </div>
          ) : (
            <>
          {/* The stage's own tools (the tabs are in the header): only when there's something to show. */}
          {(dev || (planStage && (view === "app" || view === "agents") && project.plan && !writing && !failed) || (!planStage && (view === "app" || view === "agents"))) && (
            <div className="flex flex-wrap items-center gap-2.5 px-3 py-2.5">
              {dev && (
                <span data-tour="dev-repo" className="ml-auto">
                  <PrStatus project={project} items={items} />
                </span>
              )}
              {planStage && !dev && (view === "app" || view === "agents") && (
                <span className="ml-auto flex items-center gap-2 text-small text-ink-2">
                  {view === "app" ? "A mockup from the plan: nothing is built yet." : "The plan's agents and how they connect: nothing is built yet."}
                  <SimTag title="Before Build, the mockup and the workflow are drawn from the plan." />
                </span>
              )}
              {view === "app" && !planStage && (
                <span className="ml-auto flex items-center gap-2">
                  <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line px-2.5 text-small font-[650] text-building">
                    <i className="size-1.5 rounded-full bg-building" aria-hidden="true" />
                    Test version
                  </span>
                  <TestTheApp items={items} />
                </span>
              )}
              {view === "agents" && !planStage && (
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
          <div role={planStage && view === "files" && !dev ? undefined : "tabpanel"} aria-label={planStage && view === "files" && !dev ? "The plan" : view} className="flex min-h-0 flex-1 flex-col overflow-auto">
            {planStage && view === "files" ? planDocument : <StageBody view={view} project={project} planDocument={planDocument} items={items} live={live} budgetPaused={budgetPaused} />}
          </div>
            </>
          )}
        </section>
        {showChat ? (
          <ChatPane
            project={project}
            className={paneClass("chat")}
            writing={writing}
            activity={
              planStage ? null : (
                <>
                  <BuildActivity project={project} items={items} live={live} />
                  <ActionNeeded project={project} items={items} />
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
            onOpenDesign={() => {
              setView("files");
              setTimeout(() => scrollTo("design"), 300);
            }}
          />
        ) : (
          <Rail label="Chat" icon="panelRight" onOpen={() => setChatOpen(true)} />
        )}
      </div>

      {!planStage && <PartDrawer project={project} items={items} />}
      <DeleteProjectDialog project={project} open={deleteOpen} onOpenChange={setDeleteOpen} />
      <ChangesPanel project={project} />
      {transferOpen && <TransferDialog project={project} open={transferOpen} onOpenChange={setTransferOpen} />}

      {/* Switching models mid-project asks first (BL-3). */}
      <Dialog open={modelAsk !== null} onOpenChange={(o) => !o && setModelAsk(null)}>
        <DialogContent className="rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[460px]" showCloseButton={false}>
          <DialogTitle className="text-sub font-semibold">Switch this project to {modelAsk ? modelName(modelAsk) : ""}?</DialogTitle>
          <DialogDescription className="text-ink-2">
            Chat answers and new plan versions use {modelAsk ? modelName(modelAsk) : ""} from now on. The plan you have stays as it is, and its prices
            change only when a new version is written.
            {modelAsk && project.models.find((m) => m.choice === modelAsk)?.simulated && " In this prototype it's answered by Gemini."}
            {modelAsk === AUTO && ` ${AUTO_NOTE}; in this prototype every step uses ${modelName(project.model)}.`}
          </DialogDescription>
          <DialogFooter className="mt-2 gap-2">
            <Button variant="quiet" onClick={() => setModelAsk(null)}>
              Keep {modelName(project.modelPick)}
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
