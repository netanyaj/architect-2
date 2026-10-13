"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button, buttonClasses, IconButton, TextLink } from "@/components/ax/button";
import { AgentGlyph } from "@/components/ax/AgentGlyph";
import { EmptyState } from "@/components/ax/empty-state";
import { Icon } from "@/components/ax/icon";
import { ModelNotAllowed, ModelPicker } from "@/components/ax/model-picker";
import { Select } from "@/components/ax/select";
import { Pill, SimTag } from "@/components/ax/pill";
import { PlanGroup, PlanRow } from "@/components/ax/plan-panel";
import { Segmented } from "@/components/ax/segmented";
import { StatusMark } from "@/components/ax/status-mark";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { agentGraph, changesBetween, CONVERT_CREDITS, GRAPH, layoutGraph, runtimeLine, studioUrl, triggerChoice, triggerFor, type AgentDraft, type GraphEnd } from "@/lib/agents";
import { COMMON_ZONES, DAY_WORDS, SCHEDULE_DAYS, sameSchedule, scheduleWords, viewerTimeZone, zoneWords, type Schedule, type ScheduleDays } from "@/lib/schedule";
import { MODEL_LABEL, type ModelChoice } from "@/lib/models";
import { agentRole } from "@/lib/brand";
import { canBuild } from "@/lib/permissions";
import { PROVIDERS, providerName } from "@/lib/providers";
import { relativeTime } from "@/lib/project-status";
import { useUi } from "@/lib/ui-store";
import { cn } from "@/lib/utils";
import { loadAgents, retryStudio, saveAgent, saveSchedule, setAgentRun, tryAgent, type AgentRunView, type AgentsData, type AgentView } from "@/server/actions/agents";
import { loadPart, type PartDetail } from "@/server/actions/run";
import type { ProjectWorkspace, WorkspaceItem } from "@/server/project";
import { rowFor } from "./build-stage";
import { mcpToolLabel } from "@/lib/mcp-connections";

type Draft = AgentDraft;
type Tab = "settings" | "runs" | "try" | "checks";

const draftOf = (a: AgentView): Draft => ({ model: a.model, temperature: a.temperature, maxTokens: a.maxTokens, instructions: a.instructions, tools: a.tools, knowledge: a.knowledge, framework: a.framework });

const shortModel = (m: ModelChoice) => MODEL_LABEL[m].replace(" (free)", "").replace("Claude ", "");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const seconds = (ms: number | null) => (ms === null ? null : `${(ms / 1000).toFixed(1)} s`);

/** Tools the "Tool or MCP server" menu offers. Tools are simulated: Try it runs the agent's instructions only. */
const BASE_TOOLS = ["Web search", "PDF summariser", "Calculator", ...Object.values(PROVIDERS).map((p) => p.name)];
/** The MCP servers connected in Connections (M6), which only takes servers the policy allows (C-3). */
const toolCatalog = (mcp: AgentsData["mcpServers"]) => [...BASE_TOOLS, ...mcp.map((m) => mcpToolLabel(m.name))];

const RUNTIME_WORDS: Record<AgentRunView["runtime"], string> = {
  lyzr_agent: "Runs on Lyzr Studio",
  lyzr_shared: "Runs on Lyzr Studio · shared demo agent",
  gateway: "Answered by Gemini through Architect",
  sample: "Build check",
};

/** The agent parts as the Plan panel lists them on the Agents view (screen 9): AI agents, then apps they connect to. */
export function AgentsPlanPanel({ project, items }: { project: ProjectWorkspace; items: WorkspaceItem[] }) {
  const { agentKey, openAgent, agentChanges } = useUi();
  const spec = useMemo(
    () =>
      agentGraph({
        projectName: project.name,
        prompt: project.prompt,
        parts: items.map((i) => ({ key: i.key, title: i.title, description: i.description, provedWhen: i.provedWhen, grp: i.grp, status: i.status, provider: i.provider, position: i.position })),
        uploads: project.uploads.map((u) => u.name),
      }),
    [project.name, project.prompt, project.uploads, items],
  );
  const providers = Array.from(new Set(items.filter((i) => i.provider && i.status !== "dropped" && i.status !== "deferred").map((i) => i.provider!)));
  const byKey = new Map(items.map((i) => [i.key, i]));
  return (
    <>
      <PlanGroup title="AI agents" count={spec.agents.length}>
        {spec.agents.length
          ? spec.agents.map((a) => {
              const item = byKey.get(a.key);
              const row = item ? rowFor(item) : { status: "todo" as const };
              const selected = agentKey === a.key;
              // The only agent from Studio is the seeded Research agent: the shared demo agent (M5.10).
              const detail = selected && agentChanges ? `${a.origin === "studio" ? "Demo agent" : "New"} · ${plural(agentChanges, "unsaved change")}` : a.origin === "studio" ? "Demo agent · try it for real" : "New";
              return <PlanRow key={a.key} status={row.status} icon={"icon" in row ? row.icon : undefined} title={a.name} detail={detail} selected={selected} onClick={() => openAgent(a.key)} />;
            })
          : [<p key="none" className="px-2 pb-1 text-small text-ink-2">No agents in this plan yet.</p>]}
      </PlanGroup>
      {providers.length > 0 && (
        <PlanGroup title="Apps it connects to" count={providers.length}>
          {providers.map((p) => {
            const denied = project.denied.includes(p);
            const connected = project.connected.includes(p);
            return (
              <PlanRow
                key={p}
                status={connected ? "works" : denied ? "approval" : "attention"}
                icon={connected ? undefined : denied ? "lock" : "plug"}
                title={providerName(p)}
                detail={connected ? undefined : denied ? "Waiting for IT" : "Not connected yet"}
              />
            );
          })}
        </PlanGroup>
      )}
    </>
  );
}

function EndNode({ end, x, y }: { end: GraphEnd; x: number; y: number }) {
  return (
    <div className="absolute flex flex-col gap-1.5 rounded-[14px] border border-line bg-surface px-3.5 py-3 shadow-[0_2px_8px_rgba(0,0,0,.06)]" style={{ left: x, top: y, width: GRAPH.nodeW }}>
      <span className="text-small font-semibold text-ink-3">{end.label}</span>
      <strong className="font-[650]">{end.title}</strong>
      {end.detail && <span className="truncate text-small text-ink-2">{end.detail}</span>}
    </div>
  );
}

const SCHEDULE_SIM = "Nothing runs on the clock in this prototype. Real schedules would run in the cell's orchestrator.";

