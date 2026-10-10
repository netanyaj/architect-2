import { describe, expect, it } from "vitest";
import { agentGraph, changesBetween, defaultInstructions, GRAPH, layoutGraph, runtimeLine, type PlanPart } from "@/lib/agents";

const part = (p: Partial<PlanPart> & Pick<PlanPart, "key" | "title" | "grp">, position: number): PlanPart => ({
  description: null,
  provedWhen: `Done when ${p.title.toLowerCase()} passes its check`,
  status: "agreed",
  provider: null,
  position,
  ...p,
});

// The seeded ticket-triage plan (migration 0002), with services on its integration parts.
const triage: PlanPart[] = [
  part({ key: "new-tickets-read", title: "New tickets read", grp: "integrations", provider: "zendesk" }, 1),
  part({ key: "urgency", title: "Urgency and team label", grp: "agents", description: "Labels each ticket by urgency and team" }, 2),
  part({ key: "draft", title: "Draft reply for simple tickets", grp: "agents" }, 3),
  part({ key: "vip", title: "VIP escalation", grp: "features" }, 4),
  part({ key: "slack", title: "Slack alert to the team", grp: "integrations", provider: "slack" }, 5),
  part({ key: "deploy", title: "Production deploy", grp: "quality" }, 6),
];

describe("agentGraph: any plan", () => {
  it("starts from the service it reads, runs the agent parts in order, and delivers where it sends", () => {
    const g = agentGraph({ projectName: "ticket-triage", prompt: "Classify Zendesk tickets", parts: triage, uploads: [] });
    expect(g.sample).toBe(false);
    expect(g.trigger).toEqual({ label: "Starts when", title: "Zendesk", detail: "New tickets read", edge: "New ticket" });
    expect(g.delivery).toMatchObject({ label: "Delivers to", title: "Slack", detail: "Slack alert to the team" });
    expect(g.agents.map((a) => [a.name, a.handoff])).toEqual([
      ["Urgency and team label", "Hands over urgency and team label"],
      ["Draft reply for simple tickets", "Posts to Slack"],
    ]);
    expect(g.agents.every((a) => a.origin === "new")).toBe(true);
    // Try it starts from a sample of what the trigger's service sends.
    expect(g.agents[0].sample).toMatch(/^New ticket from/);
  });

  it("gives other services to the agent that comes after them, and the project's files as knowledge", () => {
    const parts = [
      part({ key: "leads", title: "New HubSpot leads read", grp: "integrations", provider: "hubspot" }, 1),
      part({ key: "gmail", title: "Last email per lead", grp: "integrations", provider: "gmail" }, 2),
      part({ key: "score", title: "Score from 0 to 100", grp: "agents" }, 3),
      part({ key: "reason", title: "Reason for each score", grp: "agents" }, 4),
      part({ key: "post", title: "Top 5 posted to #sales", grp: "integrations", provider: "slack" }, 5),
    ];
    const g = agentGraph({ projectName: "Lead scorer", prompt: null, parts, uploads: ["pricing.pdf", "icp.md"] });
    expect(g.agents[0].tools).toEqual(["Gmail"]);
    expect(g.agents[1].tools).toEqual([]);
    // A PDF is a knowledge base; other files aren't.
    expect(g.agents[0].knowledge).toEqual(["Knowledge base · pricing.pdf"]);
    expect(g.toolProviders).toEqual({ Gmail: "gmail" });
  });

  it("parts without a service (seeded plans): the service is read from their words, and Try it gets its sample", () => {
    const parts = triage.map((p) => ({ ...p, provider: null }));
    const g = agentGraph({ projectName: "ticket-triage", prompt: null, parts, uploads: [] });
    expect(g.trigger).toMatchObject({ title: "Zendesk", detail: "New tickets read", edge: "New ticket" });
    expect(g.delivery).toMatchObject({ title: "Slack", detail: "Slack alert to the team" });
    expect(g.agents[0].sample).toMatch(/^New ticket from Priya Shah/);
  });

  it("without services: a schedule or a person starts it, and results show in the app", () => {
    const daily = agentGraph({
      projectName: "Digest",
      prompt: "Every morning summarise the vendor list",
      parts: [part({ key: "sum", title: "Vendor summary", grp: "agents" }, 1), part({ key: "sched", title: "Daily schedule", grp: "features" }, 2)],
      uploads: [],
    });
    expect(daily.trigger).toMatchObject({ title: "On a schedule", detail: "Daily schedule" });
    expect(daily.delivery).toMatchObject({ title: "The app's screen" });
    expect(daily.agents[0].sample).toContain("Every morning summarise the vendor list");

    const plain = agentGraph({ projectName: "Notes", prompt: null, parts: [part({ key: "a", title: "Summariser", grp: "agents" }, 1)], uploads: [] });
    expect(plain.trigger.title).toBe("Someone uses the app");
  });

  it("leaves out parts that were set aside or dropped", () => {
    const parts = triage.map((p) => (p.key === "draft" ? { ...p, status: "dropped" } : p));
    expect(agentGraph({ projectName: "t", prompt: null, parts, uploads: [] }).agents.map((a) => a.key)).toEqual(["urgency"]);
  });

  it("a plan with no agent parts has no agents", () => {
    expect(agentGraph({ projectName: "Form", prompt: null, parts: [part({ key: "f", title: "Form", grp: "features" }, 1)], uploads: [] }).agents).toEqual([]);
  });
});

