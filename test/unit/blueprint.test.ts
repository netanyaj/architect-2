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
    bp.questions = [{ text: "Which?", affects: ["nope"], options: [{ label: "A", value: "a" }, { label: "B", value: "b" }], recommended: "c", default_effect: "keep", blocking: false }];
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
    const withQ = { ...base(), questions: [{ text: "Which Slack workspace?", affects: ["slack-brief"], options: [{ label: "Acme", value: "acme" }, { label: "Sandbox", value: "sandbox" }], recommended: "acme", default_effect: "keep" as const }] };
    const bp = applyQuestionRules(withQ, PROMPT);
    // The Slack rule decides here, whatever the model's label: no safe default.
    expect(bp.questions).toEqual([{ ...withQ.questions[0], default_effect: "none", blocking: true }]);
  });
  it("a named channel settles it: the workspace question becomes a default", () => {
    const lead = promptText("lead-scorer");
    const withQ = { ...base(), questions: [{ text: "Which Slack workspace?", affects: ["slack-brief"], options: [{ label: "A", value: "a" }, { label: "B", value: "b" }], recommended: "a", default_effect: "none" as const }] };
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
  it("questions block by their label: reduce, remove or none hold Build; keep doesn't", () => {
    const q = (text: string, effect: "keep" | "reduce" | "remove" | "none") => ({ text, affects: ["calendar-read"], options: [{ label: "A", value: "a" }, { label: "B", value: "b" }], recommended: "a", default_effect: effect });
    const bp = applyQuestionRules({ ...base(), items: base().items.filter((i) => i.key !== "slack-brief"), questions: [q("Keep?", "keep"), q("Fewer?", "reduce"), q("Skip?", "remove"), q("Which budget code?", "none")] }, PROMPT);
    // Blocking questions are listed first; compare regardless of order.
    expect(Object.fromEntries(bp.questions.map((x) => [x.text, x.blocking]))).toEqual({ "Keep?": false, "Fewer?": true, "Skip?": true, "Which budget code?": true });
  });
  it("a question labelled keep doesn't hold Build, even one that sounds important", () => {
    const calendar = {
      ...base(),
      questions: [{ text: "Which calendar and email provider should be used?", affects: ["calendar-read"], options: [{ label: "Google Workspace", value: "google" }, { label: "Microsoft 365", value: "microsoft" }], recommended: "google", default_effect: "keep" as const }],
    };
    const bp = applyQuestionRules(calendar, PROMPT);
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

describe("rule b: a requested channel that isn't connected always gets a blocking question", () => {
  const SMS = promptText("sms-reminder");
  const smsPlan = (): BlueprintT => ({
    ...base(),
    items: [
      { key: "calendar-read", grp: "integrations", title: "Meetings on your calendar", description: "d", proved_when: "p", source_quote: "each meeting on my calendar", item_class: "integration.calendar", size: "m" },
      { key: "sms-reminder", grp: "integrations", title: "SMS reminder to each attendee", description: "d", proved_when: "p", source_quote: "text each attendee an SMS reminder", item_class: "integration.chat_send", size: "m" },
      { key: "meeting-link", grp: "features", title: "Meeting link in the reminder", description: "d", proved_when: "p", source_quote: "with the meeting link", item_class: "screen.detail", size: "s" },
    ],
  });
  const q = (text: string, effect: "keep" | "reduce" | "remove" | "none", options = [{ label: "Twilio", value: "twilio" }, { label: "Vonage", value: "vonage" }]) => ({
    text,
    affects: ["sms-reminder"],
    options,
    recommended: options[0].value,
    default_effect: effect,
  });

  it("adds one when the model didn't ask (it picked a service silently)", () => {
    const bp = applyQuestionRules(smsPlan(), SMS, { connected: ["google_calendar", "slack"] });
    expect(bp.questions).toEqual([expect.objectContaining({ text: "Which SMS service should send these messages?", blocking: true, default_effect: "none", affects: ["sms-reminder"] })]);
  });
  it("marks the model's own SMS question blocking, whatever it was labelled, instead of adding another", () => {
    const bp = applyQuestionRules({ ...smsPlan(), questions: [q("Which text messaging service should send the reminders?", "keep")] }, SMS, { connected: [] });
    expect(bp.questions).toHaveLength(1);
    expect(bp.questions[0]).toMatchObject({ blocking: true, default_effect: "none" });
  });
  it("naming SMS in the request never unblocks it (rule a doesn't apply to channels)", () => {
    const bp = applyQuestionRules({ ...smsPlan(), questions: [q("Which SMS provider?", "reduce")] }, SMS, { connected: [] });
    expect(bp.questions[0].blocking).toBe(true);
  });
  it("once an SMS service is connected, nothing blocks and nothing is added", () => {
    const bp = applyQuestionRules({ ...smsPlan(), questions: [q("Which SMS provider?", "none")] }, SMS, { connected: ["twilio"] });
    expect(bp.questions.map((x) => x.blocking)).toEqual([false]);
    expect(applyQuestionRules(smsPlan(), SMS, { connected: ["twilio"] }).questions).toEqual([]);
  });
  it("doesn't mistake ordinary words for channels ('team', 'text of the ticket')", () => {
    expect(applyQuestionRules({ ...base(), items: base().items.filter((i) => i.key !== "slack-brief") }, "Classify tickets by urgency and team, and keep the text of each ticket.").questions).toEqual([]);
  });
});

describe("rule a: a service the request names, or Connections has, doesn't block", () => {
  const MP = promptText("meeting-prep");
  const q = (text: string, effect: "keep" | "reduce" | "remove" | "none") => ({ text, affects: ["calendar-read"], options: [{ label: "A", value: "a" }, { label: "B", value: "b" }], recommended: "a", default_effect: effect });

  it("the OpenRouter Meeting Prep case: calendar (connected) and email (named in the request) don't block", () => {
    const bp = applyQuestionRules(
      { ...base(), questions: [q("Which calendar service should the app read meetings from?", "reduce"), q("Which email service should the app use to fetch attendee threads?", "reduce")] },
      MP,
      { connected: ["google_calendar", "slack"] },
    );
    expect(bp.questions.filter((x) => x.blocking).map((x) => x.text)).toEqual(["Which Slack workspace should this post to?"]);
  });
  it("the Zendesk case: an escalation channel doesn't block when a chat service is connected", () => {
    const triage = promptText("support-triage");
    const plan = { ...base(), items: base().items.filter((i) => i.key !== "slack-brief"), questions: [q("Which communication channel should receive VIP escalation alerts?", "none")] };
    expect(applyQuestionRules(plan, triage, { connected: ["slack"] }).questions[0].blocking).toBe(false);
    // With nothing connected and nothing named, the label stands: it blocks.
    expect(applyQuestionRules(plan, triage, { connected: [] }).questions[0].blocking).toBe(true);
  });
  it("questions that aren't about a service still block by their label", () => {
    const bp = applyQuestionRules({ ...base(), items: base().items.filter((i) => i.key !== "slack-brief"), questions: [q("Should the brief skip internal meetings?", "remove")] }, MP, { connected: ["google_calendar", "slack"] });
    expect(bp.questions[0].blocking).toBe(true);
  });
});
