"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Button, IconButton, TextLink } from "@/components/ax/button";
import { Composer } from "@/components/ax/composer";
import { EmptyState } from "@/components/ax/empty-state";
import { Icon } from "@/components/ax/icon";
import { IconTile } from "@/components/ax/list-row";
import { NeedsYouCard } from "@/components/ax/needs-you-card";
import { Pill, SimTag } from "@/components/ax/pill";
import { PlanGroup, PlanPanel, PlanRow } from "@/components/ax/plan-panel";
import { PreviewFrame } from "@/components/ax/preview-dock";
import { Segmented } from "@/components/ax/segmented";
import type { Status, StatusIcon } from "@/components/ax/status-mark";
import { Stepper } from "@/components/ax/stepper";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { canBuild } from "@/lib/permissions";
import { relativeTime } from "@/lib/project-status";
import { useUi } from "@/lib/ui-store";
import { workspaceState } from "@/lib/workspace-state";
import { duplicateProject } from "@/server/actions/projects";
import type { ProjectWorkspace, WorkspaceItem } from "@/server/project";

type View = "app" | "agents" | "data" | "files";
const VIEWS: View[] = ["app", "agents", "data", "files"];

const GROUP_LABEL: Record<string, string> = {
  features: "What it does",
  integrations: "Apps it connects to",
  agents: "AI agents",
  data: "Data, sign-in and look",
  quality: "Checks and safety",
};

/** How a part shows in the Plan panel (DATA-MODEL "Item statuses"). */
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
      return { status: "todo", detail: i.estimate ? `~${Math.round(i.estimate)} credits` : undefined };
  }
}

function PlanContents({ project, canAct }: { project: ProjectWorkspace; canAct: boolean }) {
  const needs = project.items.filter((i) => ["needs_connection", "needs_approval", "paused"].includes(i.status));
  const doing = project.items.filter((i) => ["building", "failed"].includes(i.status));
  const works = project.items.filter((i) => ["built", "sample_data"].includes(i.status));
  const next = project.items.filter((i) => ["proposed", "agreed", "deferred", "dropped"].includes(i.status));

  if (!project.plan || project.items.length === 0) {
    return (
      <div className="mx-2.5 rounded-card border border-line bg-surface p-4 text-small text-ink-2">
        The plan appears here: every part of the app, how Architect checks it works, and what it costs. Nothing is built until you
        click Build.
      </div>
    );
  }
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
              <NeedsYouCard
                key={i.id}
                status="attention"
                icon="plug"
                name={i.title}
                action={
                  canAct ? (
                    <Button variant="primary" size="sm" href="/connections">
                      Open Connections
                    </Button>
                  ) : undefined
                }
              >
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
        <PlanGroup title={project.status === "draft" ? "In this plan" : "Up next"} count={`${next.length} ${next.length === 1 ? "part" : "parts"}`}>
          {next.map((i) => (
            <PlanRow key={i.id} title={i.title} {...rowFor(i)} />
          ))}
        </PlanGroup>
      )}
    </>
  );
}

function PlanDocument({ project }: { project: ProjectWorkspace }) {
  if (!project.plan) {
    return (
      <EmptyState icon="doc" title="No plan yet">
        Architect writes the plan from your request: every part, how it&apos;s checked, and what it costs. Plan writing arrives in M2.
      </EmptyState>
    );
  }
  const groups = Object.keys(GROUP_LABEL).filter((g) => project.items.some((i) => i.grp === g));
  return (
    <article className="mx-auto flex w-full max-w-[720px] flex-col gap-[22px] px-8 py-9 max-sm:px-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-small font-semibold text-ink-2">
          {project.name} · plan v{project.plan.version}
        </span>
        <h2 className="text-title font-[650]">{project.plan.summary ?? project.name}</h2>
        {project.prompt && <p className="text-sub text-ink-2">{project.prompt}</p>}
      </div>
      {groups.map((g) => (
        <section key={g} className="flex flex-col gap-2">
          <h3 className="text-sub font-[650]">{GROUP_LABEL[g]}</h3>
          <ul className="flex flex-col overflow-hidden rounded-card border border-line">
            {project.items
              .filter((i) => i.grp === g)
              .map((i) => (
                <li key={i.id} className="flex gap-3 border-t border-line px-3.5 py-3 first:border-t-0">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className={i.status === "dropped" ? "font-semibold text-ink-3 line-through" : "font-semibold"}>{i.title}</span>
                    <span className="text-small text-ink-2">{i.provedWhen}</span>
                  </div>
                  {i.estimate !== null && <span className="text-small text-ink-2 tabular-nums">~{Math.round(i.estimate)} cr</span>}
                </li>
              ))}
          </ul>
        </section>
      ))}
      {project.plan.totalLikely !== null && (
        <div className="flex items-center gap-3.5 rounded-card border border-line bg-tray px-[18px] py-4">
          <Icon name="credits" />
          <span>
            About <b className="tabular-nums">{Math.round(project.plan.totalLikely)} credits</b>
            {project.plan.estMinutes ? ` and ${project.plan.estMinutes} minutes` : ""} to build, fixes included.
          </span>
        </div>
      )}
    </article>
  );
}