describe("agentGraph: the seeded Meeting Prep keeps its sample agents (screen 9)", () => {
  const meetingPrep = [
    "Calendar events read:integrations",
    "Last email thread per attendee:integrations",
    "Agenda PDF summarised:agents",
    "Talking points:agents",
    "Brief before each meeting:features",
    "Slack delivery:integrations",
    "Brief writer:agents",
    "Research agent (yours):agents",
  ].map((s, i) => {
    const [title, grp] = s.split(":");
    return part({ key: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), title, grp, status: "built" }, i + 1);
  });

  it("two agents: the Research agent reused from Studio, then the Brief writer", () => {
    const g = agentGraph({ projectName: "Meeting Prep", prompt: null, parts: meetingPrep, uploads: [] });
    expect(g.sample).toBe(true);
    expect(g.agents.map((a) => [a.name, a.origin, a.handoff])).toEqual([
      ["Research agent", "studio", "Hands over findings"],
      ["Brief writer", "new", "Sends the brief"],
    ]);
    expect(g.trigger).toMatchObject({ title: "Google Calendar", detail: "30 min before each meeting", edge: "Meeting coming up" });
    expect(g.agents[1].instructions).toContain("Stay under 200 words");
  });

  it("only the project named Meeting Prep; any other plan is derived from its parts", () => {
    expect(agentGraph({ projectName: "Meeting Prep copy", prompt: null, parts: meetingPrep, uploads: [] }).sample).toBe(false);
  });
});

describe("defaultInstructions, runtimeLine, changesBetween", () => {
  it("instructions come from the part and must pass its check", () => {
    expect(defaultInstructions({ title: "Talking points", description: "Three talking points per meeting", provedWhen: "Done when it lists exactly 3 points" })).toBe(
      "Three talking points per meeting. Your answer must pass this check: done when it lists exactly 3 points. Be concise. If something you need is missing, say what is missing instead of guessing.",
    );
  });

  it("app agents run on Lyzr Studio; imported CrewAI and LangGraph agents are Simulated", () => {
    expect(runtimeLine("lyzr")).toEqual({ text: "Lyzr Studio", simulated: false });
    expect(runtimeLine("crewai")).toEqual({ text: "CrewAI · runs natively behind the agent interface", simulated: true });
    expect(runtimeLine("langgraph").simulated).toBe(true);
  });

  it("counts each changed setting once", () => {
    const saved = { model: "gemini" as const, temperature: 0.3, maxTokens: 800, instructions: "Write a brief.", tools: ["Gmail"], knowledge: [] };
    expect(changesBetween(saved, { ...saved, instructions: "Write a brief.  " })).toBe(0);
    expect(changesBetween(saved, { ...saved, model: "claude", tools: ["Gmail", "Web search"] })).toBe(2);
  });
});

describe("layoutGraph", () => {
  it("stacks trigger, agents and delivery with a labelled hand-off between each, tools to the right", () => {
    const g = agentGraph({ projectName: "ticket-triage", prompt: null, parts: triage, uploads: [] });
    const l = layoutGraph(g, g.toolProviders);
    expect(l.main.map((m) => m.kind)).toEqual(["trigger", "agent", "agent", "delivery"]);
    expect(l.edges.map((e) => e.label)).toEqual(["New ticket", "Hands over urgency and team label", "Posts to Slack"]);
    for (let i = 1; i < l.main.length; i++) expect(l.main[i].y).toBeGreaterThanOrEqual(l.main[i - 1].y + GRAPH.nodeH + GRAPH.gap);
  });

  it("an agent with many tools gets room so its tools don't run into the next agent's", () => {
    const agents = [
      { tools: ["A", "B", "C", "D", "E"], knowledge: ["K"], handoff: "Hands over" },
      { tools: ["F"], knowledge: [], handoff: "Sends" },
    ];
    const l = layoutGraph({ trigger: { label: "Starts when", title: "t", detail: "", edge: "go" }, delivery: { label: "Delivers to", title: "d", detail: "", edge: "out" }, agents }, {});
    const firstAgentTools = l.tools.filter((t) => t.agentIndex === 0);
    const second = l.main.find((m) => m.agentIndex === 1)!;
    expect(firstAgentTools).toHaveLength(6);
    expect(second.y).toBeGreaterThan(firstAgentTools[5].y + GRAPH.toolH);
  });
});
