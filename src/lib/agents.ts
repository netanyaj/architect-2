/**
 * The Agents view (screen 9), built from each plan's own parts. Shared by client and server; no I/O.
 * - The graph: what starts the app, its agent parts in plan order with labelled hand-offs, where it delivers,
 *   and each agent's tools and knowledge (drawn dashed).
 * - Default settings for an agent the first time it's opened: instructions from the part and its check.
 * The seeded Meeting Prep project keeps its sample agents (screen 9); every other plan is derived here.
 */
import type { ModelChoice } from "./models";
import { providerName } from "./providers";
import { scheduleFromText, scheduleWords, type Schedule } from "./schedule";
import { usesMeetingPrepSample } from "./sim/preview";

export type PlanPart = {
  key: string;
  title: string;
  description: string | null;
  provedWhen: string;
  grp: string;
  status: string;
  provider: string | null;
  position: number;
};

export type GraphEnd = { label: "Starts when" | "Delivers to"; title: string; detail: string; edge: string };

/** A tool or knowledge source drawn dashed beside its agent. `provider` lets the view show Connect or Waiting for IT. */
export type GraphTool = { name: string; kind: "tool" | "knowledge"; provider: string | null };

export type AgentOrigin = "new" | "studio" | "crewai" | "langgraph";

export type AgentDefaults = {
  key: string;
  name: string;
  description: string;
  instructions: string;
  /** What it hands over, in plain words (Studio's "expected output"). */
  output: string;
  tools: string[];
  knowledge: string[];
  origin: AgentOrigin;
  /** The label on the hand-off after this agent. */
  handoff: string;
  /** A message to try it with. */
  sample: string;
};

export type AgentGraphSpec = {
  trigger: GraphEnd;
  agents: AgentDefaults[];
  delivery: GraphEnd;
  /** Tool name → service, for every tool the plan's parts name. */
  toolProviders: Record<string, string>;
  sample: boolean;
  /** When the plan says it runs on a schedule ("Daily schedule"): that schedule, read from its words. Null otherwise. */
  schedule: Schedule | null;
};

const INACTIVE = new Set(["deferred", "dropped"]);
const READS = /\b(read|reads|new|incoming|events?|each|every|watch|arrives?|received|lookup|look-up|fetch)\b/i;
const SENDS = /\b(send|sends|sent|post|posted|posts|alert|deliver|delivery|notify|message|reply|replies|email to|dm)\b/i;
const SCHEDULE = /\b(every|daily|morning|weekly|schedule|before each|hourly)\b/i;