/** The graph's first node (round 7): what starts the app, or its schedule. A button: it opens the schedule editor. */
function TriggerNode({ end, scheduled, x, y, onEdit }: { end: GraphEnd; scheduled: boolean; x: number; y: number; onEdit: () => void }) {
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={`${end.label} ${end.title}${end.detail ? `, ${end.detail}` : ""}${scheduled ? " (simulated)" : ""}. Change when it runs`}
      className="absolute flex flex-col gap-1 rounded-[14px] border border-line bg-surface px-3.5 py-2.5 text-left text-ink shadow-[0_2px_8px_rgba(0,0,0,.06)] hover:border-line-ctl"
      style={{ left: x, top: y, width: GRAPH.nodeW, minHeight: GRAPH.nodeH }}
    >
      <span className="flex items-center gap-2 text-small font-semibold text-ink-3">
        <span className="flex-1">{end.label}</span>
        {scheduled ? <SimTag title={SCHEDULE_SIM} className="h-5 px-1.5" /> : <Icon name="clock" size="sm" />}
      </span>
      <strong className="font-[650]">{end.title}</strong>
      {/* Two lines, so "Weekdays at 8:00, your time zone" reads in full. */}
      {end.detail && <span className="line-clamp-2 text-small text-ink-2">{end.detail}</span>}
    </button>
  );
}

/**
 * When it runs (round 7, Simulated), in the first agent's settings: on its trigger, or on a schedule ("Weekdays at
 * 8:00, your time zone"). Saved on its own, apart from Save changes, so it works on the read-only demo agent too.
 */
function ScheduleSection({
  agent,
  trigger,
  schedule,
  readOnly,
  viewerTz,
  onSaved,
}: {
  agent: AgentView;
  trigger: GraphEnd;
  schedule: Schedule | null;
  readOnly: boolean;
  viewerTz: string;
  onSaved: (s: Schedule | null) => void;
}) {
  const fallback: Schedule = { days: "weekdays", time: "08:00", tz: viewerTz };
  const [on, setOn] = useState(Boolean(schedule));
  const [draft, setDraft] = useState<Schedule>(schedule ? { ...schedule, tz: schedule.tz || viewerTz } : fallback);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ kind: "error" | "info"; text: string }>();
  const next = on ? draft : null;
  const changed = !sameSchedule(next, schedule ? { ...schedule, tz: schedule.tz || viewerTz } : null);
  const zones = Array.from(new Set([viewerTz, draft.tz, ...COMMON_ZONES].filter(Boolean)));
  const reason = readOnly ? "Viewers can't change agents." : undefined;
  const save = () =>
    start(async () => {
      setNote(undefined);
      const r = await saveSchedule({ agentId: agent.id, schedule: next });
      if (!r.ok) return setNote({ kind: "error", text: r.message });
      onSaved(r.schedule);
      setNote({ kind: "info", text: r.schedule ? `Saved: ${scheduleWords(r.schedule, viewerTz)}.` : "Saved: it starts on its trigger." });
    });
  const field = "flex flex-col gap-1 text-small font-semibold text-ink-2";
  return (
    <fieldset className="flex flex-col gap-2 rounded-card border border-line p-3">
      <legend className="flex items-center gap-2 px-1 text-small font-semibold text-ink-2">
        When it runs
        <SimTag title={SCHEDULE_SIM} />
      </legend>
      <label className={field}>
        Starts
        <Select
          id={`when-${agent.id}`}
          value={on ? "schedule" : "trigger"}
          aria-disabled={reason ? true : undefined}
          title={reason}
          onChange={(e) => !reason && setOn(e.target.value === "schedule")}
          wrapperClassName="self-start max-w-full"
        >
          <option value="trigger">{triggerChoice(trigger)}</option>
          <option value="schedule">On a schedule</option>
        </Select>
      </label>
      {on && (
        <div className="flex flex-wrap gap-2">
          <label className={field}>
            Days
            <Select value={draft.days} aria-disabled={reason ? true : undefined} title={reason} onChange={(e) => !reason && setDraft({ ...draft, days: e.target.value as ScheduleDays })}>
              {SCHEDULE_DAYS.map((d) => (
                <option key={d} value={d}>
                  {DAY_WORDS[d]}
                </option>
              ))}
            </Select>
          </label>
          <label className={field}>
            Time
            <input
              type="time"
              value={draft.time}
              readOnly={Boolean(reason)}
              onChange={(e) => e.target.value && setDraft({ ...draft, time: e.target.value })}
              className="min-h-8 rounded-full border border-line-ctl bg-surface px-3 text-body font-[550] text-ink tabular-nums"
            />
          </label>
          <label className={field}>
            Time zone
            <Select value={draft.tz} aria-disabled={reason ? true : undefined} title={reason} onChange={(e) => !reason && setDraft({ ...draft, tz: e.target.value })} wrapperClassName="max-w-full">
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z === viewerTz ? `Your time zone (${zoneWords(z).replace(/ time$/, "")})` : zoneWords(z).replace(/ time$/, "")}
                </option>
              ))}
            </Select>
          </label>
        </div>
      )}
      <p className="text-small text-ink-2">{on ? `Runs ${scheduleWords(draft, viewerTz).replace(/^\w/, (c) => c.toLowerCase())}. ` : ""}{SCHEDULE_SIM}</p>
      {!readOnly && (
        <Button size="sm" className="self-start" disabledReason={pending ? "Saving…" : changed ? undefined : "No changes to the schedule."} onClick={save}>
          {pending ? "Saving…" : "Save schedule"}
        </Button>
      )}
      {note && (
        <p role={note.kind === "error" ? "alert" : "status"} className={cn("text-small", note.kind === "error" ? "font-semibold text-failed" : "text-ink-2")}>
          {note.text}
        </p>
      )}
    </fieldset>
  );
}

function AgentNodeStatus({ agent, item }: { agent: AgentView; item: WorkspaceItem | undefined }) {
  const status = item?.status ?? agent.status;
  const model = shortModel(agent.model);
  if (status === "built" || status === "sample_data") return <span className="inline-flex items-center gap-1.5 text-small font-[650] text-works"><i className="block size-2 rounded-full bg-works" aria-hidden="true" />Works · {model}</span>;
  if (status === "building") return <span className="inline-flex items-center gap-1.5 text-small font-[650] text-building"><i className="block size-2 rounded-full bg-building" aria-hidden="true" />Being built · {model}</span>;
  if (status === "paused") return <span className="inline-flex items-center gap-1.5 text-small font-[650] text-ink"><Icon name="pause" size="sm" />Blocked · {model}</span>;
  if (status === "failed") return <span className="inline-flex items-center gap-1.5 text-small font-[650] text-failed"><i className="block size-2 rounded-full bg-failed" aria-hidden="true" />Failed · {model}</span>;
  return <span className="text-small text-ink-2">Not built yet · {model}</span>;
}

