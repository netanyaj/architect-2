/**
 * Live acceptance for M2: each demo prompt produces a valid plan in under 60 s on each model.
 *   pnpm eval:blueprint                       → Gemini
 *   EVAL_MODELS=gemini,openrouter pnpm eval:blueprint
 *   RECORD=1 pnpm eval:blueprint              → also saves the plans as fixtures for the offline tests
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MODEL_CHOICES, type ModelChoice } from "@/lib/models";
import { generateBlueprint } from "@/server/blueprint/generate";
import { DEMO_PROMPTS, promptText } from "../fixtures/demo-prompts";
import { checkFixture } from "../fixtures/check-fixture";

const models = (process.env.EVAL_MODELS ?? "gemini").split(",").map((m) => m.trim()) as ModelChoice[];

describe.each(models.filter((m) => MODEL_CHOICES.includes(m)))("plans on %s", (model) => {
  it.each(DEMO_PROMPTS)("$id: valid, quoted from the request, within 60 s", async ({ id, blocking }) => {
    const prompt = promptText(id);
    let streamed = 0;
    const r = await generateBlueprint({ prompt, model }, { onItem: () => void streamed++ });
    console.log(`${model} · ${id}: ${r.blueprint.items.length} parts, ${r.blueprint.questions.length} questions, ${(r.ms / 1000).toFixed(1)} s, ${r.tokens} tokens${r.simulated ? " (simulated via Gemini)" : ""}`);
    checkFixture(r.blueprint, prompt, blocking);
    expect(streamed).toBeGreaterThanOrEqual(r.blueprint.items.length);
    expect(r.ms).toBeLessThan(60_000);
    if (process.env.RECORD === "1") {
      writeFileSync(join(__dirname, "..", "fixtures", "blueprints", `${id}.${model}.json`), JSON.stringify(r.blueprint, null, 2) + "\n");
    }
  });
});