const clip = (s: string, n = 34) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…`);
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const sentence = (s: string) => {
  const t = s.trim();
  return t ? (/[.!?]$/.test(t) ? t : `${t}.`) : t;
};

/** What a part sends when there's a sample for its service (Try it starts from this). */
const SAMPLE_BY_PROVIDER: Record<string, string> = {
  zendesk:
    'New ticket from Nina Shah (VIP, Northwind): "Our export has failed three times since this morning and the board pack is due at 4pm. Please help."',
  hubspot: "New lead: Dana Ortiz, Head of Operations at Brightline Logistics (420 employees). Opened 3 pricing emails this week and booked a demo.",
  google_calendar: "Meeting at 14:00 today: Renewal check-in with Dana Ortiz and Sam Lee (Acme). Agenda: usage review, pricing for year two, open support tickets.",
  gmail: 'Email from Dana Ortiz: "Can we move the renewal call to Thursday and include our finance lead? We have questions on year-two pricing."',
  slack: 'Message in #support: "Customers in the EU are seeing slow page loads since the last release. Anyone looking at this?"',
  github: "New pull request #142: Add retry to the export job. 3 files changed, +48 −12. CI passed.",
};

/** A service named in a part's words, for plans whose parts don't carry one (older and seeded plans). */
const SERVICE_WORDS: [RegExp, string][] = [
  [/\bzendesk\b|\btickets?\b/i, "zendesk"],
  [/\bhubspot\b|\bleads?\b/i, "hubspot"],
  [/\bcalendar\b|\bmeetings?\b/i, "google_calendar"],
  [/\bgmail\b|\bemails?\b|\binbox\b/i, "gmail"],
  [/\bslack\b|#[a-z0-9-]+/i, "slack"],
  [/\bgithub\b|\bpull requests?\b/i, "github"],
];
export function serviceIn(text: string): string | null {
  return SERVICE_WORDS.find(([re]) => re.test(text))?.[1] ?? null;
}

/** The hand-off from the trigger, by service ("Meeting coming up" on screen 9). */
const ARRIVES: Record<string, string> = {
  zendesk: "New ticket",
  hubspot: "New lead",
  google_calendar: "Meeting coming up",
  gmail: "New email",
  slack: "New message",
  github: "New pull request",
};
/** The last hand-off, into the delivery. */
const DELIVERS: Record<string, string> = { slack: "Posts to Slack", gmail: "Sends the email", zendesk: "Sends the reply", hubspot: "Updates HubSpot", github: "Comments on GitHub" };

/** Default instructions for an agent part: what it does, the check it must pass, and the house rules. */
export function defaultInstructions(part: Pick<PlanPart, "title" | "description" | "provedWhen">): string {
  return [
    sentence(part.description || part.title),
    `Your answer must pass this check: ${sentence(lowerFirst(part.provedWhen))}`,
    "Be concise. If something you need is missing, say what is missing instead of guessing.",
  ].join(" ");
}

function endFromPart(label: GraphEnd["label"], part: PlanPart, provider: string | null): GraphEnd {
  const edge = label === "Starts when" ? ((provider && ARRIVES[provider]) ?? "Something new arrives") : ((provider && DELIVERS[provider]) ?? "Sends the result");
  return provider
    ? { label, title: providerName(provider), detail: part.title, edge }
    : { label, title: part.title, detail: part.description ? clip(part.description, 48) : "", edge };
}

/** The Meeting Prep sample (screen 9): two agents, the Research agent reused from Studio. */
function meetingPrepSample(parts: PlanPart[]): AgentGraphSpec | null {
  const find = (re: RegExp) => parts.find((p) => p.grp === "agents" && re.test(p.title) && !INACTIVE.has(p.status));
  const research = find(/^research agent/i);
  const writer = find(/^brief writer/i);
  if (!research || !writer) return null;
  const meeting = SAMPLE_BY_PROVIDER.google_calendar;
  return {
    sample: true,
    schedule: null,
    trigger: { label: "Starts when", title: "Google Calendar", detail: "30 min before each meeting", edge: "Meeting coming up" },
    delivery: { label: "Delivers to", title: "Slack message", detail: "To you", edge: "Sends the brief" },
    toolProviders: { Gmail: "gmail", HubSpot: "hubspot" },
    agents: [
      {
        key: research.key,
        name: "Research agent",
        description: "Finds each attendee's last email thread and their company.",
        instructions:
          "For each attendee, find their last email thread with us and their company. Hand over who they are, what we last discussed, and anything still open. Use only what you find; say when something is missing.",
        output: "One short paragraph per attendee: who they are, the last thread, what's open.",
        tools: ["Gmail", "HubSpot"],
        knowledge: [],
        origin: "studio",
        handoff: "Hands over findings",
        sample: meeting,
      },
      {
        key: writer.key,
        name: "Brief writer",
        description: "Writes the brief from threads, agenda and notes.",
        instructions:
          "Write a brief for the meeting. Name every attendee. Use their last email thread and the agenda. End with three talking points. Stay under 200 words.",
        output: "A brief under 200 words that ends with three talking points.",
        tools: ["PDF summariser"],
        knowledge: ["Brand voice · 3 docs"],
        origin: "new",
        handoff: "Sends the brief",
        sample: `${meeting} Last thread with Dana: she asked for a usage report and flagged two slow support tickets.`,
      },
    ],
  };
}

/** The graph for any plan: its agent parts in order, what starts them, where they deliver, and their tools. */
export function agentGraph(input: { projectName: string; prompt: string | null; parts: PlanPart[]; uploads: string[] }): AgentGraphSpec {
  const parts = [...input.parts].filter((p) => !INACTIVE.has(p.status)).sort((a, b) => a.position - b.position);
  if (usesMeetingPrepSample(input.projectName)) {
    const sample = meetingPrepSample(parts);
    if (sample) return sample;
  }
  const agents = parts.filter((p) => p.grp === "agents");
  const integrations = parts.filter((p) => p.grp === "integrations");

  const triggerPart = integrations.find((p) => READS.test(p.title) && !SENDS.test(p.title)) ?? integrations.find((p) => !SENDS.test(p.title));
  const deliveryPart = [...integrations].reverse().find((p) => p !== triggerPart && SENDS.test(`${p.title} ${p.description ?? ""}`));
  const schedule = parts.find((p) => (p.grp === "features" || p.grp === "quality") && SCHEDULE.test(p.title));
  const triggerService = triggerPart ? (triggerPart.provider ?? serviceIn(`${triggerPart.title} ${triggerPart.description ?? ""}`)) : null;
  const deliveryService = deliveryPart ? (deliveryPart.provider ?? serviceIn(`${deliveryPart.title} ${deliveryPart.description ?? ""}`)) : null;
  const trigger: GraphEnd = triggerPart
    ? endFromPart("Starts when", triggerPart, triggerService)
    : schedule
      ? { label: "Starts when", title: "On a schedule", detail: schedule.title, edge: "Time to run" }
      : { label: "Starts when", title: "Someone uses the app", detail: `From ${input.projectName}'s screen`, edge: "A request comes in" };
  const delivery: GraphEnd = deliveryPart
    ? endFromPart("Delivers to", deliveryPart, deliveryService)
    : { label: "Delivers to", title: "The app's screen", detail: "Results show in the app", edge: "Shows the result" };

  // Services the agents use: every other integration part, given to the agent that comes after it in the plan
  // (or the last agent). The trigger's and delivery's services are the graph's ends, not tools.
  const toolProviders: Record<string, string> = {};
  const toolsFor = new Map<string, string[]>(agents.map((a) => [a.key, []]));
  for (const p of integrations) {
    if (p === triggerPart || p === deliveryPart || !agents.length) continue;
    const name = p.provider ? providerName(p.provider) : clip(p.title, 28);
    if (p.provider) toolProviders[name] = p.provider;
    const owner = agents.find((a) => a.position > p.position) ?? agents[agents.length - 1];
    const list = toolsFor.get(owner.key)!;
    if (!list.includes(name)) list.push(name);
  }
  // Try it starts from a sample of what the trigger's service sends, or one named in the request.
  const sampleService = triggerService ?? (input.prompt ? serviceIn(input.prompt) : null);
  const sampleFrom = (sampleService && SAMPLE_BY_PROVIDER[sampleService]) || null;
  return {
    sample: false,
    schedule: schedule && !triggerPart ? (scheduleFromText(`${schedule.title} ${schedule.description ?? ""} ${schedule.provedWhen}`) ?? { days: "daily", time: "09:00", tz: "" }) : null,
    trigger,
    delivery,
    toolProviders,
    agents: agents.map((a, i) => {
      const next = agents[i + 1];
      return {
        key: a.key,
        name: a.title,
        description: sentence(a.description || a.title),
        instructions: defaultInstructions(a),
        output: `Plain text that passes this check: ${lowerFirst(a.provedWhen)}`,
        tools: toolsFor.get(a.key) ?? [],
        // A PDF is a knowledge base the first agent searches; a CSV belongs to its data analyst (its own agent part).
        knowledge: i === 0 ? input.uploads.filter((u) => /\.pdf$/i.test(u)).map((u) => `Knowledge base · ${u}`) : [],
        origin: "new",
        handoff: next ? clip(`Hands over ${lowerFirst(a.title)}`) : delivery.edge,
        sample:
          sampleFrom ??
          (input.prompt ? `A sample request for this app (${input.projectName}): ${input.prompt}` : `A sample request for ${a.title.toLowerCase()}.`),
      };
    }),
  };
}

