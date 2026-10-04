import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { APICallError, generateText, RetryError, type LanguageModel } from "ai";
import { serverEnv } from "@/server/env";
import { MODEL_CHOICES, MODEL_LABEL, type ModelChoice } from "./models";

export type { ModelChoice };

/**
 * The model gateway. Every model call goes through here, never a provider SDK directly (CLAUDE.md).
 * - Gemini is always real; OpenRouter is real when its key and model are set.
 * - Claude and GPT are real when their key is set. Otherwise they're answered by Gemini and marked
 *   `simulated`, and the UI shows the Simulated tag. Never hide that a model is simulated.
 * - A free-tier rate limit (429) is retried with backoff, then thrown as GatewayRateLimited so the UI can show
 *   the paused banner with "Switch model". Never fail over to another model silently.
 */

export type ResolvedModel = {
  choice: ModelChoice;
  label: string;
  /** True when this choice is answered by Gemini because its key isn't set. */
  simulated: boolean;
  model: LanguageModel;
};

export class GatewayRateLimited extends Error {
  constructor(public label: string) {
    super(`${label} is busy right now (rate limit).`);
    this.name = "GatewayRateLimited";
  }
}

export class GatewayUnavailable extends Error {
  constructor(
    public label: string,
    message: string,
  ) {
    super(message);
    this.name = "GatewayUnavailable";
  }
}

function gemini(): LanguageModel {
  const { apiKey, model } = serverEnv.google();
  return createGoogleGenerativeAI({ apiKey })(model);
}

export function resolveModel(choice: ModelChoice = "gemini"): ResolvedModel {
  switch (choice) {
    case "openrouter": {
      const cfg = serverEnv.openrouter();
      if (!cfg) return { choice, label: MODEL_LABEL.openrouter, simulated: true, model: gemini() };
      return { choice, label: MODEL_LABEL.openrouter, simulated: false, model: createOpenRouter({ apiKey: cfg.apiKey }).chat(cfg.model) };
    }
    case "claude": {
      const cfg = serverEnv.anthropic();
      if (!cfg?.model) return { choice, label: MODEL_LABEL.claude, simulated: true, model: gemini() };
      return { choice, label: MODEL_LABEL.claude, simulated: false, model: createAnthropic({ apiKey: cfg.apiKey })(cfg.model) };
    }
    case "gpt": {
      const cfg = serverEnv.openai();
      if (!cfg?.model) return { choice, label: MODEL_LABEL.gpt, simulated: true, model: gemini() };
      return { choice, label: MODEL_LABEL.gpt, simulated: false, model: createOpenAI({ apiKey: cfg.apiKey })(cfg.model) };
    }
    default:
      return { choice: "gemini", label: MODEL_LABEL.gemini, simulated: false, model: gemini() };
  }
}

/** Which models the picker can show, and whether each is real here. (No keys are sent to the client.) */
export function modelAvailability(): { choice: ModelChoice; label: string; simulated: boolean }[] {
  return MODEL_CHOICES.map((c) => {
    const { choice, label, simulated } = resolveModel(c);
    return { choice, label, simulated };
  });
}

function statusOf(err: unknown): number | undefined {
  if (APICallError.isInstance(err)) return err.statusCode;
  if (RetryError.isInstance(err)) return statusOf(err.lastError);
  return undefined;
}

/**
 * Provider failures become gateway errors: a 429 is GatewayRateLimited (the paused banner with "Switch model"),
 * any other API failure GatewayUnavailable. Returns null for everything else (e.g. output that didn't match the
 * schema), which callers treat as the model's mistake and may retry.
 */
export function classifyGatewayError(err: unknown, label: string): GatewayRateLimited | GatewayUnavailable | null {
  if (err instanceof GatewayRateLimited || err instanceof GatewayUnavailable) return err;
  if (statusOf(err) === 429) return new GatewayRateLimited(label);
  if (APICallError.isInstance(err) || RetryError.isInstance(err)) {
    return new GatewayUnavailable(label, err instanceof Error ? err.message : String(err));
  }
  return null;
}

/** A single text answer. Retries with backoff on transient errors (the SDK's maxRetries). */
export async function ask(input: {
  instructions: string;
  prompt: string;
  model?: ModelChoice;
  maxOutputTokens?: number;
  temperature?: number;
  /** Quick answers (Help): Gemini thinks at "low" (about 3.5 s instead of ~19 s on gemini-3.x flash). */
  fast?: boolean;
}): Promise<{ text: string; label: string; simulated: boolean }> {
  const resolved = resolveModel(input.model);
  try {
    const { text } = await generateText({
      model: resolved.model,
      instructions: input.instructions,
      prompt: input.prompt,
      maxOutputTokens: input.maxOutputTokens ?? 600,
      temperature: input.temperature ?? 0.3,
      maxRetries: 3,
      timeout: 30_000,
      // Only Gemini reads this; other providers ignore options keyed to "google".
      // Lite models barely think already (and may not accept the setting).
      providerOptions: input.fast && !serverEnv.google().model.includes("lite") ? { google: { thinkingConfig: { thinkingLevel: "low" } } } : undefined,
    });
    return { text: text.trim(), label: resolved.label, simulated: resolved.simulated };
  } catch (err) {
    throw classifyGatewayError(err, resolved.label) ?? new GatewayUnavailable(resolved.label, err instanceof Error ? err.message : String(err));
  }
}
