import { z } from "zod";

/**
 * The Blueprint (the "plan" in the interface): the schema the model must fill (docs/build/BLUEPRINT-GENERATION.md).
 * Shared by the generator, the validator and the fixture tests. Prices are never part of it.
 */

/** Item classes drive the estimate (src/server/estimate.ts). */
export const ITEM_CLASSES = [
  "screen.list",
  "screen.detail",
  "screen.form",
  "integration.read_email",
  "integration.calendar",
  "integration.chat_send",
  "integration.crm_lookup",
  "agent.summariser",
  "agent.researcher",
  "data.table",
  "data.import",
  "quality.schedule",
] as const;
export type ItemClass = (typeof ITEM_CLASSES)[number];

export const GROUPS = ["features", "data", "integrations", "agents", "quality"] as const;
export type Group = (typeof GROUPS)[number];

export const Item = z.object({
  key: z.string().regex(/^[a-z0-9-]{3,40}$/), // stable id, e.g. "last-email-thread"
  grp: z.enum(GROUPS),
  title: z.string().max(60), // plain words, no jargon
  description: z.string().max(200),
  proved_when: z.string().max(160), // an observable, checkable condition
  source_quote: z.string().max(120), // exact words from the prompt it came from
  item_class: z.enum(ITEM_CLASSES),
  size: z.enum(["s", "m", "l"]),
  provider: z.string().optional(), // gmail, slack, hubspot… for integrations
  framework: z.enum(["lyzr", "crewai", "langgraph"]).optional(), // agents only; default lyzr
});
export type Item = z.infer<typeof Item>;

/**
 * What a question's recommended answer does to the parts the person asked for. The model labels it; the server
 * decides what blocks Build (questionBlocks): keep = no harm; reduce / remove = the default weakens or drops something
 * they asked for; none = there's no safe default at all.
 */
export const DEFAULT_EFFECTS = ["keep", "reduce", "remove", "none"] as const;
export type DefaultEffect = (typeof DEFAULT_EFFECTS)[number];

export const Question = z.object({
  text: z.string().max(120),
  affects: z.array(z.string()).min(1), // item keys
  options: z.array(z.object({ label: z.string(), value: z.string() })).min(2).max(4),
  recommended: z.string(), // one of options[].value, applied by default
  default_effect: z.enum(DEFAULT_EFFECTS),
  // Set by the server (applyQuestionRules), never by the model.
  blocking: z.boolean().optional(),
});
export type Question = z.infer<typeof Question>;

export const Default = z.object({ label: z.string(), value: z.string(), alternatives: z.array(z.string()) });
export type Default = z.infer<typeof Default>;

export const Blueprint = z.object({
  name: z.string().max(40),
  summary: z.string().max(240),
  items: z.array(Item).min(3).max(15),
  defaults: z.array(Default).max(6),
  questions: z.array(Question).max(5),
  not_in_this_version: z.array(z.object({ title: z.string(), reason: z.string() })).max(5),
});
export type Blueprint = z.infer<typeof Blueprint>;