/** The graph (screen 9): trigger → agents with labelled hand-offs → delivery; tools and knowledge dashed. */
function Graph({
  data,
  drafts,
  items,
  selected,
  onSelect,
  connected,
  denied,
  viewerTz,
  onEditSchedule,
}: {
  data: AgentsData;
  drafts: Record<string, Draft>;
  items: WorkspaceItem[];
  selected: string | null;
  onSelect: (key: string) => void;
  connected: string[];
  denied: string[];
  viewerTz: string;
  onEditSchedule: () => void;
}) {
  const agents = data.agents.map((a) => ({ ...a, ...(drafts[a.id] ?? {}) }));
  const trigger = triggerFor(data.trigger, data.schedule, viewerTz);
  const layout = layoutGraph({ trigger, delivery: data.delivery, agents }, data.toolProviders);
  const [zoom, setZoom] = useState(1);
  const box = useRef<HTMLDivElement>(null);
  const fit = () => {
    const el = box.current;
    if (!el) return;
    setZoom(Math.max(0.4, Math.min(1.4, Math.min((el.clientWidth - 24) / layout.width, (el.clientHeight - 24) / layout.height))));
  };
  const byKey = new Map(items.map((i) => [i.key, i]));
  const describe = [
    `${trigger.label} ${trigger.title}${trigger.scheduled ? `, ${trigger.detail}` : ""}`,
    ...agents.map((a) => `${a.name}${a.tools.length ? `, uses ${a.tools.join(", ")}` : ""}${a.knowledge.length ? `, knows ${a.knowledge.join(", ")}` : ""}, ${a.handoff.toLowerCase()}`),
    `${data.delivery.label.toLowerCase()} ${data.delivery.title}`,
  ].join(". ");
  return (
    <div className="relative min-h-[420px] min-w-0 flex-1">
      <p id="agents-graph-description" className="sr-only">
        {describe}
      </p>
      <div
        ref={box}
        role="group"
        aria-label="How the agents connect"
        aria-describedby="agents-graph-description"
        className="absolute inset-0 overflow-auto rounded-card border border-line bg-tray [background-image:radial-gradient(var(--line-ctl)_.8px,transparent_.8px)] [background-size:20px_20px]"
      >
        <div style={{ width: layout.width * zoom, height: layout.height * zoom }}>
          <div className="relative origin-top-left" style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}>
            <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
              {layout.edges.map((e, i) => (
                <path key={`e${i}`} d={`M${e.from.x} ${e.from.y}V${e.to.y}`} className="fill-none stroke-ink-2 [stroke-width:1.5]" />
              ))}
              {layout.tools.map((t, i) => {
                const node = layout.main.find((m) => m.agentIndex === t.agentIndex)!;
                const sx = node.x + GRAPH.nodeW;
                const sy = node.y + 30;
                const ty = t.y + GRAPH.toolH / 2;
                const mid = (sx + t.x) / 2;
                return <path key={`t${i}`} d={`M${sx} ${sy}C${mid} ${sy} ${mid} ${ty} ${t.x} ${ty}`} className="fill-none stroke-line-ctl [stroke-dasharray:4_4] [stroke-width:1.5]" />;
              })}
            </svg>
            {layout.edges.map((e, i) => (
              <span
                key={`l${i}`}
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-line-ctl bg-surface px-2.5 py-0.5 text-small font-semibold whitespace-nowrap text-ink-2"
                style={{ left: e.from.x, top: (e.from.y + e.to.y) / 2 }}
              >
                {e.label}
              </span>
            ))}
            {layout.main.map((m) => {
              if (m.kind === "trigger") return <TriggerNode key={m.id} end={trigger} scheduled={trigger.scheduled} x={m.x} y={m.y} onEdit={onEditSchedule} />;
              if (m.kind === "delivery") return <EndNode key={m.id} end={data.delivery} x={m.x} y={m.y} />;
              const a = agents[m.agentIndex!];
              const on = selected === a.key;
              const origin = a.origin === "studio" ? "demo agent" : a.origin === "crewai" ? "CrewAI" : a.origin === "langgraph" ? "LangGraph" : "new";
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${a.name}: open its settings`}
                  onClick={() => onSelect(a.key)}
                  className={cn(
                    "absolute flex flex-col gap-1.5 rounded-[14px] border border-line bg-surface px-3.5 py-3 text-left text-ink shadow-[0_2px_8px_rgba(0,0,0,.06)] hover:border-line-ctl",
                    on && "shadow-[0_0_0_2px_var(--ink),0_6px_18px_rgba(0,0,0,.08)]",
                  )}
                  style={{ left: m.x, top: m.y, width: GRAPH.nodeW, minHeight: GRAPH.nodeH }}
                >
                  <span className="flex min-w-0 items-start gap-2.5">
                    <AgentGlyph role={agentRole(a.name, a.description)} size={34} />
                    <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="text-small font-semibold text-ink-3">AI agent · {origin}</span>
                      <strong className="truncate font-[650]">{a.name}</strong>
                      <AgentNodeStatus agent={a} item={byKey.get(a.key)} />
                    </span>
                  </span>
                </button>
              );
            })}
            {layout.tools.map((t, i) => {
              const owner = agents[t.agentIndex];
              const state = t.tool.provider;
              return (
                <button
                  key={`n${i}`}
                  type="button"
                  onClick={() => onSelect(owner.key)}
                  aria-label={`${t.tool.name}, ${t.tool.kind === "tool" ? "a tool" : "knowledge"} of ${owner.name}`}
                  className="absolute flex items-center truncate rounded-[14px] border border-dashed border-line-ctl bg-surface px-3 text-left text-small text-ink hover:bg-selected"
                  style={{ left: t.x, top: t.y, width: GRAPH.toolW, height: GRAPH.toolH }}
                >
                  <span className="truncate">
                    {/* "Brand voice · 3 docs" reads as "Brand voice · knowledge" here; the count is in the settings. */}
                    <b className="font-[650]">{t.tool.kind === "knowledge" ? t.tool.name.split(" · ")[0] : t.tool.name}</b> ·{" "}
                    {state ? <ToolState provider={state} connected={connected} denied={denied} /> : t.tool.kind === "tool" ? "tool" : "knowledge"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="absolute right-3 bottom-3 flex gap-1">
        <IconButton icon="minus" label="Zoom out" size={36} onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))} />
        <IconButton icon="plus" label="Zoom in" size={36} onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(2)))} />
        <IconButton icon="fit" label="Fit to screen" size={36} onClick={fit} />
      </div>
    </div>
  );
}

function ToolState({ provider, connected, denied }: { provider: string; connected: string[]; denied: string[] }) {
  if (denied.includes(provider)) return <span className="font-[650] text-approval">waiting for IT</span>;
  if (!connected.includes(provider)) return <span className="font-[650] text-attention">not connected</span>;
  return <>tool</>;
}

function CompareDialog({ open, onOpenChange, models, lyzrModel }: { open: boolean; onOpenChange: (o: boolean) => void; models: ProjectWorkspace["models"]; lyzrModel: string }) {
  // The estimator's price factors (DECISIONS: "Numbers we set").
  const factor: Record<ModelChoice, number> = { openrouter: 0.6, gemini: 0.8, claude: 1, gpt: 1, private: 0.8 };
  const speed: Record<ModelChoice, string> = { openrouter: "Slow, varies", gemini: "Fastest", claude: "Fast", gpt: "Fast", private: "Depends on your endpoint" };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[520px]">
        <DialogTitle className="text-sub font-semibold">Compare models</DialogTitle>
        <DialogDescription className="text-ink-2">Cost is relative to Claude Sonnet for the same agent run. Only the models your workspace allows are listed.</DialogDescription>
        <table className="mt-2 w-full text-left">
          <thead className="text-small text-ink-3">
            <tr>
              <th className="py-1.5 font-semibold">Model</th>
              <th className="py-1.5 font-semibold">Cost</th>
              <th className="py-1.5 font-semibold">Speed</th>
              <th className="py-1.5 font-semibold">Here</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.choice} className="border-t border-line">
                <td className="py-2 font-[550]">{m.label}</td>
                <td className="py-2 tabular-nums">{factor[m.choice].toFixed(1)}×</td>
                <td className="py-2">{speed[m.choice]}</td>
                <td className="py-2">{m.simulated ? <SimTag title="Answered by Gemini in this prototype" /> : "Real"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-small text-ink-2">Try it always runs on Lyzr Studio with {lyzrModel}, a small model for tests, whichever model is picked here.</p>
      </DialogContent>
    </Dialog>
  );
}

function AddMenu({ label, options, onPick, disabledReason, emptyNote }: { label: string; options: string[]; onPick: (v: string) => void; disabledReason?: string; emptyNote: string }) {
  if (disabledReason) return <Pill icon="plus" disabledReason={disabledReason}>{label}</Pill>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-transparent bg-(--btn) px-3 text-body font-[550] whitespace-nowrap text-ink hover:bg-(--btn-hover)">
        <Icon name="plus" size="sm" />
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-60 overflow-auto rounded-card border border-line bg-surface p-1.5 shadow-pop">
        {options.length ? (
          options.map((o) => (
            <DropdownMenuItem key={o} className="min-h-9 rounded-tile px-2.5" onSelect={() => onPick(o)}>
              {o}
            </DropdownMenuItem>
          ))
        ) : (
          <p className="px-2.5 py-2 text-small text-ink-2">{emptyNote}</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Chips({ values, onRemove, readOnly }: { values: string[]; onRemove: (v: string) => void; readOnly: boolean }) {
  return (
    <>
      {values.map((v) => (
        <span key={v} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-line bg-tray pr-1 pl-3 text-body font-[550]">
          {v}
          {!readOnly && (
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onRemove(v)} className="grid size-6 place-items-center rounded-full hover:bg-selected">
              <Icon name="close" size="sm" />
            </button>
          )}
        </span>
      ))}
    </>
  );
}

const RUN_LABEL = { crewai: "CrewAI", langgraph: "LangGraph" } as const;

/**
 * "How should this agent run?" for an agent imported in CrewAI or LangGraph (M5.5): keep it in its framework (the
 * default), convert it to a Lyzr Studio agent (the estimate shows first; then a real Studio agent is made from its
 * role and instructions), or wrap it as a tool. Each choice is saved and audited.
 */
function RunChoice({ agent, readOnly, onChanged }: { agent: AgentView; readOnly: boolean; onChanged: (fields: Partial<AgentView>) => void }) {
  const router = useRouter();
  const fw = RUN_LABEL[agent.importedFrom!];
  const [picked, setPicked] = useState<AgentView["runAs"]>(agent.runAs);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ kind: "error" | "info"; text: string }>();
  const apply = (runAs: AgentView["runAs"]) =>
    start(async () => {
      setNote(undefined);
      const r = await setAgentRun({ agentId: agent.id, runAs });
      if (!r.ok) return setNote({ kind: "error", text: r.message });
      onChanged({ runAs, framework: runAs === "studio" ? "lyzr" : agent.importedFrom!, lyzrAgentId: r.lyzrAgentId });
      setNote({ kind: "info", text: r.warning ?? (runAs === "studio" ? "Converted. It's a Lyzr Studio agent now, and its part's check is running again." : runAs === "tool" ? "Saved: other agents call it as a tool." : `Saved: it runs in ${fw}.`) });
      router.refresh();
    });
  const choices: { value: AgentView["runAs"]; label: string; about: string }[] = [
    { value: "native", label: `Keep in ${fw}`, about: "Runs natively behind the same agent interface. The default." },
    { value: "studio", label: "Convert to a Lyzr Studio agent", about: `A Studio agent made from its role and instructions. About ${CONVERT_CREDITS} credits: its check runs again.` },
    { value: "tool", label: "Wrap as a tool", about: "Other agents call it like any tool; its code stays as it is." },
  ];
  return (
    <div className="flex flex-col gap-2">
      <span id={`run-${agent.id}`} className="text-small font-semibold text-ink-2">
        How should this agent run?
      </span>
      <div role="radiogroup" aria-labelledby={`run-${agent.id}`} className="flex flex-col gap-1.5">
        {choices.map((c) => (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={picked === c.value}
            aria-disabled={readOnly || pending || undefined}
            title={readOnly ? "Viewers can't change agents." : undefined}
            onClick={() => {
              if (readOnly || pending) return;
              setPicked(c.value);
              setNote(undefined);
              // Keep and Wrap apply at once; Convert costs credits, so it waits for its own click below.
              if (c.value !== "studio" && c.value !== agent.runAs) apply(c.value);
            }}
            className={cn("flex flex-col rounded-tile border px-3 py-2 text-left", picked === c.value ? "border-[1.5px] border-ink" : "border-line hover:border-line-ctl")}
          >
            <span className="flex items-center gap-2 font-semibold">
              {c.label}
            </span>
            <span className="text-small text-ink-2">{c.about}</span>
          </button>
        ))}
      </div>
      {picked === "studio" && agent.runAs !== "studio" && (
        <div className="flex flex-col gap-1.5 rounded-tile bg-tray p-3">
          <p className="text-small">
            Converting makes a Lyzr Studio agent from <b>{agent.name}</b>&apos;s role and instructions, then runs its part&apos;s check again: about <b className="tabular-nums">{CONVERT_CREDITS} credits</b>. The {fw} code stays in the repo.
          </p>
          <Button size="sm" variant="primary" className="self-start" disabledReason={pending ? "Converting…" : undefined} onClick={() => apply("studio")}>
            Convert · ~{CONVERT_CREDITS} credits
          </Button>
        </div>
      )}
      {note && (
        <p role={note.kind === "error" ? "alert" : "status"} className={cn("text-small", note.kind === "error" ? "font-semibold text-failed" : "text-ink-2")}>
          {note.text}
        </p>
      )}
    </div>
  );
}

function SettingsTab({ agent, draft, setDraft, project, readOnly, lyzrModel, mcpServers, onRunChanged }: { agent: AgentView; draft: Draft; setDraft: (d: Draft) => void; project: ProjectWorkspace; readOnly: boolean; lyzrModel: string; mcpServers: AgentsData["mcpServers"]; onRunChanged: (fields: Partial<AgentView>) => void }) {
  const [more, setMore] = useState(false);
  const [compare, setCompare] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const reason = agent.demo ? "The demo agent is shared and read-only." : readOnly ? "Viewers can't change agents." : undefined;
  const modelAllowed = project.models.some((m) => m.choice === draft.model);
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <span className="text-small font-semibold text-ink-2">Model</span>
        <div className="flex flex-wrap items-center gap-2">
          {/* flex-none: the picker shows its full name ("Claude Sonnet"), never "C…" (M5.10). */}
          <div className="flex-none">
            <ModelPicker value={draft.model} options={project.models} onChange={(m) => setDraft({ ...draft, model: m })} disabledReason={reason} open={pickerOpen} onOpenChange={setPickerOpen} />
          </div>
          <Button size="sm" onClick={() => setCompare(true)}>
            Compare
          </Button>
        </div>
        {/* Studio agents run on Lyzr's built-in model whatever is picked here (M4 decision): say so, and why they differ. */}
        {agent.framework === "lyzr" && (
          <p className="text-small text-ink-2">
            {draft.model === "gemini"
              ? `In Lyzr Studio it runs on ${lyzrModel}, Lyzr's built-in model.`
              : `In Lyzr Studio it runs on ${lyzrModel}, Lyzr's built-in model, so test runs are free. ${MODEL_LABEL[draft.model]} is what the built app uses.`}
          </p>
        )}
        {!modelAllowed && !readOnly && <ModelNotAllowed onSwitch={() => setPickerOpen(true)} />}
      </div>
      <div className="flex flex-col gap-1.5">
        {agent.importedFrom ? (
          <RunChoice agent={agent} readOnly={readOnly} onChanged={onRunChanged} />
        ) : (
          <>
        <label htmlFor={`fw-${agent.id}`} className="flex items-center gap-2 text-small font-semibold text-ink-2">
          Runs on
        </label>
        <Select id={`fw-${agent.id}`} value={draft.framework ?? "lyzr"} aria-disabled={reason ? true : undefined} title={reason} onChange={(e) => !reason && setDraft({ ...draft, framework: e.target.value as Draft["framework"] })} wrapperClassName="self-start">
          <option value="lyzr">Lyzr Studio</option>
          <option value="crewai">CrewAI</option>
          <option value="langgraph">LangGraph</option>
        </Select>
          </>
        )}
        <TextLink onClick={() => setMore((v) => !v)} aria-expanded={more}>
          More model settings · creativity {draft.temperature.toFixed(1)}
        </TextLink>
        {more && (
          <div className="mt-1 flex flex-col gap-3 rounded-card border border-line bg-tray p-3">
            <label className="flex flex-col gap-1 text-small font-semibold text-ink-2">
              <span className="flex justify-between">
                Creativity (temperature)<span className="tabular-nums text-ink">{draft.temperature.toFixed(1)}</span>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={draft.temperature}
                disabled={readOnly}
                onChange={(e) => setDraft({ ...draft, temperature: Number(e.target.value) })}
                className="accent-[var(--ink)]"
              />
              <span className="font-normal">Lower is steadier; higher is more varied.</span>
            </label>
            <label className="flex flex-col gap-1 text-small font-semibold text-ink-2">
              Longest answer (max tokens)
              <input
                type="number"
                min={100}
                max={4000}
                step={50}
                value={draft.maxTokens}
                disabled={readOnly}
                onChange={(e) => setDraft({ ...draft, maxTokens: Math.max(100, Math.min(4000, Math.round(Number(e.target.value) || 100))) })}
                className="min-h-9 w-32 rounded-tile border border-line-ctl bg-surface px-3 text-body text-ink tabular-nums"
              />
            </label>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`ins-${agent.id}`} className="text-small font-semibold text-ink-2">
          Instructions
        </label>
        <textarea
          id={`ins-${agent.id}`}
          value={draft.instructions}
          readOnly={readOnly}
          onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
          rows={5}
          className="min-h-24 resize-y rounded-[12px] border border-line-ctl bg-surface px-3 py-2.5 text-body leading-normal text-ink"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-2 text-small font-semibold text-ink-2">
          Tools
        </span>
        <div className="flex flex-wrap gap-1.5">
          <Chips values={draft.tools} readOnly={readOnly} onRemove={(v) => setDraft({ ...draft, tools: draft.tools.filter((t) => t !== v) })} />
          <AddMenu
            label="Tool or MCP server"
            disabledReason={reason ?? (draft.tools.length >= 12 ? "Up to 12 tools per agent." : undefined)}
            options={toolCatalog(mcpServers).filter((t) => !draft.tools.includes(t))}
            emptyNote="Every tool is added."
            onPick={(t) => setDraft({ ...draft, tools: [...draft.tools, t] })}
          />
        </div>
        {/* Each MCP server on the agent, with the tools its last test found. Calling them is simulated. */}
        {mcpServers
          .filter((m) => draft.tools.includes(mcpToolLabel(m.name)))
          .map((m) => (
            <p key={m.name} className="text-small text-ink-2">
              {m.name}: {m.tools.length ? m.tools.join(", ") : "no tools listed"}. Calling them is simulated.
            </p>
          ))}
        {!mcpServers.length && (
          <p className="text-small text-ink-2">
            No MCP servers connected yet.{" "}
            <Link href="/connections#mcp" className="font-semibold text-ink underline decoration-line-ctl underline-offset-[3px]">
              Add one in Connections
            </Link>
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-2 text-small font-semibold text-ink-2">
          Knowledge
        </span>
        <div className="flex flex-wrap gap-1.5">
          <Chips values={draft.knowledge} readOnly={readOnly} onRemove={(v) => setDraft({ ...draft, knowledge: draft.knowledge.filter((k) => k !== v) })} />
          <AddMenu
            label="Add knowledge"
            disabledReason={reason ?? (draft.knowledge.length >= 12 ? "Up to 12 knowledge sources per agent." : undefined)}
            options={project.uploads.map((u) => u.name).filter((n) => !draft.knowledge.includes(n))}
            emptyNote="Add files in Plan first; they show here."
            onPick={(k) => setDraft({ ...draft, knowledge: [...draft.knowledge, k] })}
          />
        </div>
      </div>
      <CompareDialog open={compare} onOpenChange={setCompare} models={project.models} lyzrModel={lyzrModel} />
    </div>
  );
}

/** Opens the agent in Lyzr Studio, in a new tab (the prototype owner's Studio account). */
function StudioLink({ agentId }: { agentId: string }) {
  return (
    <a
      href={studioUrl(agentId)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-6 items-center gap-1 self-start text-body font-semibold text-ink underline decoration-line-ctl underline-offset-[3px] hover:decoration-ink"
    >
      Open in Studio
      <Icon name="external" size="sm" />
    </a>
  );
}

function RunRow({ run, defaultOpen }: { run: AgentRunView; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const real = run.runtime === "lyzr_agent" || run.runtime === "lyzr_shared";
  const when = new Date(run.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <li className="rounded-card border border-line bg-surface">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-2.5 p-3 text-left">
        <StatusMark status={run.status === "passed" ? "works" : "failed"} icon={run.status === "passed" ? undefined : "alert"} label={run.status === "passed" ? "Answered" : "Failed"} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-[650]">
            {run.runtime === "sample" ? (run.note ?? RUNTIME_WORDS.sample) : `Try it · ${RUNTIME_WORDS[run.runtime]}`}

          </span>
          <span className="text-small text-ink-2">
            {[when, run.modelLabel, seconds(run.durationMs)].filter(Boolean).join(" · ")}
          </span>
        </span>
        <Icon name={open ? "chevronDown" : "chevronRight"} size="sm" className="mt-1 text-ink-2" />
      </button>
      {open && (
        <div className="flex flex-col gap-2.5 border-t border-line px-3 py-3 text-body">
          <div>
            <h4 className="text-small font-semibold text-ink-2">Input</h4>
            <p className="whitespace-pre-wrap">{run.input || "No input saved."}</p>
          </div>
          <div>
            <h4 className="text-small font-semibold text-ink-2">Tool calls</h4>
            {run.toolCalls.length ? (
              <ul className="flex flex-col gap-1">
                {run.toolCalls.map((t, i) => (
                  <li key={i} className="font-mono text-small">
                    {t.name} · {t.detail}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-2">{real ? "None: tools are simulated, so Studio ran the instructions only." : "None."}</p>
            )}
          </div>
          <div>
            <h4 className="text-small font-semibold text-ink-2">Output</h4>
            <p className="whitespace-pre-wrap">{run.output}</p>
          </div>
          {real && run.studioAgentId && (
            <StudioLink agentId={run.studioAgentId} />
          )}
        </div>
      )}
    </li>
  );
}

function TryTab({ agent, dirty, lyzr, readOnly, onRan }: { agent: AgentView; dirty: boolean; lyzr: AgentsData["lyzr"]; readOnly: boolean; onRan: (r: { run: AgentRunView; lyzrAgentId: string | null; syncedAt: string | null }) => void }) {
  const [message, setMessage] = useState(agent.sample);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [last, setLast] = useState<AgentRunView | null>(null);
  const onStudio = agent.framework === "lyzr" && (agent.demo ? lyzr.demoReady : lyzr.connected);
  const run = () =>
    start(async () => {
      setError(undefined);
      const r = await tryAgent({ agentId: agent.id, message });
      if (!r.ok) return setError(r.message);
      setLast(r.run);
      onRan(r);
    });
  const reason = readOnly ? "Viewers can't run agents." : !message.trim() ? "Write a message first." : pending ? "Running…" : undefined;
  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={`try-${agent.id}`} className="flex items-center gap-2 text-small font-semibold text-ink-2">
        <AgentGlyph role={agentRole(agent.name, agent.description)} size={20} />
        Message to {agent.name}
      </label>
      <textarea
        id={`try-${agent.id}`}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={5}
        maxLength={4000}
        className="min-h-24 resize-y rounded-[12px] border border-line-ctl bg-surface px-3 py-2.5 text-body leading-normal text-ink"
      />
      <p className="text-small text-ink-2">
        {agent.demo && onStudio ? (
          <>
            The demo agent runs for real on Lyzr Studio, in Architect&apos;s own account, on {lyzr.model}. Up to 10 runs a day.
          </>
        ) : onStudio ? (
          <>
            Runs in your workspace&apos;s Lyzr Studio as its own agent, on {lyzr.model}. Test runs don&apos;t use credits.
          </>
        ) : agent.framework !== "lyzr" ? (
          <>
            {runtimeLine(agent.framework).text}. Here Gemini answers in its place.
          </>
        ) : (
          <>
            Gemini answers in its place until this workspace connects its Lyzr key.
          </>
        )}
        {dirty && " It uses the saved settings: save first to try your changes."}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="primary" icon="play" disabledReason={reason} onClick={run}>
          {pending ? "Running…" : onStudio ? "Run on Lyzr Studio" : "Run it"}
        </Button>
        {pending && <span className="text-small text-ink-2" role="status">Waiting for the answer…</span>}
      </div>
      {error && (
        <p role="alert" className="rounded-card border-[1.5px] border-failed px-3 py-2 font-semibold text-failed">
          {error}
        </p>
      )}
      {last && (
        <section aria-label="Answer" className="flex flex-col gap-2 rounded-card border border-line bg-tray p-3">
          <span className="flex flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2 text-small font-semibold text-ink">
              {RUNTIME_WORDS[last.runtime]}

            </span>
            <span className="text-small text-ink-2">{[last.modelLabel, seconds(last.durationMs), "saved to Runs"].filter(Boolean).join(" · ")}</span>
          </span>
          <p className="whitespace-pre-wrap text-body">{last.output}</p>
          {last.studioAgentId && last.runtime !== "gateway" && (
            <StudioLink agentId={last.studioAgentId} />
          )}
        </section>
      )}
    </div>
  );
}

function ChecksTab({ agent, item }: { agent: AgentView; item: WorkspaceItem | undefined }) {
  const [detail, setDetail] = useState<PartDetail | null | undefined>(undefined);
  const itemId = agent.itemId;
  useEffect(() => {
    if (!itemId) return;
    let stale = false;
    void loadPart({ itemId }).then((r) => !stale && setDetail(r.ok ? r.detail : null));
    return () => {
      stale = true;
    };
  }, [itemId, item?.status]);
  if (itemId && detail === undefined) return <p className="text-small text-ink-2" role="status">Loading its check…</p>;
  if (!detail?.check) {
    return (
      <div className="flex flex-col gap-1.5">
        <h4 className="font-[650]">Its check</h4>
        <p>{item?.provedWhen ?? "Written when the build starts."}</p>
        <p className="text-small text-ink-2">The checker writes the test for this before any code, when the build starts.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h4 className="font-[650]">Its check</h4>
        <p>{detail.check.description}</p>
        <p className="text-small text-ink-2">
          Written by the checker before the code, {new Date(detail.check.writtenAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.
        </p>
      </div>
      <ul className="flex flex-col gap-1.5">
        {detail.attempts.map((a, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <StatusMark status={a.result === "pass" ? "works" : "failed"} icon={a.result === "pass" ? undefined : "alert"} label={a.result === "pass" ? "Passed" : "Failed"} />
            <span className="flex flex-col">
              <span className="font-[550]">{a.attempt === 0 ? "First build" : `Fix ${a.attempt} of 3`}</span>
              <span className="text-small text-ink-2">{[a.summary, a.note].filter(Boolean).join(" · ")}</span>
            </span>
          </li>
        ))}
        {!detail.attempts.length && <li className="text-small text-ink-2">Not run yet.</li>}
      </ul>
    </div>
  );
}

/**
 * The agent panel's one Simulated label. Try it is real on Lyzr Studio (the workspace's own, or the demo agent);
 * tools, knowledge and checks never are. Without the workspace's key, the label says how to make it real (M5.10).
 */
function PanelSimTag({ agent, lyzr }: { agent: AgentView; lyzr: AgentsData["lyzr"] }) {
  if (agent.framework === "lyzr" && (agent.demo ? lyzr.demoReady : lyzr.connected)) {
    return <SimTag title="Try it runs for real on Lyzr Studio. Tools, knowledge, checks and the build are simulated in this prototype.">Partly simulated</SimTag>;
  }
  if (agent.framework === "lyzr") {
    return <SimTag title="Gemini answers Try it in this agent's place, and nothing is made in Lyzr Studio.">Simulated · connect your Lyzr key to make this real</SimTag>;
  }
  return <SimTag title="Gemini answers Try it in this agent's place; tools, knowledge, checks and the build are simulated in this prototype." />;
}

/** Open in Studio, enabled only for an agent with a Studio id; otherwise disabled with its reason (M5.10). */
function OpenInStudio({ id, reason }: { id: string | null; reason?: string }) {
  if (id && !reason) {
    return (
      <a href={studioUrl(id)} target="_blank" rel="noreferrer" className={buttonClasses({ size: "sm" })}>
        Open in Studio
        <Icon name="external" size="sm" />
      </a>
    );
  }
  return (
    <Button size="sm" iconAfter="external" disabledReason={reason ?? "It isn't in Lyzr Studio yet."}>
      Open in Studio
    </Button>
  );
}

/** Where the agent lives in Lyzr Studio (M5.10): the demo agent, not connected, waiting for its build, not there yet, or synced. */
function SyncLine({ agent, lyzr, canAct, onStudio }: { agent: AgentView; lyzr: AgentsData["lyzr"]; canAct: boolean; onStudio: (fields: Partial<AgentView>) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  if (agent.framework !== "lyzr") {
    return <span className="flex flex-1 flex-wrap items-center gap-2 text-small text-ink-2">{runtimeLine(agent.framework).text}</span>;
  }
  if (agent.demo) {
    return (
      <>
        <span className="flex-1 text-small text-ink-2">Demo agent · shared and read-only</span>
        <OpenInStudio id={null} reason="The demo agent lives in Architect's own Studio account. Connect your Lyzr key to make agents of your own." />
      </>
    );
  }
  if (!lyzr.connected) {
    return (
      <>
        <span className="flex-1 text-small text-ink-2">
          Not in Lyzr Studio ·{" "}
          <Link href="/connections#lyzr" className="font-semibold text-ink underline decoration-line-ctl underline-offset-[3px]">
            Connect your Lyzr key
          </Link>
        </span>
        <OpenInStudio id={null} reason="Connect your Lyzr key" />
      </>
    );
  }
  if (agent.lyzrAgentId) {
    return (
      <>
        <span className="flex-1 text-small text-ink-2">Synced with Lyzr Studio · {agent.syncedAt ? relativeTime(agent.syncedAt) : "just now"}</span>
        <OpenInStudio id={agent.lyzrAgentId} />
      </>
    );
  }
  if (!WORKS_STATUSES.includes(agent.status)) {
    return (
      <>
        <span className="flex-1 text-small text-ink-2">Created in Lyzr Studio when this part is built</span>
        <OpenInStudio id={null} reason="Created in Lyzr Studio when this part is built" />
      </>
    );
  }
  const retry = () =>
    start(async () => {
      setError(undefined);
      const r = await retryStudio({ agentId: agent.id });
      if (!r.ok) return setError(r.message);
      onStudio({ lyzrAgentId: r.lyzrAgentId, syncedAt: r.syncedAt, studioError: null });
    });
  return (
    <>
      <span className="flex-1 text-small text-ink-2" title={agent.studioError ?? undefined}>
        Not in Studio yet
      </span>
      {canAct && (
        <Button size="sm" disabledReason={pending ? "Retrying…" : undefined} onClick={retry}>
          {pending ? "Retrying…" : "Retry"}
        </Button>
      )}
      <OpenInStudio id={null} reason="Not in Studio yet: retry first." />
      {(error ?? agent.studioError) && (
        <p role={error ? "alert" : undefined} className="w-full text-small text-ink-2">
          {error ?? `Lyzr Studio said: ${agent.studioError}`}
        </p>
      )}
    </>
  );
}

/** A part's agent is made in Studio once the part works. */
const WORKS_STATUSES = ["built", "sample_data"];

function AgentPanel({
  agent,
  saved,
  draft,
  setDraft,
  runs,
  data,
  project,
  item,
  onClose,
  onSaved,
  onRan,
  onRunChanged,
  viewerTz,
  focusSchedule,
  onScheduleFocused,
  onScheduleSaved,
}: {
  viewerTz: string;
  /** Set when the graph's trigger was clicked: open Settings and focus the schedule. */
  focusSchedule: boolean;
  onScheduleFocused: () => void;
  onScheduleSaved: (s: Schedule | null) => void;
  onRunChanged: (fields: Partial<AgentView>) => void;
  agent: AgentView;
  saved: Draft;
  draft: Draft;
  setDraft: (d: Draft) => void;
  runs: AgentRunView[];
  data: AgentsData;
  project: ProjectWorkspace;
  item: WorkspaceItem | undefined;
  onClose: () => void;
  onSaved: (r: { syncedAt: string | null; lyzrAgentId: string | null }) => void;
  onRan: (r: { run: AgentRunView; lyzrAgentId: string | null; syncedAt: string | null }) => void;
}) {
  const [tab, setTab] = useState<Tab>("settings");
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ kind: "error" | "warning"; text: string }>();
  const readOnly = !canBuild(project.role) || agent.demo;
  const changes = changesBetween(saved, draft);
  const holdsSchedule = data.scheduleAgentId === agent.id;
  const before = data.agents[data.agents.findIndex((a) => a.id === agent.id) - 1];
  useEffect(() => {
    if (!focusSchedule) return;
    // Next frame: Settings shows, then its schedule takes focus.
    requestAnimationFrame(() => {
      setTab("settings");
      requestAnimationFrame(() => document.getElementById(`when-${agent.id}`)?.focus());
    });
    onScheduleFocused();
  }, [focusSchedule, agent.id, onScheduleFocused]);
  const save = () =>
    start(async () => {
      setNotice(undefined);
      const r = await saveAgent({ agentId: agent.id, ...draft });
      if (!r.ok) return setNotice({ kind: "error", text: r.message });
      if (r.warning) setNotice({ kind: "warning", text: r.warning });
      onSaved(r);
    });
  return (
    <aside aria-label={`${agent.name} settings`} className="flex min-h-0 w-[380px] flex-none flex-col rounded-card border border-line bg-surface max-lg:w-full">
      <div className="flex items-start gap-3 px-4 pt-3.5 pb-2">
        <AgentGlyph role={agentRole(agent.name, agent.description)} size={52} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="text-sub font-semibold">{agent.name}</h2>
          <span className="text-small text-ink-2">{agent.description}</span>
        </div>
        <IconButton icon="close" label="Close settings" quiet size={32} onClick={onClose} />
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-1">
        <SyncLine agent={agent} lyzr={data.lyzr} canAct={canBuild(project.role)} onStudio={onRunChanged} />
      </div>
      {/* One label for the panel (M5.9): what's real here depends on where the agent runs. */}
      <p className="flex flex-wrap items-center gap-2 px-4 pb-2.5 text-small text-ink-2">
        Runtime: {runtimeLine(agent.framework).text}
        <PanelSimTag agent={agent} lyzr={data.lyzr} />
      </p>
      <Segmented
        label="Agent"
        value={tab}
        onChange={setTab}
        className="mx-4 mb-1.5 self-start"
        options={[
          { value: "settings", label: "Settings" },
          { value: "runs", label: "Runs" },
          { value: "try", label: "Try it" },
          { value: "checks", label: "Checks" },
        ]}
      />
      <div role="tabpanel" aria-label={tab === "try" ? "Try it" : tab.charAt(0).toUpperCase() + tab.slice(1)} className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto px-4 py-2.5">
        {tab === "settings" &&
          (holdsSchedule ? (
            <ScheduleSection agent={agent} trigger={data.trigger} schedule={data.schedule} readOnly={!canBuild(project.role)} viewerTz={viewerTz} onSaved={onScheduleSaved} />
          ) : (
            before && <p className="text-small text-ink-2">Starts when {before.name} hands over.</p>
          ))}
        {tab === "settings" && <SettingsTab agent={agent} draft={draft} setDraft={setDraft} project={project} readOnly={readOnly} lyzrModel={data.lyzr.model} mcpServers={data.mcpServers} onRunChanged={onRunChanged} />}
        {tab === "runs" &&
          (runs.length ? (
            <ul className="flex flex-col gap-2" aria-label="Runs">
              {runs.map((r, i) => (
                <RunRow key={r.id} run={r} defaultOpen={i === 0 && r.runtime !== "sample"} />
              ))}
            </ul>
          ) : (
            <p className="text-ink-2">No runs yet. Use Try it to run the agent, or build the plan to run its check.</p>
          ))}
        {tab === "try" && <TryTab key={agent.id} agent={agent} dirty={changes > 0} lyzr={data.lyzr} readOnly={!canBuild(project.role)} onRan={onRan} />}
        {tab === "checks" && <ChecksTab agent={agent} item={item} />}
      </div>
      {notice && (
        <p role={notice.kind === "error" ? "alert" : "status"} className={cn("mx-4 mb-2 rounded-card border px-3 py-2 text-small font-semibold", notice.kind === "error" ? "border-failed text-failed" : "border-line text-ink")}>
          {notice.text}
        </p>
      )}
      {tab === "settings" && !readOnly && (
        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <span className="flex-1 text-small text-ink-2">{changes ? plural(changes, "unsaved change") : "All changes saved"}</span>
          <Button variant="quiet" size="sm" disabledReason={changes ? undefined : "Nothing to discard."} onClick={() => setDraft(saved)}>
            Discard
          </Button>
          <Button variant={changes ? "primary" : "secondary"} size="sm" disabledReason={pending ? "Saving…" : changes ? undefined : "No changes to save."} onClick={save}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}
    </aside>
  );
}

/** The Agents view (screen 9): the graph by default, and the selected agent's settings on the right. */
export function AgentsView({ project, items }: { project: ProjectWorkspace; items: WorkspaceItem[] }) {
  const { agentKey, openAgent, setAgentChanges, sendToChat } = useUi();
  const [data, setData] = useState<AgentsData | null>(null);
  const [error, setError] = useState<string>();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [focusSchedule, setFocusSchedule] = useState(false);
  const clearFocus = useCallback(() => setFocusSchedule(false), []);
  // Only read once the agents have loaded, in the browser.
  const viewerTz = useMemo(() => viewerTimeZone(), []);
  const version = project.plan?.version ?? 0;

  useEffect(() => {
    let stale = false;
    loadAgents({ projectId: project.id })
      .then((r) => {
        if (stale) return;
        if (r.ok) setData(r.data);
        else setError(r.message);
      })
      .catch((err: unknown) => !stale && setError(err instanceof Error ? err.message : "Something went wrong."));
    return () => {
      stale = true;
    };
  }, [project.id, version]);

  const total = data ? data.agents.reduce((n, a) => n + (drafts[a.id] ? changesBetween(draftOf(a), drafts[a.id]) : 0), 0) : 0;
  useEffect(() => {
    setAgentChanges(total);
  }, [total, setAgentChanges]);
  useEffect(() => () => setAgentChanges(0), [setAgentChanges]);

  if (error) return <EmptyState icon="agent" title="The agents couldn't load">{error} Reload the page to try again.</EmptyState>;
  if (!data) return <p role="status" className="p-6 text-ink-2">Loading the agents…</p>;
  if (!data.agents.length) {
    return (
      <EmptyState
        icon="agent"
        title="No agents in this plan"
        primary={
          canBuild(project.role) ? (
            <Button icon="plus" onClick={() => sendToChat("Add an agent that ")}>
              Ask for an agent
            </Button>
          ) : undefined
        }
      >
        This app works without AI agents: its parts are screens, data and the apps it connects to. To add one, ask in chat, for example &ldquo;Add an agent that drafts the invoice email&rdquo;. It shows here with its cost before anything is built.
      </EmptyState>
    );
  }
  const selected = data.agents.find((a) => a.key === agentKey) ?? null;
  const patch = (id: string, fields: Partial<AgentView>) => setData((d) => (d ? { ...d, agents: d.agents.map((a) => (a.id === id ? { ...a, ...fields } : a)) } : d));
  return (
    <div className="flex min-h-0 flex-1 gap-0 px-3 pb-3 max-lg:flex-col max-lg:gap-3">
      <Graph
        data={data}
        drafts={drafts}
        items={items}
        selected={agentKey}
        onSelect={openAgent}
        connected={project.connected}
        denied={project.denied}
        viewerTz={viewerTz}
        onEditSchedule={() => {
          const first = data.agents.find((a) => a.id === data.scheduleAgentId);
          if (!first) return;
          openAgent(first.key);
          setFocusSchedule(true);
        }}
      />
      {selected && (
        <AgentPanel
          key={selected.id}
          agent={selected}
          saved={draftOf(selected)}
          draft={drafts[selected.id] ?? draftOf(selected)}
          setDraft={(d) => setDrafts((all) => ({ ...all, [selected.id]: d }))}
          runs={data.runs[selected.id] ?? []}
          data={data}
          project={project}
          item={items.find((i) => i.key === selected.key)}
          onClose={() => openAgent(null)}
          onSaved={(r) => {
            const d = drafts[selected.id];
            patch(selected.id, { ...(d ?? {}), lyzrAgentId: r.lyzrAgentId, syncedAt: r.syncedAt });
            setDrafts((all) => {
              const next = { ...all };
              delete next[selected.id];
              return next;
            });
          }}
          onRunChanged={(fields) => patch(selected.id, fields)}
          viewerTz={viewerTz}
          focusSchedule={focusSchedule}
          onScheduleFocused={clearFocus}
          onScheduleSaved={(schedule) => setData((d) => (d ? { ...d, schedule } : d))}
          onRan={(r) => {
            patch(selected.id, { lyzrAgentId: r.lyzrAgentId, syncedAt: r.syncedAt });
            setData((d) => (d ? { ...d, runs: { ...d.runs, [selected.id]: [r.run, ...(d.runs[selected.id] ?? [])] } } : d));
          }}
        />
      )}
    </div>
  );
}
