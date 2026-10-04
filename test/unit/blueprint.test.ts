import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyQuestionRules,
  Blueprint,
  normalizeDraft,
  quoteInPrompt,
  shortenQuote,
  strictProblems,
  toKey,
  validateBlueprint,
  type Blueprint as BlueprintT,
} from "@/lib/blueprint";
import { toModelChoice } from "@/lib/models";
import { CLASS_TABLE, draftingCredits, estimate, totals } from "@/server/estimate";
import { checkFixture } from "../fixtures/check-fixture";
import { DEMO_PROMPTS, promptText } from "../fixtures/demo-prompts";

const FIXTURES = join(__dirname, "..", "fixtures", "blueprints");
const recorded = readdirSync(FIXTURES).filter((f) => f.endsWith(".json"));

/* ---------- the 3 demo prompts: recorded real model output (RECORD=1 pnpm eval:blueprint) ---------- */

describe("fixture plans for the 3 demo prompts", () => {
  it("has a recorded plan for each demo prompt", () => {
    for (const { id } of DEMO_PROMPTS) expect(recorded.some((f) => f.startsWith(`${id}.`)), `missing fixture for ${id}`).toBe(true);
  });

  for (const file of recorded) {
    const id = file.split(".")[0];
    const demo = DEMO_PROMPTS.find((d) => d.id === id)!;
    it(`${file}: valid schema, quotes from the prompt, blocking only where expected`, () => {
      checkFixture(JSON.parse(readFileSync(join(FIXTURES, file), "utf8")), promptText(id), demo.blocking);
    });
  }
});

/* ---------- validation ---------- */

const PROMPT = promptText("meeting-prep");
const base = (): BlueprintT =>
  Blueprint.parse({
    name: "Meeting Prep",
    summary: "A Slack brief before every meeting.",
    items: [
      { key: "calendar-read", grp: "integrations", title: "Meetings on your calendar", description: "d", proved_when: "p", source_quote: "each meeting on my calendar", item_class: "integration.calendar", size: "m" },
      { key: "slack-brief", grp: "integrations", title: "Brief in Slack", description: "d", proved_when: "p", source_quote: "send me a Slack brief", item_class: "integration.chat_send", size: "m", provider: "slack" },
      { key: "talking-points", grp: "agents", title: "Three talking points", description: "d", proved_when: "p", source_quote: "three talking points", item_class: "agent.summariser", size: "m" },
    ],
    defaults: [],
    questions: [],
    not_in_this_version: [],
  });

describe("quoteInPrompt", () => {
  it("matches ignoring case, curly quotes, spacing and trailing punctuation", () => {
    expect(quoteInPrompt("Each attendee’s last email thread", PROMPT)).toBe(true);
    expect(quoteInPrompt("three  talking points.", PROMPT)).toBe(true);
    expect(quoteInPrompt("four talking points", PROMPT)).toBe(false);
    expect(quoteInPrompt("  ", PROMPT)).toBe(false);
  });
});

describe("validateBlueprint", () => {
  it("passes a good plan", () => {
    expect(validateBlueprint(base(), PROMPT)).toEqual([]);
  });
  it("catches invented quotes, duplicate keys, unknown affects and an off-list recommendation", () => {
    const bp = base();
    bp.items[2].source_quote = "five talking points";
    bp.items[1].key = "calendar-read";
    bp.questions = [{ text: "Which?", affects: ["nope"], options: [{ label: "A", value: "a" }, { label: "B", value: "b" }], recommended: "c", blocking: false }];
    const problems = validateBlueprint(bp, PROMPT);
    expect(problems).toEqual([
      'Item key "calendar-read" is used twice; every key must be unique.',
      'Item "talking-points" quotes "five talking points", which isn\'t in the request. Quote the exact words.',
      "Question 1 names items that don't exist: nope.",
      'Question 1\'s recommended answer "c" must be one of its option values.',
    ]);
  });
  it("the strict schema reports limits as instructions for the retry", () => {
    const tooLong = { ...base(), name: "x".repeat(41) };
    expect(strictProblems(tooLong).problems[0]).toMatch(/^name: /);
    expect(strictProblems({ ...base(), items: base().items.slice(0, 2) }).problems[0]).toMatch(/^items: /);
  });
});

describe("normalizeDraft / toKey", () => {
  it("turns any key into a valid, unique one and keeps questions pointing at the renamed parts", () => {
    expect(toKey("Last Email_Thread!")).toBe("last-email-thread");
    expect(toKey("x")).toBe("part-x");
    const draft = normalizeDraft({
      items: [{ key: "Slack Brief" }, { key: "slack_brief" }, { key: "", title: "Talking points" }],
      questions: [{ affects: ["Slack Brief", "slack_brief"] }],
    });
    expect(draft.items.map((i) => i.key)).toEqual(["slack-brief", "slack-brief-2", "talking-points"]);
    expect(draft.questions[0].affects).toEqual(["slack-brief", "slack-brief-2"]);
  });
});

