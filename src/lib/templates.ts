import type { IconName } from "@/components/ax/icon";

/** Starting points for Home and the Templates and prompts dialog (screen 15). Picking one fills the prompt. */
export type Starter = {
  id: string;
  kind: "Template" | "Agentlet" | "Prompt";
  icon: IconName;
  name: string;
  description: string;
  tools: string[];
  /** Typical build cost, shown as "~N credits". Estimates only; the plan gives the real figure. */
  credits?: number;
  team: "Sales" | "Support" | "Ops" | "HR" | "Finance";
  prompt: string;
};

export const STARTERS: Starter[] = [
  {
    id: "meeting-briefs",
    kind: "Template",
    icon: "window",
    name: "Meeting briefs",
    description: "Attendees, last emails and talking points before each meeting.",
    tools: ["Calendar", "Gmail", "Slack"],
    credits: 160,
    team: "Ops",
    prompt:
      "Before each meeting on my calendar, send me a Slack brief with each attendee's last email thread, a summary of any attached agenda PDF, and three talking points.",
  },
  {
    id: "account-research",
    kind: "Template",
    icon: "search",
    name: "Account research",
    description: "A one-page brief on any company from your CRM and the web.",
    tools: ["HubSpot", "Web search"],
    credits: 120,
    team: "Sales",
    prompt:
      "When I type a company name, write a one-page brief from HubSpot and the web: what they do, recent news, who we know there, and open deals.",
  },
  {
    id: "ask-your-documents",
    kind: "Template",
    icon: "doc",
    name: "Ask your documents",
    description: "Answers from your PDFs and wiki, with the source for each.",
    tools: ["Drive", "Notion"],
    credits: 90,
    team: "Ops",
    prompt: "Answer questions from our Drive PDFs and Notion wiki, and show the source document and page for every answer.",
  },
  {
    id: "support-triage",
    kind: "Agentlet",
    icon: "chat",
    name: "Support triage",
    description: "Sorts tickets by urgency and drafts replies for simple ones.",
    tools: ["Zendesk", "Slack"],
    credits: 140,
    team: "Support",
    prompt:
      "Classify incoming Zendesk tickets by urgency and team, draft a reply for simple ones, and escalate anything from VIP customers.",
  },
  {
    id: "candidate-screening",
    kind: "Agentlet",
    icon: "person",
    name: "Candidate screening",
    description: "Scores CVs against the role and suggests interview questions.",
    tools: ["Drive"],
    credits: 110,
    team: "HR",
    prompt:
      "Score each CV in our Drive hiring folder against the job description from 0 to 100, explain the score, and suggest three interview questions.",
  },
  {
    id: "spend-report",
    kind: "Template",
    icon: "usage",
    name: "Spend report",
    description: "Reads invoices and flags anything over budget each week.",
    tools: ["Gmail", "Xero"],
    credits: 130,
    team: "Finance",
    prompt:
      "Every Monday, read last week's invoices from Gmail and Xero, total spend by team, and flag anything over its monthly budget.",
  },
  {
    id: "lead-scorer",
    kind: "Prompt",
    icon: "usage",
    name: "Score new leads",
    description: "Morning lead scores with a reason, top 5 posted to Slack.",
    tools: ["HubSpot", "Slack"],
    team: "Sales",
    prompt:
      "Every morning, score new HubSpot leads from 0 to 100 using company size and recent activity, explain each score, and post the top 5 to #sales.",
  },
  {
    id: "friday-recap",
    kind: "Prompt",
    icon: "calendar",
    name: "Friday recap",
    description: "A summary of the week's meetings and follow-ups.",
    tools: ["Calendar", "Slack"],
    team: "Ops",
    prompt: "Every Friday at 4pm, send me a Slack recap of this week's meetings, with decisions and follow-ups for each.",
  },
  {
    id: "vendor-renewals",
    kind: "Prompt",
    icon: "doc",
    name: "Vendor renewals",
    description: "Never miss a renewal date again.",
    tools: ["Slack"],
    team: "Finance",
    prompt: "Keep a list of our vendors with renewal dates and remind me in Slack 30 days before each renewal.",
  },
];

export function matchesStarter(s: Starter, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [s.name, s.description, s.team, ...s.tools].some((t) => t.toLowerCase().includes(q));
}
