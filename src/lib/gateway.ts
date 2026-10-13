import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { APICallError, generateText, Output, RetryError, type LanguageModel } from "ai";
import { serverEnv } from "@/server/env";
import * as lyzr from "@/server/lyzr";
import { MODEL_CHOICES, MODEL_LABEL, type ModelChoice } from "./models";

export type { ModelChoice };

/**
 * The model gateway. Every model call goes through here, never a provider SDK directly (CLAUDE.md).
 * - Gemini is always real; OpenRouter is real when its key and model are set.
 * - Claude and GPT are real when their key is set. Otherwise they're answered by Gemini and marked
 *   `simulated`, and the UI shows the Simulated tag. Never hide that a model is simulated.
 * - A free-tier rate limit (429) or an overloaded model (503, "high demand") is retried with backoff, then thrown as
 *   GatewayRateLimited so the UI can show the paused banner with "Switch model". Never fail over to another model
 *   silently.
 */

export type ResolvedModel = {
  choice: ModelChoice;
  label: string;
  /** True when this choice is answered by Gemini because its key isn't set. */
  simulated: boolean;
  model: LanguageModel;
};

/** Why a model is busy: its free limit (429), or high demand on the provider's side (503). */
export type BusyReason = "limit" | "demand";

export class GatewayRateLimited extends Error {
  constructor(
    public label: string,
    public reason: BusyReason = "limit",
  ) {
    super(`${label} is busy right now (${reason === "demand" ? "high demand" : "rate limit"}).`);
    this.name = "GatewayRateLimited";
  }
}

/** The words for why a model is busy, as the chat and the plan say them. */
export function busyWords(reason: BusyReason): string {
  return reason === "demand" ? "high demand" : "its free limit";
}

/** The model took longer than its limit (OpenRouter's free models: 45 s). Shown like a rate limit: paused, Switch model. */
export class GatewaySlow extends Error {
  constructor(
    public label: string,
    public seconds: number,
  ) {
    super(`${label} took longer than ${seconds} s.`);
    this.name = "GatewaySlow";
  }
}

/** How long a model may take before the request is stopped and the person is offered Switch model. */
export const MODEL_TIME_LIMIT_MS: Partial<Record<ModelChoice, number>> = { openrouter: 45_000 };

/** An abort signal for a model's time limit; `timedOut()` tells our own stop apart from any other abort. */
export function timeLimit(choice: ModelChoice) {
  const ms = MODEL_TIME_LIMIT_MS[choice];
  if (!ms) return { signal: undefined, timedOut: () => false, clear: () => {}, seconds: 0 };
  const controller = new AbortController();
  let fired = false;
  const timer = setTimeout(() => {
    fired = true;
    controller.abort();
  }, ms);
  return { signal: controller.signal, timedOut: () => fired, clear: () => clearTimeout(timer), seconds: ms / 1000 };
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
    case "private":
      // A private endpoint can't be reached from the prototype: Gemini answers, and the UI says it's simulated.
      return { choice, label: MODEL_LABEL.private, simulated: true, model: gemini() };
    case "gpt": {
      const cfg = serverEnv.openai();
      if (!cfg?.model) return { choice, label: MODEL_LABEL.gpt, simulated: true, model: gemini() };
      return { choice, label: MODEL_LABEL.gpt, simulated: false, model: createOpenAI({ apiKey: cfg.apiKey })(cfg.model) };
    }
    default:
      return { choice: "gemini", label: MODEL_LABEL.gemini, simulated: false, model: gemini() };
  }
}

