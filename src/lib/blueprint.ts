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

export const Question = z.object({
  text: z.string().max(120),
  affects: z.array(z.string()).min(1), // item keys
  options: z.array(z.object({ label: z.string(), value: z.string() })).min(2).max(4),
  recommended: z.string(), // one of options[].value, applied by default
  // true ONLY if the default would remove or weaken a requested item, or no safe default exists
  blocking: z.boolean(),
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
      blocking: z.boolean(),
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

type DraftShape = { items?: { key?: string; title?: string }[]; questions?: { affects?: string[] }[] };

/**
 * Keys are internal ids, so the server tidies them instead of spending a retry: each becomes a valid, unique key,
 * and questions' "affects" follow the rename. Nothing a person reads (titles, quotes, descriptions) is changed.
 */
export function normalizeDraft<T extends DraftShape>(draft: T): T {
  const rename = new Map<string, string>();
  const used = new Set<string>();
  const items = (draft.items ?? []).map((item, i) => {
    let key = toKey(item.key || item.title || `part-${i + 1}`, `part-${i + 1}`);
    for (let n = 2; used.has(key); n++) key = toKey(`${key.slice(0, 36)}-${n}`);
    used.add(key);
    if (item.key) rename.set(item.key, key);
    return { ...item, key };
  });
  const questions = (draft.questions ?? []).map((q) => ({ ...q, affects: (q.affects ?? []).map((k) => rename.get(k) ?? toKey(k)) }));
  return { ...draft, items, questions };
}

const SLACK_WORKSPACE_Q = /slack/i;
const WORKSPACE_WORD = /workspace/i;

/**
 * Deterministic question rules applied after generation, so the plan doesn't depend on the model's mood:
 * - Posting to Slack needs a workspace. If the request names a channel ("#sales"), the destination is settled and
 *   any workspace question is just a default. If it doesn't ("send me a Slack brief"), there's no safe default, so
 *   exactly one blocking "Which Slack workspace?" question holds Build (A-0, A-2).
 */
export function applyQuestionRules(bp: Blueprint, prompt: string): Blueprint {
  const slackItems = bp.items.filter((i) => i.provider?.toLowerCase() === "slack" || (i.item_class === "integration.chat_send" && /slack/i.test(`${i.title} ${i.description} ${i.source_quote}`)));
  const isWorkspaceQ = (q: Question) => SLACK_WORKSPACE_Q.test(q.text) && WORKSPACE_WORD.test(q.text);
  const others = bp.questions.filter((q) => !isWorkspaceQ(q));
  const existing = bp.questions.find(isWorkspaceQ);

  if (slackItems.length === 0) return bp;
  const channelNamed = /(^|\s)#[a-z0-9][\w-]*/i.test(prompt);
  if (channelNamed) {
    return { ...bp, questions: [...others, ...(existing ? [{ ...existing, blocking: false }] : [])] };
  }
  const question: Question = existing
    ? { ...existing, blocking: true }
    : {
        text: "Which Slack workspace should this post to?",
        affects: slackItems.map((i) => i.key),
        options: [
          { label: "The workspace you connected", value: "connected" },
          { label: "Another workspace", value: "other" },
        ],
        recommended: "connected",
        blocking: true,
      };
  // Keep within the 5-question limit, with the blocking one first.
  return { ...bp, questions: [question, ...others].slice(0, 5) };
}