/**
 * The graph's first node once a schedule is set (round 7): "On a schedule · Weekdays at 8:00, your time zone".
 * Without one, the trigger the plan implies.
 */
export function triggerFor(trigger: GraphEnd, schedule: Schedule | null, viewerTz?: string): GraphEnd & { scheduled: boolean } {
  // A plan's schedule part, switched off: someone starts it from the app instead.
  if (!schedule && trigger.title === "On a schedule") return { label: "Starts when", title: "Someone uses the app", detail: "From the app's screen", edge: "A request comes in", scheduled: false };
  if (!schedule) return { ...trigger, scheduled: false };
  return { label: "Starts when", title: "On a schedule", detail: scheduleWords(schedule, viewerTz), edge: "Time to run", scheduled: true };
}

/** The "start on its trigger" choice in the schedule editor: "New ticket in Zendesk", "When someone uses the app". */
export function triggerChoice(trigger: GraphEnd): string {
  if (trigger.title === "On a schedule" || trigger.title === "Someone uses the app") return "When someone uses the app";
  return `${trigger.edge} in ${trigger.title}`;
}

/** Where an agent runs, in plain words (B-6, BL-8). Imported CrewAI and LangGraph agents are Simulated. */
export function runtimeLine(framework: string): { text: string; simulated: boolean } {
  if (framework === "crewai") return { text: "CrewAI · runs natively behind the agent interface", simulated: true };
  if (framework === "langgraph") return { text: "LangGraph · runs natively behind the agent interface", simulated: true };
  return { text: "Lyzr Studio", simulated: false };
}

