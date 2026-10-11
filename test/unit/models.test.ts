import { describe, expect, it } from "vitest";
import { AUTO, MODEL_CHOICES, MODEL_COST_WORDS, resolvePick, toModelPick } from "@/lib/models";

/* M5.8: Auto first and by default; relative cost words, never numbers. */
describe("Auto", () => {
  it("resolves to the preferred model when it's allowed, else Gemini, else the first allowed one", () => {
    expect(resolvePick(AUTO, ["gemini", "claude"], "claude")).toBe("claude");
    expect(resolvePick(AUTO, ["gemini"], "claude")).toBe("gemini");
    expect(resolvePick(AUTO, ["openrouter", "private"], "claude")).toBe("openrouter");
  });
  it("leaves a picked model alone, and reads older rows as before", () => {
    expect(resolvePick("gpt", ["gemini"])).toBe("gpt");
    expect(resolvePick("claude-sonnet", ["gemini"])).toBe("claude");
    expect(toModelPick("auto")).toBe(AUTO);
    expect(toModelPick(null)).toBe("gemini");
  });
  it("says every model's cost in words, with no numbers", () => {
    for (const m of MODEL_CHOICES) expect(MODEL_COST_WORDS[m]).toMatch(/^Uses (the fewest|fewer|more) credits/);
    expect(Object.values(MODEL_COST_WORDS).join(" ")).not.toMatch(/\d/);
  });
});
