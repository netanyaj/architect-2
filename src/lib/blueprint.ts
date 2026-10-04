import { z } from "zod";

/**
 * The Blueprint (the "plan" in the interface): the schema the model must fill (docs/BLUEPRINT-GENERATION.md).
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
 * Decides which questions hold Build. The model only labels each question's default_effect; the server decides:
 * - Every question blocks when its effect is reduce, remove or none (questionBlocks).
 * - The Slack workspace is decided here, whatever the label: when the request asks for Slack and names no channel
 *   ("send me a Slack brief") there's no safe default, so exactly one "Which Slack workspace?" question blocks. A named
 *   channel ("#sales") settles it, and Slack the planner chose on its own is a default; then it doesn't block.
 */
export function applyQuestionRules(bp: Blueprint, prompt: string): Blueprint {
  const slackItems = bp.items.filter((i) => i.provider?.toLowerCase() === "slack" || (i.item_class === "integration.chat_send" && /slack/i.test(`${i.title} ${i.description} ${i.source_quote}`)));
  const isWorkspaceQ = (q: Question) => SLACK_WORKSPACE_Q.test(q.text) && WORKSPACE_WORD.test(q.text);
  const others = bp.questions.filter((q) => !isWorkspaceQ(q)).map((q) => ({ ...q, blocking: questionBlocks(q.default_effect) }));
  const existing = bp.questions.find(isWorkspaceQ);

  const slackAsked = slackItems.length > 0 && /\bslack\b/i.test(prompt);
  const channelNamed = /(^|\s)#[a-z0-9][\w-]*/i.test(prompt);
  if (!slackAsked || channelNamed) {
    return { ...bp, questions: [...others, ...(existing ? [{ ...existing, default_effect: "keep" as const, blocking: false }] : [])] };
  }
  const question: Question = existing
    ? { ...existing, default_effect: "none", blocking: true }
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
  // Keep within the 5-question limit, with the blocking one first.
  return { ...bp, questions: [question, ...others].slice(0, 5) };
}
