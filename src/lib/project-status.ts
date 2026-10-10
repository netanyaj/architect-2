import type { IconName } from "@/components/ax/icon";
import type { Status, StatusIcon } from "@/components/ax/status-mark";

/** What Home and Projects need to say about one project: where it is and the next thing to do. */
export type ProjectInput = {
  status: "draft" | "building" | "paused" | "built" | "live";
  budgetCredits: number | null;
  items: { status: string; title: string; grp: string }[];
  /** Latest run, if any. */
  runStatus?: string | null;
  prompt?: string | null;
  /** An Architect 1.0 app (F9): it keeps running as it is until someone moves it to 2.0. */
  legacy?: { movedTo: string | null } | null;
};

export type ProjectSummary = {
  /** Parts that count toward readiness (not set aside or dropped). */
  total: number;
  works: number;
  /** "Live · 12 of 12 parts work", "Paused at its 100-credit budget" */
  meta: string;
  /** The status with its next action: "Needs you: connect Gmail". */
  next: { status: Status; icon?: StatusIcon; text: string };
  /** Something only a person can unblock (Home's "Continue" list, the Needs you filter). */
  needsYou: boolean;
  filter: "live" | "draft" | "other";
};

const PROVIDERS: [RegExp, string][] = [
  [/\bcalendar\b/i, "Calendar"],
  [/\bgmail\b|\bemail/i, "Gmail"],
  [/\bslack\b|#\w+/i, "Slack"],
  [/\bhubspot\b/i, "HubSpot"],
  [/\bzendesk\b|\btickets?\b/i, "Zendesk"],
  [/\bnotion\b/i, "Notion"],
  [/\bdrive\b/i, "Drive"],
  [/\bxero\b/i, "Xero"],
];

/** Tools a project uses, read from its prompt and part titles (order as first seen in PROVIDERS). */
export function detectTools(texts: (string | null | undefined)[]): string[] {
  const all = texts.filter(Boolean).join(" ");
  return PROVIDERS.filter(([re]) => re.test(all)).map(([, name]) => name);
}

/** The provider a "needs connection" part waits on, for "Needs you: connect Gmail". */
function providerOf(title: string): string {
  return detectTools([title])[0] ?? "an app";
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function summarizeProject(p: ProjectInput): ProjectSummary {
  if (p.legacy) {
    return {
      total: 0,
      works: 0,
      meta: "Architect 1.0 · keeps running as it is",
      next: p.legacy.movedTo ? { status: "works", text: `Moved to 2.0 as ${p.legacy.movedTo}` } : { status: "todo", text: "Move to 2.0" },
      needsYou: false,
      filter: "live",
    };
  }
  const counted = p.items.filter((i) => i.status !== "deferred" && i.status !== "dropped");
  const total = counted.length;
  const works = counted.filter((i) => i.status === "built").length;
  const progress = `${works} of ${total} parts work`;

  const needsConnection = counted.find((i) => i.status === "needs_connection");
  const needsApproval = counted.find((i) => i.status === "needs_approval");
  const blockedPart = counted.find((i) => i.status === "paused");
  const pausedAtBudget = p.status === "paused" && (p.runStatus === "paused_budget" || !blockedPart);

  if (pausedAtBudget) {
    return {
      total,
      works,
      meta: p.budgetCredits ? `Paused at its ${p.budgetCredits}-credit budget` : `Paused · ${progress}`,
      next: { status: "blocked", icon: "pause", text: "Blocked: raise budget" },
      needsYou: true,
      filter: "other",
    };
  }
  if (blockedPart) {
    return {
      total,
      works,
      meta: `Paused · ${progress}`,
      next: { status: "blocked", icon: "pause", text: `Blocked: ${blockedPart.title}` },
      needsYou: true,
      filter: "other",
    };
  }
  if (needsConnection) {
    return {
      total,
      works,
      meta: `${p.status === "live" ? "Live" : p.status === "building" ? "Building" : "Ready"} · ${progress}`,
      next: { status: "attention", icon: "plug", text: `Needs you: connect ${providerOf(needsConnection.title)}` },
      needsYou: true,
      filter: p.status === "live" ? "live" : "other",
    };
  }
  if (needsApproval) {
    return {
      total,
      works,
      meta: `${p.status === "live" ? "Live" : "Ready"} · ${progress}`,
      next: { status: "approval", icon: "lock", text: "Waiting for IT approval" },
      needsYou: true,
      filter: p.status === "live" ? "live" : "other",
    };
  }
  switch (p.status) {
    case "live":
      return { total, works, meta: `Live · ${progress}`, next: { status: "works", text: "Live" }, needsYou: false, filter: "live" };
    case "building":
      return {
        total,
        works,
        meta: `Building · ${progress}`,
        next: { status: "building", text: "Building now" },
        needsYou: false,
        filter: "other",
      };
    case "built":
      return { total, works, meta: `Ready · ${progress}`, next: { status: "todo", text: "Ready to launch" }, needsYou: false, filter: "other" };
    default:
      return {
        total,
        works,
        meta: total ? `Plan ready · ${plural(total, "part")}` : "No plan yet",
        next: { status: "todo", text: total ? "Plan ready, not built" : "Write the plan" },
        needsYou: false,
        filter: "draft",
      };
  }
}

/** Tile icons a project may use (stored in projects.icon). */
export function projectIcon(icon: string | null | undefined): IconName {
  const allowed: IconName[] = ["calendar", "lines", "usage", "doc", "window", "chat", "search", "person", "projects", "repo"];
  return allowed.includes(icon as IconName) ? (icon as IconName) : "projects";
}

/** "2 h ago", "yesterday", "Monday", "last week", "12 Sep" */
export function relativeTime(iso: string, now = new Date()): string {
  const then = new Date(iso);
  const mins = Math.round((now.getTime() - then.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(then.getFullYear(), then.getMonth(), then.getDate())) / 86400000);
  if (days <= 1) return "yesterday";
  if (days < 7) return then.toLocaleDateString("en-GB", { weekday: "long" });
  if (days < 14) return "last week";
  return then.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