describe("shortenQuote", () => {
  it("cuts an over-long quote at a word boundary, so it's still the request's exact words", () => {
    const triage = promptText("support-triage");
    const q = shortenQuote(triage);
    expect(q.length).toBeLessThanOrEqual(120);
    expect(quoteInPrompt(q, triage)).toBe(true);
    expect(shortenQuote("short")).toBe("short");
  });
});

describe("applyQuestionRules (Slack workspace)", () => {
  it("adds one blocking workspace question when the request posts to Slack without naming a channel", () => {
    const bp = applyQuestionRules(base(), PROMPT);
    expect(bp.questions).toHaveLength(1);
    expect(bp.questions[0]).toMatchObject({ blocking: true, affects: ["slack-brief"], recommended: "connected" });
  });
  it("marks a model-written workspace question blocking instead of adding a second", () => {
    const withQ = { ...base(), questions: [{ text: "Which Slack workspace?", affects: ["slack-brief"], options: [{ label: "Acme", value: "acme" }, { label: "Sandbox", value: "sandbox" }], recommended: "acme", blocking: false }] };
    const bp = applyQuestionRules(withQ, PROMPT);
    expect(bp.questions).toEqual([{ ...withQ.questions[0], blocking: true }]);
  });
  it("a named channel settles it: the workspace question becomes a default", () => {
    const lead = promptText("lead-scorer");
    const withQ = { ...base(), questions: [{ text: "Which Slack workspace?", affects: ["slack-brief"], options: [{ label: "A", value: "a" }, { label: "B", value: "b" }], recommended: "a", blocking: true }] };
    expect(applyQuestionRules(withQ, lead).questions[0].blocking).toBe(false);
    expect(applyQuestionRules(base(), lead).questions).toEqual([]);
  });
  it("Slack the planner chose on its own (not in the request) is a default, not a blocking question", () => {
    const triage = promptText("support-triage");
    const bp = applyQuestionRules(base(), triage);
    expect(bp.questions.filter((q) => q.blocking)).toEqual([]);
  });
  it("leaves plans without Slack alone", () => {
    const noSlack = { ...base(), items: base().items.filter((i) => i.key !== "slack-brief") };
    expect(applyQuestionRules(noSlack as BlueprintT, PROMPT)).toEqual(noSlack);
  });
  it("other questions the model marks blocking have a safe default, so they don't hold Build", () => {
    const over = {
      ...base(),
      questions: [{ text: "Which calendar and email provider should be used?", affects: ["calendar-read"], options: [{ label: "Google Workspace", value: "google" }, { label: "Microsoft 365", value: "microsoft" }], recommended: "google", blocking: true }],
    };
    const bp = applyQuestionRules(over, PROMPT);
    expect(bp.questions.filter((q) => q.blocking).map((q) => q.text)).toEqual(["Which Slack workspace should this post to?"]);
    expect(bp.questions.find((q) => q.text.startsWith("Which calendar"))).toMatchObject({ blocking: false, recommended: "google" });
  });
});

/* ---------- estimator (A-4) ---------- */

describe("estimate", () => {
  it("prices from the class table: size, model factor and fix allowance", () => {
    // agent.summariser m on Claude (factor 1): likely 16 + 16 × 0.4 × 0.3 = 17.92 → 18; p90 20 + 1.92 → 22
    expect(estimate({ item_class: "agent.summariser", size: "m" }, "claude")).toMatchObject({ low: 12, likely: 18, high: 22, confidence: "high" });
    // size l ×1.5, Gemini ×0.8
    const l = estimate({ item_class: "data.table", size: "l" }, "gemini");
    expect(l.likely).toBe(Math.round(9 * 1.2 + 9 * 1.2 * 0.05 * 0.3));
  });
  it("cheaper models cost less; confidence follows seeded history", () => {
    const item = { item_class: "screen.list" as const, size: "m" as const };
    expect(estimate(item, "openrouter").likely).toBeLessThan(estimate(item, "claude").likely);
    expect(estimate({ item_class: "agent.researcher", size: "m" }).confidence).toBe("low"); // 4 seeded builds
    expect(estimate({ item_class: "integration.crm_lookup", size: "m" }).confidence).toBe("medium"); // 7
  });
  it("every class in the schema has a price", () => {
    for (const s of Object.values(CLASS_TABLE)) expect(s.low).toBeLessThanOrEqual(s.likely);
  });
  it("totals add up, with time in whole minutes (about 45 s per 12-credit unit)", () => {
    const t = totals([estimate({ item_class: "screen.list", size: "m" }, "claude"), estimate({ item_class: "agent.summariser", size: "m" }, "claude")]);
    expect(t.likely).toBe(13 + 18);
    expect(t.minutes).toBe(2);
    expect(draftingCredits(7000)).toBe(3);
    expect(draftingCredits(undefined)).toBe(1);
  });
  it("older model names map onto the picker's choices", () => {
    expect(toModelChoice("claude-sonnet")).toBe("claude");
    expect(toModelChoice("openrouter")).toBe("openrouter");
    expect(toModelChoice("mystery")).toBe("gemini");
  });
});
