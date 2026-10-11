import { expect } from "vitest";
import { Blueprint, quoteInPrompt, validateBlueprint } from "@/lib/blueprint";

/** The fixture assertions from docs/build/BLUEPRINT-GENERATION.md, shared by the offline and live tests. */
export function checkFixture(raw: unknown, prompt: string, expectedBlocking: RegExp | null) {
  // 1. The schema is valid.
  const bp = Blueprint.parse(raw);
  // 2. Every quoted phrase exists in the prompt.
  for (const item of bp.items) expect(quoteInPrompt(item.source_quote, prompt), `"${item.source_quote}" is not in the prompt`).toBe(true);
  // 3. No blocking questions except where expected.
  const blocking = bp.questions.filter((q) => q.blocking);
  if (expectedBlocking) {
    expect(blocking.map((q) => q.text).some((t) => expectedBlocking.test(t)), `expected a blocking question matching ${expectedBlocking}, got ${JSON.stringify(blocking.map((q) => q.text))}`).toBe(true);
    // Blocking is the server's decision from the label (or the Slack rule), never the model's own flag.
    for (const q of blocking) expect(["reduce", "remove", "none"]).toContain(q.default_effect);
  } else {
    expect(blocking.map((q) => q.text)).toEqual([]);
  }
  // And the rest of the generator's own rules (unique keys, questions name real items, recommended is an option).
  expect(validateBlueprint(bp, prompt)).toEqual([]);
  return bp;
}