/** Lowercase, curly-quote-free, whitespace-collapsed text, so quotes match the prompt fairly. */
export function normalizeForQuote(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Does the quoted phrase appear in the prompt (ignoring case, quote style, spacing and a trailing full stop)? */
export function quoteInPrompt(quote: string, prompt: string): boolean {
  const q = normalizeForQuote(quote).replace(/^["'.,;:]+|["'.,;:]+$/g, "");
  return q.length > 0 && normalizeForQuote(prompt).includes(q);
}

/**
 * The rules beyond the zod shape (BLUEPRINT-GENERATION step 4). Returns plain-English problems, empty when valid.
 * The problems are sent back to the model on the one retry, so they're written as instructions.
 */
export function validateBlueprint(bp: Blueprint, prompt: string): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  for (const item of bp.items) {
    if (keys.has(item.key)) problems.push(`Item key "${item.key}" is used twice; every key must be unique.`);
    keys.add(item.key);
    if (!item.proved_when.trim()) problems.push(`Item "${item.key}" needs a proved_when condition.`);
    if (!item.source_quote.trim()) problems.push(`Item "${item.key}" needs a source_quote from the request.`);
    else if (!quoteInPrompt(item.source_quote, prompt)) {
      problems.push(`Item "${item.key}" quotes "${item.source_quote}", which isn't in the request. Quote the exact words.`);
    }
  }
  bp.questions.forEach((q, i) => {
    const unknown = q.affects.filter((k) => !keys.has(k));
    if (unknown.length) problems.push(`Question ${i + 1} names items that don't exist: ${unknown.join(", ")}.`);
    if (!q.options.some((o) => o.value === q.recommended)) {
      problems.push(`Question ${i + 1}'s recommended answer "${q.recommended}" must be one of its option values.`);
    }
  });
  return problems;
}

/**
 * What the model is asked to fill: the same fields and choices as Blueprint, without length, pattern or count
 * limits. Gemini rejects a response schema with this many constraints ("Request contains an invalid argument"),
 * so the limits are enforced afterwards by Blueprint.safeParse + validateBlueprint, with one retry.
 */
export const BlueprintDraft = z.object({
  name: z.string(),
  summary: z.string(),
  items: z.array(
    z.object({
      key: z.string(),
      grp: z.enum(GROUPS),
      title: z.string(),
      description: z.string(),
      proved_when: z.string(),
      source_quote: z.string(),
      item_class: z.enum(ITEM_CLASSES),
      size: z.enum(["s", "m", "l"]),
      provider: z.string().optional(),
      framework: z.enum(["lyzr", "crewai", "langgraph"]).optional(),
    }),
  ),
  defaults: z.array(Default),
  questions: z.array(
    z.object({
      text: z.string(),
      affects: z.array(z.string()),
      options: z.array(z.object({ label: z.string(), value: z.string() })),
      recommended: z.string(),
      default_effect: z.enum(DEFAULT_EFFECTS),
    }),
  ),
  not_in_this_version: z.array(z.object({ title: z.string(), reason: z.string() })),
});

/** Strict check of a draft: the spec schema's problems, written as instructions for the retry. */
export function strictProblems(draft: unknown): { blueprint?: Blueprint; problems: string[] } {
  const parsed = Blueprint.safeParse(draft);
  if (parsed.success) return { blueprint: parsed.data, problems: [] };
  return {
    problems: parsed.error.issues.slice(0, 12).map((i) => `${i.path.join(".") || "plan"}: ${i.message}`),
  };
}

/** "Last Email Thread" / "last_email_thread" → "last-email-thread" (3–40 chars of a-z, 0-9 and hyphens). */
export function toKey(raw: string, fallback = "part"): string {
  let k = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  if (k.length < 3) k = `${fallback}-${k || "x"}`.slice(0, 40);
  return k;
}

type DraftShape = { items?: { key?: string; title?: string; source_quote?: string }[]; questions?: { affects?: string[] }[] };

/** A quote over 120 characters is cut at a word boundary: the start of a quote is still the person's exact words. */
export function shortenQuote(quote: string, max = 120): string {
  const q = quote.trim();
  if (q.length <= max) return q;
  const cut = q.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, "");
}

/**
 * Keys are internal ids, so the server tidies them instead of spending a retry: each becomes a valid, unique key,
 * and questions' "affects" follow the rename. Over-long quotes are shortened to their opening words (still exact).
 * Titles and descriptions are never changed.
 */
export function normalizeDraft<T extends DraftShape>(draft: T): T {
  const rename = new Map<string, string>();
  const used = new Set<string>();
  const items = (draft.items ?? []).map((item, i) => {
    let key = toKey(item.key || item.title || `part-${i + 1}`, `part-${i + 1}`);
    for (let n = 2; used.has(key); n++) key = toKey(`${key.slice(0, 36)}-${n}`);
    used.add(key);
    if (item.key) rename.set(item.key, key);
    return { ...item, key, ...(typeof item.source_quote === "string" ? { source_quote: shortenQuote(item.source_quote) } : {}) };
  });
  const questions = (draft.questions ?? []).map((q) => ({ ...q, affects: (q.affects ?? []).map((k) => rename.get(k) ?? toKey(k)) }));
  return { ...draft, items, questions };
}

const SLACK_WORKSPACE_Q = /slack/i;
const WORKSPACE_WORD = /workspace/i;

/** The server's rule (A-0, A-2): a default that reduces or removes something asked for, or no safe default, holds Build. */
export function questionBlocks(effect: DefaultEffect): boolean {
  return effect === "reduce" || effect === "remove" || effect === "none";
}

/**
 * Outbound channels that need their own service before anything can be sent (rule b). Slack has its own rule.
 * `asked`: the request asks to send this way. `about`: a question is about this channel's service.
 */
export const OUTBOUND_CHANNELS = [
  {
    id: "sms",
    name: "SMS",
    asked: /\bsms\b|\btext(?:s|ing)?\s+(?:message|messages|me|them|him|her|each|every|all|the|my|our|attendees?|customers?|people|reminders?)\b/i,
    about: /\bsms\b|\btext(?:ing)? messag|\btexts?\b/i,
    providers: ["twilio", "messagebird", "vonage", "sms"],
    options: [
      { label: "Twilio", value: "twilio" },
      { label: "MessageBird", value: "messagebird" },
      { label: "Another SMS service", value: "other" },
    ],
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    asked: /\bwhatsapp\b/i,
    about: /\bwhatsapp\b/i,
    providers: ["whatsapp", "twilio_whatsapp"],
    options: [
      { label: "WhatsApp Business through Twilio", value: "twilio" },
      { label: "Meta WhatsApp Cloud", value: "meta" },
      { label: "Another WhatsApp service", value: "other" },
    ],
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    asked: /\bmicrosoft teams\b|\bms teams\b|\bteams (?:message|messages|channel|chat|post)s?\b|\bon teams\b|\bin teams\b|\bto teams\b/i,
    about: /\bmicrosoft teams\b|\bteams (?:workspace|channel|tenant|organi[sz]ation)\b/i,
    providers: ["microsoft_teams", "teams"],
    options: [
      { label: "Your Microsoft 365 organisation", value: "connected" },
      { label: "Another organisation", value: "other" },
    ],
  },
  {
    id: "discord",
    name: "Discord",
    asked: /\bdiscord\b/i,
    about: /\bdiscord\b/i,
    providers: ["discord"],
    options: [
      { label: "A Discord server you connect", value: "connected" },
      { label: "Another server", value: "other" },
    ],
  },
  {
    id: "telegram",
    name: "Telegram",
    asked: /\btelegram\b/i,
    about: /\btelegram\b/i,
    providers: ["telegram"],
    options: [
      { label: "A Telegram bot you connect", value: "connected" },
      { label: "Another bot", value: "other" },
    ],
  },
] as const;

/**
 * Kinds of service a question can ask about (rule a). `words` say the request names that kind ("my calendar",
 * "HubSpot leads"); `providers` are the matching Connections. Outbound channels are excluded: they follow rule b.
 */
const SERVICE_KINDS = [
  { id: "calendar", question: /\bcalendar\b/i, words: /\bcalendars?\b|\bmeetings?\b|google calendar|outlook/i, providers: ["google_calendar", "outlook_calendar"] },
  { id: "email", question: /\be-?mail\b|\binbox\b|\bgmail\b|\boutlook\b/i, words: /\be-?mails?\b|\binbox\b|\bgmail\b|\boutlook\b/i, providers: ["gmail", "outlook"] },
  { id: "crm", question: /\bcrm\b|\bhubspot\b|\bsalesforce\b/i, words: /\bcrm\b|\bhubspot\b|\bsalesforce\b|\bleads?\b/i, providers: ["hubspot", "salesforce"] },
  { id: "tickets", question: /\bticket(?:ing)?\b|\bzendesk\b|\bfreshdesk\b|\bhelp ?desk\b/i, words: /\btickets?\b|\bzendesk\b|\bfreshdesk\b/i, providers: ["zendesk", "freshdesk"] },
  { id: "files", question: /\b(?:google )?drive\b|\bnotion\b|\bdropbox\b|\bstorage\b/i, words: /\bdrive\b|\bnotion\b|\bdropbox\b|\bpdfs?\b|\bdocuments?\b/i, providers: ["drive", "google_drive", "notion", "dropbox"] },
  { id: "chat", question: /\b(?:communication|notification|messaging) channel\b|\bchat\b|\bslack\b/i, words: /\bslack\b|#[a-z0-9]/i, providers: ["slack"] },
] as const;

export type QuestionContext = {
  /** Providers connected in this workspace's Connections (e.g. "google_calendar", "slack"). */
  connected?: string[];
};

/**
 * Decides which questions hold Build. The model only labels each question's default_effect; the server decides:
 * 1. Slack workspace: blocks only when the request asks for Slack and names no channel (no safe default).
 * 2. Outbound channels (rule b): if the request asks to send by SMS, WhatsApp, Teams, Discord or Telegram and that
 *    service isn't connected, a "Which … service?" question blocks: the model's own if it asked one, otherwise added.
 * 3. Every other question blocks when labelled reduce, remove or none (questionBlocks), unless it asks about a kind
 *    of service the request already names or Connections already has (rule a): then the plan can use that one.
 */
export function applyQuestionRules(bp: Blueprint, prompt: string, ctx: QuestionContext = {}): Blueprint {
  const connected = new Set((ctx.connected ?? []).map((p) => p.toLowerCase()));
  const slackItems = bp.items.filter((i) => i.provider?.toLowerCase() === "slack" || (i.item_class === "integration.chat_send" && /slack/i.test(`${i.title} ${i.description} ${i.source_quote}`)));
  const isWorkspaceQ = (q: Question) => SLACK_WORKSPACE_Q.test(q.text) && WORKSPACE_WORD.test(q.text);
  const channelOf = (q: Question) => OUTBOUND_CHANNELS.find((c) => c.about.test(q.text) || q.options.some((o) => c.about.test(o.label)));

  const needed = OUTBOUND_CHANNELS.filter((c) => c.asked.test(prompt) && !c.providers.some((p) => connected.has(p)));
  const decided: Question[] = [];
  const added: Question[] = [];
  let slackQ: Question | undefined;

  for (const q of bp.questions) {
    if (isWorkspaceQ(q)) {
      slackQ = q;
      continue;
    }
    const channel = channelOf(q);
    if (channel) {
      const blocks = needed.some((n) => n.id === channel.id);
      decided.push({ ...q, default_effect: blocks ? "none" : "keep", blocking: blocks });
      continue;
    }
    const kind = SERVICE_KINDS.find((k) => k.question.test(q.text));
    const settled = kind && (kind.words.test(prompt) || kind.providers.some((p) => connected.has(p)));
    decided.push({ ...q, blocking: questionBlocks(q.default_effect) && !settled });
  }

  // Rule b: a requested channel that isn't connected and that no question covers gets one.
  for (const c of needed) {
    if (decided.some((q) => channelOf(q)?.id === c.id)) continue;
    const affected = bp.items.filter((i) => c.about.test(`${i.title} ${i.description} ${i.source_quote} ${i.provider ?? ""}`));
    const fallback = affected.length ? affected : bp.items.filter((i) => i.grp === "integrations");
    added.push({
      text: `Which ${c.name} service should send these messages?`,
      affects: (fallback.length ? fallback : bp.items.slice(0, 1)).map((i) => i.key),
      options: c.options.map((o) => ({ ...o })),
      recommended: c.options[0].value,
      default_effect: "none",
      blocking: true,
    });
  }

  // Rule 1: the Slack workspace.
  const slackAsked = slackItems.length > 0 && /\bslack\b/i.test(prompt);
  const channelNamed = /(^|\s)#[a-z0-9][\w-]*/i.test(prompt);
  let slack: Question | undefined;
  if (slackAsked && !channelNamed) {
    slack = slackQ
      ? { ...slackQ, default_effect: "none", blocking: true }
      : {
          text: "Which Slack workspace should this post to?",
          affects: slackItems.map((i) => i.key),
          options: [
            { label: "The workspace you connected", value: "connected" },
            { label: "Another workspace", value: "other" },
          ],
          recommended: "connected",
          default_effect: "none",
          blocking: true,
        };
  } else if (slackQ) {
    slack = { ...slackQ, default_effect: "keep", blocking: false };
  }

  // At most 5 questions, the blocking ones first (the server-added ones are never dropped).
  const all = [...(slack ? [slack] : []), ...added, ...decided];
  const ordered = [...all.filter((q) => q.blocking), ...all.filter((q) => !q.blocking)];
  return { ...bp, questions: ordered.slice(0, 5) };
}