/** "gemini-3.5-flash-lite" → "Gemini 3.5 Flash Lite"; "nvidia/nemotron-3-super-120b-a12b:free" → "Nemotron 3 Super 120B A12B". */
export function prettyModelId(id: string): string {
  const base = id.split("/").pop()!.replace(/:free$/, "").replace(/^models\//, "");
  return base
    .split("-")
    .filter(Boolean)
    .map((w) => (/^gpt$/i.test(w) ? "GPT" : /^[a-z]?\d+b$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * The model that actually answers for a choice (M5.10), by name: "Gemini 3.5 Flash Lite", or OpenRouter's free model.
 * A simulated choice (Claude or GPT without a key) is answered by Gemini, so it's Gemini's name.
 */
export function modelName(choice: ModelChoice): string {
  const resolved = resolveModel(choice);
  if (resolved.simulated || resolved.choice === "gemini") return prettyModelId(serverEnv.google().model);
  if (choice === "openrouter") return `${prettyModelId(serverEnv.openrouter()!.model)} on OpenRouter`;
  if (choice === "claude") return prettyModelId(serverEnv.anthropic()!.model ?? "claude");
  if (choice === "gpt") return prettyModelId(serverEnv.openai()!.model ?? "gpt");
  return resolved.label;
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
 * Provider failures become gateway errors: a 429 (free limit) or a 503 (overloaded, "high demand") is
 * GatewayRateLimited (the paused banner with "Switch model", and the fallback), any other API failure
 * GatewayUnavailable. Returns null for everything else (e.g. output that didn't match the
 * schema), which callers treat as the model's mistake and may retry.
 */
export function classifyGatewayError(err: unknown, label: string): GatewayRateLimited | GatewayUnavailable | GatewaySlow | null {
  if (err instanceof GatewayRateLimited || err instanceof GatewayUnavailable || err instanceof GatewaySlow) return err;
  const status = statusOf(err);
  if (status === 429) return new GatewayRateLimited(label, "limit");
  if (status === 503) return new GatewayRateLimited(label, "demand");
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
  /** The model to fall back to when Gemini is busy (quota or high demand, M5.10): the caller passes it only if the policy allows it. */
  fallback?: ModelChoice | null;
}): Promise<{ text: string; label: string; simulated: boolean; fallbackNote?: string }> {
  try {
    return await askOnce(input);
  } catch (err) {
    const to = fallbackFor(err, input.model, input.fallback);
    if (!to) throw err;
    return { ...(await askOnce({ ...input, model: to })), fallbackNote: fallbackNote(to, (err as GatewayRateLimited).reason) };
  }
}

/**
 * When Gemini (or a simulated model it answers for) refuses on quota, its rate limit or high demand (503), after the
 * SDK's retries: the fallback model, if one was offered and it's real here. Null otherwise: the error stands (the
 * paused banner).
 */
function fallbackFor(err: unknown, choice: ModelChoice | undefined, fallback: ModelChoice | null | undefined): ModelChoice | null {
  if (!(err instanceof GatewayRateLimited) || !fallback) return null;
  const from = resolveModel(choice);
  if (from.choice !== "gemini" && !from.simulated) return null;
  return resolveModel(fallback).simulated ? null : fallback;
}

/** The one line that says it (M5.10): never fail over silently. */
export function fallbackNote(to: ModelChoice, reason: BusyReason = "limit"): string {
  return `${modelName("gemini")} is busy right now (${busyWords(reason)}), so ${modelName(to)} answered instead.`;
}

async function askOnce(input: Parameters<typeof ask>[0]): Promise<{ text: string; label: string; simulated: boolean }> {
  const resolved = resolveModel(input.model);
  const limit = timeLimit(resolved.choice);
  try {
    const { text } = await generateText({
      abortSignal: limit.signal,
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
    if (limit.timedOut()) throw new GatewaySlow(resolved.label, limit.seconds);
    throw classifyGatewayError(err, resolved.label) ?? new GatewayUnavailable(resolved.label, err instanceof Error ? err.message : String(err));
  } finally {
    limit.clear();
  }
}

/** A structured answer (zod schema) through the same gateway rules: retries, 429 or 503 → GatewayRateLimited. */
export async function askObject<T>(input: {
  instructions: string;
  prompt: string;
  schema: import("zod").ZodType<T>;
  model?: ModelChoice;
  fast?: boolean;
  /** As for ask(): the fallback when Gemini refuses on quota (M5.10). */
  fallback?: ModelChoice | null;
}): Promise<{ object: T; label: string; simulated: boolean; tokens: number; fallbackNote?: string }> {
  try {
    return await askObjectOnce(input);
  } catch (err) {
    const to = fallbackFor(err, input.model, input.fallback);
    if (!to) throw err;
    return { ...(await askObjectOnce({ ...input, model: to })), fallbackNote: fallbackNote(to, (err as GatewayRateLimited).reason) };
  }
}

async function askObjectOnce<T>(input: { instructions: string; prompt: string; schema: import("zod").ZodType<T>; model?: ModelChoice; fast?: boolean }): Promise<{ object: T; label: string; simulated: boolean; tokens: number }> {
  const resolved = resolveModel(input.model);
  const limit = timeLimit(resolved.choice);
  try {
    const result = await generateText({
      abortSignal: limit.signal,
      model: resolved.model,
      instructions: input.instructions,
      prompt: input.prompt,
      output: Output.object({ schema: input.schema }),
      temperature: 0.2,
      maxRetries: 3,
      timeout: 45_000,
      providerOptions: input.fast && !serverEnv.google().model.includes("lite") ? { google: { thinkingConfig: { thinkingLevel: "low" } } } : undefined,
    });
    return { object: result.output as T, label: resolved.label, simulated: resolved.simulated, tokens: result.totalUsage.totalTokens ?? 0 };
  } catch (err) {
    if (limit.timedOut()) throw new GatewaySlow(resolved.label, limit.seconds);
    throw classifyGatewayError(err, resolved.label) ?? new GatewayUnavailable(resolved.label, err instanceof Error ? err.message : String(err));
  } finally {
    limit.clear();
  }
}

/** Where an app agent ran: its own Studio agent (the workspace's key), the shared demo agent, or the gateway (Simulated). */
export type AgentRuntime = "lyzr_agent" | "lyzr_shared" | "gateway";

export type AgentRunInput = {
  name: string;
  description: string;
  instructions: string;
  /** What the agent hands over, in plain words. */
  output: string;
  temperature: number;
  maxTokens: number;
  /** The Studio agent already made for this node in the workspace's own Studio, if any. */
  lyzrAgentId: string | null;
  /** The workspace's own Lyzr key (M5.10); null without one. */
  apiKey: string | null;
  /** The seeded Research agent: the shared demo agent on the platform's key, Try it only. */
  demo?: boolean;
  userId: string;
  sessionId: string;
  message: string;
  /** Imported CrewAI and LangGraph agents don't run on Studio: Gemini answers for them (Simulated). */
  simulate?: boolean;
};

export type AgentRunResult = {
  text: string;
  runtime: AgentRuntime;
  /** Set when a Studio agent was made for this node during the call (save it on the node). */
  createdAgentId: string | null;
  /** The Studio agent that answered. */
  lyzrAgentId: string | null;
  modelLabel: string;
  simulated: boolean;
  note: string | null;
};

/** The message for the shared demo agent: it has no instructions of its own, so they lead every message. */
export function sharedAgentMessage(input: Pick<AgentRunInput, "name" | "description" | "instructions" | "output" | "message">): string {
  return [
    `Your role: ${input.name}. ${input.description}`.trim(),
    `Your task: ${input.instructions}`,
    `Output format: ${input.output}`,
    "",
    `Message: ${input.message}`,
  ].join("\n");
}

/**
 * Runs an app agent (Agents › Try it). Whose Lyzr account answers (M5.10):
 * 1. The demo agent: the platform's shared Studio agent, with the node's role and instructions in the message.
 * 2. With the workspace's own key: the node's own Studio agent in that workspace's Studio, made on first use.
 * 3. Otherwise Gemini answers through the gateway, and the run is Simulated.
 * Never another account's agent, and a Studio failure is thrown (LyzrError), never swapped for another runtime.
 */
export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const demo = input.demo ? lyzr.demoLyzr() : null;
  if (demo && !input.simulate) {
    const text = await lyzr.chatLyzr(demo.apiKey, { agentId: demo.agentId, userId: input.userId, sessionId: input.sessionId, message: sharedAgentMessage(input) });
    return { text, runtime: "lyzr_shared", createdAgentId: null, lyzrAgentId: demo.agentId, modelLabel: lyzr.LYZR_MODEL.label, simulated: false, note: null };
  }
  if (!input.apiKey || input.simulate || input.demo) {
    const r = await ask({
      instructions: `You are ${input.name}, an agent in an app built with Architect. ${input.description}\n\n${input.instructions}\n\nOutput format: ${input.output}`,
      prompt: input.message,
      maxOutputTokens: input.maxTokens,
      temperature: input.temperature,
      fast: true,
    });
    return { text: r.text, runtime: "gateway", createdAgentId: null, lyzrAgentId: null, modelLabel: r.label, simulated: true, note: null };
  }

  // Same name Save gives it, so Architect's agents are easy to tell apart in Studio.
  const spec = { name: `${input.name} · Architect`, description: input.description, role: input.name, instructions: input.instructions, output: input.output, temperature: input.temperature, maxTokens: input.maxTokens };
  let agentId = input.lyzrAgentId;
  let createdAgentId: string | null = null;
  if (!agentId) agentId = createdAgentId = await lyzr.createLyzrAgent(input.apiKey, spec);
  const text = await lyzr.chatLyzr(input.apiKey, { agentId, userId: input.userId, sessionId: input.sessionId, message: input.message });
  return { text, runtime: "lyzr_agent", createdAgentId, lyzrAgentId: agentId, modelLabel: lyzr.LYZR_MODEL.label, simulated: false, note: null };
}
