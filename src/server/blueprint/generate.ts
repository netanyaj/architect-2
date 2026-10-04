import "server-only";

import { Output, streamText, type FilePart, type TextPart } from "ai";
import { applyQuestionRules, BlueprintDraft, Item, normalizeDraft, strictProblems, toKey, validateBlueprint, type Blueprint as BlueprintT, type Item as ItemT } from "@/lib/blueprint";
import { classifyGatewayError, resolveModel, type ModelChoice } from "@/lib/gateway";
import { BLUEPRINT_SYSTEM, blueprintPrompt } from "../prompts/blueprint";

export type Attachment = { name: string; text?: string; image?: { data: Uint8Array; mediaType: string } };

export type GenerateEvents = {
  /** A part is complete and valid on its own (it may still be replaced if the whole plan is retried). */
  onItem?: (item: ItemT, index: number) => void | Promise<void>;
  /** The first attempt failed validation; the plan is being written again. */
  onRetry?: (problems: string[]) => void | Promise<void>;
};

export type GenerateResult = {
  blueprint: BlueprintT;
  tokens: number;
  label: string;
  simulated: boolean;
  ms: number;
};

export class BlueprintInvalid extends Error {
  constructor(public problems: string[]) {
    super(`The plan didn't pass its checks: ${problems.slice(0, 3).join(" ")}`);
    this.name = "BlueprintInvalid";
  }
}

/** One streamed attempt: emits each finished item as soon as the next one starts (or the stream ends). */
async function attempt(
  input: { prompt: string; attachments: Attachment[]; model: ModelChoice; problems?: string[] },
  events: GenerateEvents,
) {
  const resolved = resolveModel(input.model);
  const text = blueprintPrompt({
    prompt: input.prompt,
    attachments: input.attachments.filter((a) => a.text).map((a) => ({ name: a.name, text: a.text! })),
    problems: input.problems,
  });
  const images: FilePart[] = input.attachments
    .filter((a) => a.image)
    .map((a) => ({ type: "file", data: a.image!.data, mediaType: a.image!.mediaType, filename: a.name }));
  const content: (TextPart | FilePart)[] = [{ type: "text", text }, ...images];

  // Errors inside the stream (a 429, an outage) surface later only as "No output generated"; keep the real one.
  let streamError: unknown;
  const result = streamText({
    model: resolved.model,
    instructions: BLUEPRINT_SYSTEM,
    messages: [{ role: "user", content }],
    // A relaxed schema: Gemini rejects the strict one as too complex. The strict rules are checked below.
    output: Output.object({ schema: BlueprintDraft }),
    temperature: 0.2,
    maxRetries: 2,
    timeout: 90_000,
    onError: ({ error }) => {
      streamError = error;
    },
  });

  let emitted = 0;
  const emitUpTo = async (items: unknown[], upTo: number) => {
    while (emitted < upTo) {
      const raw = items[emitted] as { key?: string; title?: string } | undefined;
      const parsed = Item.safeParse(raw ? { ...raw, key: toKey(raw.key || raw.title || `part-${emitted + 1}`) } : raw);
      if (!parsed.success) return; // not complete enough yet; wait for more
      await events.onItem?.(parsed.data, emitted);
      emitted++;
    }
  };
  let output;
  try {
    for await (const partial of result.partialOutputStream) {
      const items = (partial as { items?: unknown[] }).items;
      // An item is finished once the model has moved on to the next one.
      if (Array.isArray(items) && items.length > 1) await emitUpTo(items, items.length - 1);
    }
    output = await result.output;
  } catch (err) {
    throw streamError && classifyGatewayError(streamError, resolved.label) ? streamError : err;
  }
  if (streamError && classifyGatewayError(streamError, resolved.label)) throw streamError;
  await emitUpTo(output.items, output.items.length);
  const usage = await result.totalUsage;
  return { output, tokens: usage.totalTokens ?? 0, label: resolved.label, simulated: resolved.simulated };
}

/**
 * Writes the plan for a request. Validates the result (BLUEPRINT-GENERATION step 4); on failure retries once
 * with the problems appended, then throws BlueprintInvalid. Gateway errors (rate limit, outage) pass through.
 */
export async function generateBlueprint(
  input: { prompt: string; attachments?: Attachment[]; model?: ModelChoice },
  events: GenerateEvents = {},
): Promise<GenerateResult> {
  const started = Date.now();
  const base = { prompt: input.prompt, attachments: input.attachments ?? [], model: input.model ?? "gemini" };
  let tokens = 0;
  let problems: string[] = [];
  for (let round = 0; round < 2; round++) {
    let out;
    try {
      out = await attempt({ ...base, problems: round ? problems : undefined }, events);
    } catch (err) {
      const kind = classifyGatewayError(err, resolveModel(base.model).label);
      if (kind) throw kind;
      // A schema failure from the model's output counts as a validation problem for the retry.
      problems = [`Your output didn't match the required JSON shape: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}`];
      if (round === 0) {
        await events.onRetry?.(problems);
        continue;
      }
      throw new BlueprintInvalid(problems);
    }
    tokens += out.tokens;
    const strict = strictProblems(normalizeDraft(out.output));
    problems = strict.blueprint ? validateBlueprint(strict.blueprint, input.prompt) : strict.problems;
    if (strict.blueprint && problems.length === 0) {
      return { blueprint: applyQuestionRules(strict.blueprint, input.prompt), tokens, label: out.label, simulated: out.simulated, ms: Date.now() - started };
    }
    if (round === 0) await events.onRetry?.(problems);
  }
  throw new BlueprintInvalid(problems);
}