/** A Studio agent's page (the owner's Lyzr account). */
export function studioUrl(agentId: string): string {
  return `https://studio.lyzr.ai/agent-create/${encodeURIComponent(agentId)}`;
}

/** Positions for the graph (screen 9): the main column on the left, tools to its right. Pixels. */
export const GRAPH = { left: 40, top: 30, nodeW: 220, nodeH: 88, gap: 72, toolX: 330, toolW: 190, toolH: 38, toolGap: 16 } as const;

export type LaidOutGraph = {
  main: { id: string; kind: "trigger" | "agent" | "delivery"; x: number; y: number; agentIndex?: number }[];
  edges: { from: { x: number; y: number }; to: { x: number; y: number }; label: string }[];
  tools: { agentIndex: number; tool: GraphTool; x: number; y: number }[];
  width: number;
  height: number;
};

/** Lays the graph out top to bottom; an agent with many tools gets more room below it. */
export function layoutGraph(spec: { trigger: GraphEnd; delivery: GraphEnd; agents: { tools: string[]; knowledge: string[]; handoff: string }[] }, providers: Record<string, string>): LaidOutGraph {
  const g = GRAPH;
  const cx = g.left + g.nodeW / 2;
  const main: LaidOutGraph["main"] = [];
  const edges: LaidOutGraph["edges"] = [];
  const tools: LaidOutGraph["tools"] = [];
  let y: number = g.top;
  main.push({ id: "trigger", kind: "trigger", x: g.left, y });
  let label = spec.trigger.edge;
  spec.agents.forEach((a, i) => {
    const prevBottom = y + g.nodeH;
    y = prevBottom + g.gap;
    edges.push({ from: { x: cx, y: prevBottom }, to: { x: cx, y }, label });
    main.push({ id: `agent-${i}`, kind: "agent", x: g.left, y, agentIndex: i });
    const list: GraphTool[] = [
      ...a.tools.map((name) => ({ name, kind: "tool" as const, provider: providers[name] ?? null })),
      ...a.knowledge.map((name) => ({ name, kind: "knowledge" as const, provider: null })),
    ];
    list.forEach((tool, t) => tools.push({ agentIndex: i, tool, x: g.toolX, y: y + 12 + t * (g.toolH + g.toolGap) }));
    // Room for this agent's tools before the next node.
    const toolsBottom = list.length ? y + 12 + list.length * (g.toolH + g.toolGap) - g.toolGap : y;
    y = Math.max(y, toolsBottom - g.nodeH);
    label = a.handoff;
  });
  const prevBottom = y + g.nodeH;
  y = prevBottom + g.gap;
  if (!spec.agents.length) label = spec.delivery.edge;
  edges.push({ from: { x: cx, y: prevBottom }, to: { x: cx, y }, label: spec.agents.length ? spec.agents[spec.agents.length - 1].handoff : label });
  main.push({ id: "delivery", kind: "delivery", x: g.left, y });
  return { main, edges, tools, width: g.toolX + g.toolW + g.left, height: y + g.nodeH + g.top };
}

/** The settings a person can change on an agent (Settings tab). */
/** Where an agent runs (B-6): Lyzr Studio, or natively in CrewAI or LangGraph behind the same agent interface. */
export type AgentFramework = "lyzr" | "crewai" | "langgraph";
export type AgentDraft = { model: ModelChoice; temperature: number; maxTokens: number; instructions: string; tools: string[]; knowledge: string[]; framework?: AgentFramework };

/** How many settings differ from what's saved ("2 unsaved changes"). */
export function changesBetween(saved: AgentDraft, draft: AgentDraft): number {
  return (
    Number(saved.model !== draft.model) +
    Number(saved.temperature !== draft.temperature) +
    Number(saved.maxTokens !== draft.maxTokens) +
    Number(saved.instructions.trim() !== draft.instructions.trim()) +
    Number(saved.tools.join("\n") !== draft.tools.join("\n")) +
    Number(saved.knowledge.join("\n") !== draft.knowledge.join("\n")) +
    Number((saved.framework ?? "lyzr") !== (draft.framework ?? "lyzr"))
  );
}


/** What converting an imported agent to Lyzr Studio costs: its part's check runs again on the Studio agent (M5.5). */
export const CONVERT_CREDITS = 3;
