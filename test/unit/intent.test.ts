import { describe, expect, it } from "vitest";
import { intentByRules } from "@/lib/intent";

/* M5.8: intent replaces the Ask · Make changes switch (BL-4). Rules first; null means the model decides. */
describe("intentByRules", () => {
  it.each([
    "Add a Slack step that posts each brief",
    "Also send the brief to Slack, not only email",
    "Please send it at 8 instead",
    "Can you add a filter for VIP accounts?",
    "Could you rename the digest to Morning brief",
    "I want it to skip weekends",
    "Remove the PDF summary",
    "Only on weekdays",
    "Instead of email, Slack",
    "make the check stricter",
    "OK, drop the agenda part",
    "Can we use HubSpot instead?",
  ])("a change: %s", (m) => expect(intentByRules(m)).toBe("change"));

  it.each([
    "Why was invoice 02 flagged?",
    "What would Excel support cost?",
    "How does the rate-card check work?",
    "Why did the brief for Northwind skip the last call notes",
    "Is Slack connected yet?",
    "Does it run on weekends?",
    "Could you explain what the checker does?",
    "Explain the rate-card check",
    "Show me why it failed?",
    "which parts use gmail?",
  ])("a question: %s", (m) => expect(intentByRules(m)).toBe("question"));

  it.each(["What if we added Slack?", "How about weekly?", "Is it possible to add Excel?", "Slack", "the brief feels long", ""])("unclear, so the model decides: %s", (m) =>
    expect(intentByRules(m)).toBeNull(),
  );
});
