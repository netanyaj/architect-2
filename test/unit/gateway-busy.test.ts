import { APICallError } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/* A busy model (429, or a 503 "high demand") is GatewayRateLimited: OpenRouter answers when it's set up and allowed,
   and says so; otherwise the error stands for the paused banner. The AI SDK is mocked: no model calls. */
const generateText = vi.fn();
vi.mock("ai", async (orig) => ({ ...(await orig<typeof import("ai")>()), generateText: (o: unknown) => generateText(o) }));

const { askObject, classifyGatewayError, GatewayRateLimited, GatewayUnavailable } = await import("@/lib/gateway");

const apiError = (statusCode: number) =>
  new APICallError({ message: statusCode === 503 ? "This model is currently experiencing high demand." : "Quota exceeded.", url: "https://example.test", requestBodyValues: {}, statusCode, isRetryable: true });
const schema = z.object({ reply: z.string() });
const input = { instructions: "Reply.", prompt: "Hi", schema, model: "gemini" as const };
const env = { ...process.env };

beforeEach(() => {
  generateText.mockReset();
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
  process.env.MODEL_GEMINI = "gemini-3.5-flash-lite";
});
afterEach(() => {
  process.env = { ...env };
});

describe("classifyGatewayError", () => {
  it("reads a 503 as busy (high demand), a 429 as busy (its limit), and other failures as unavailable", () => {
    expect(classifyGatewayError(apiError(503), "Gemini")).toMatchObject({ name: "GatewayRateLimited", reason: "demand" });
    expect(classifyGatewayError(apiError(429), "Gemini")).toMatchObject({ name: "GatewayRateLimited", reason: "limit" });
    expect(classifyGatewayError(apiError(500), "Gemini")).toBeInstanceOf(GatewayUnavailable);
  });
});

describe("askObject when Gemini answers 503 (high demand)", () => {
  it("with OpenRouter set up and allowed: OpenRouter answers, and the note says Gemini had high demand", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.MODEL_OPENROUTER = "nvidia/nemotron-3-super-120b-a12b:free";
    generateText.mockRejectedValueOnce(apiError(503)).mockResolvedValueOnce({ output: { reply: "Done" }, totalUsage: { totalTokens: 12 } });
    const r = await askObject({ ...input, fallback: "openrouter" });
    expect(r.object).toEqual({ reply: "Done" });
    expect(r.label).toBe("OpenRouter (free)");
    expect(r.fallbackNote).toBe("Gemini 3.5 Flash Lite is busy right now (high demand), so Nemotron 3 Super 120B A12B on OpenRouter answered instead.");
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("without OpenRouter set up: no fallback call, and the busy error stands for the paused banner", async () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.MODEL_OPENROUTER;
    generateText.mockRejectedValueOnce(apiError(503));
    const err = await askObject({ ...input, fallback: "openrouter" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayRateLimited);
    expect(err).toMatchObject({ reason: "demand" });
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it("when the policy doesn't allow OpenRouter (no fallback offered): the busy error stands", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.MODEL_OPENROUTER = "nvidia/nemotron-3-super-120b-a12b:free";
    generateText.mockRejectedValueOnce(apiError(503));
    await expect(askObject({ ...input, fallback: null })).rejects.toMatchObject({ name: "GatewayRateLimited", reason: "demand" });
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it("a 429 still says its free limit", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.MODEL_OPENROUTER = "nvidia/nemotron-3-super-120b-a12b:free";
    generateText.mockRejectedValueOnce(apiError(429)).mockResolvedValueOnce({ output: { reply: "Done" }, totalUsage: { totalTokens: 12 } });
    expect((await askObject({ ...input, fallback: "openrouter" })).fallbackNote).toContain("(its free limit)");
  });
});