function StageBody({ view, project }: { view: View; project: ProjectWorkspace }) {
  if (view === "files") return <PlanDocument project={project} />;
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
  if (project.status === "draft") {
    return (
      <EmptyState icon="window" title="Nothing is built yet">
        After you click Build, the app appears here as a Test version only you can see. Nothing is built or charged before that.
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

function ChatPane({ project, onCollapse }: { project: ProjectWorkspace; onCollapse: () => void }) {
  const [draft, setDraft] = useState("");
  const [talkFirst, setTalkFirst] = useState(false);
  return (
    <aside aria-label="Chat" className="flex min-h-0 flex-col overflow-hidden rounded-pane border border-line bg-surface shadow-pane lg:w-[344px] lg:flex-none">
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
        <h2 className="flex-1 text-sub font-semibold">Chat</h2>
        <IconButton icon="panelRight" label="Collapse chat" quiet size={32} onClick={onCollapse} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto px-4 pt-1.5 pb-3" aria-live="polite">
        {project.prompt && <div className="max-w-[86%] self-end rounded-[16px_16px_4px_16px] bg-selected px-[13px] py-[9px]">{project.prompt}</div>}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-small font-semibold text-ink-2">
            <span className="grid size-[22px] place-items-center rounded-[7px] bg-primary text-small font-bold text-on-primary" aria-hidden="true">
              A
            </span>
            Architect
          </div>
          <p>
            {project.plan
              ? `Here's the plan: ${project.summary.total} parts${project.plan.totalLikely ? `, about ${Math.round(project.plan.totalLikely)} credits` : ""}. Change anything by telling me here.`
              : "I'll write the plan here: every part, how I'll check it works, and what it costs. Nothing is built until you click Build."}
          </p>
        </div>
      </div>
      <div className="px-3 pb-3">
        <Composer
          variant="chat"
          value={draft}
          onChange={setDraft}
          onSubmit={() => {}}
          talkFirst={talkFirst}
          onTalkFirstChange={setTalkFirst}
          placeholder="Change anything in plain words…"
          label="Message Architect"
          submitDisabledReason="Chat comes with plan writing (M2)."
          modelPicker={
            <Pill soft iconAfter="chevronDown" disabledReason="Picking a model comes in M2.">
              Gemini
            </Pill>
          }
        />
      </div>
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
        {later("Version history", "M2")}
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
  const view: View = VIEWS.includes(raw as View) ? (raw as View) : "app";
  const fullWidth = view !== "app";
  const [planOpen, setPlanOpen] = useState<boolean | null>(null);
  const [chatOpen, setChatOpen] = useState<boolean | null>(null);
  // Full-width views collapse both panels to rails unless the person opened them.
  const showPlan = planOpen ?? !fullWidth;
  const showChat = chatOpen ?? !fullWidth;

  const canAct = canBuild(project.role);
  const state = workspaceState({
    status: project.status,
    role: project.role,
    summary: project.summary,
    planTotal: project.plan?.totalLikely ?? null,
    hasPlan: Boolean(project.plan && project.items.length),
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

  const planPanel: ReactNode = showPlan ? (
    <PlanPanel
      version={project.plan ? `v${project.plan.version} · ${project.plan.status === "agreed" ? "agreed" : "draft"}` : undefined}
      intro={
        project.status === "draft"
          ? "Read it, change anything in plain words, then click Build. Nothing is built or charged before that."
          : undefined
      }
      progress={
        project.status !== "draft" && project.summary.total
          ? { value: project.summary.works / project.summary.total, label: `${project.summary.works} of ${project.summary.total} parts work` }
          : undefined
      }
      onToggleCollapsed={() => setPlanOpen(false)}
    >
      <PlanContents project={project} canAct={canAct} />
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
          {state.action.beside && <span className="max-w-[180px] text-right text-small leading-tight text-ink-2 max-md:hidden">{state.action.beside}</span>}
          <Button variant="primary" disabledReason={state.action.disabledReason}>
            {state.action.label}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-2.5 max-lg:flex-col">
        {planPanel}
        <section aria-label="Stage" className="flex min-h-[480px] min-w-0 flex-1 flex-col overflow-hidden rounded-pane border border-line bg-surface shadow-pane">
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
          <div role="tabpanel" aria-label={view} className="flex min-h-0 flex-1 flex-col overflow-auto">
            <StageBody view={view} project={project} />
          </div>
        </section>
        {showChat ? <ChatPane project={project} onCollapse={() => setChatOpen(false)} /> : <Rail label="Chat" icon="panelRight" onOpen={() => setChatOpen(true)} />}
      </div>
    </div>
  );
}
