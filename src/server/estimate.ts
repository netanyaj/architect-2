/**
 * The estimator (A-4), prototype version (docs/BLUEPRINT-GENERATION.md). Prices never come from the model:
 * every part is priced here from its class, size and the chosen model. In the product these medians come from
 * metered history; here they're a seeded table. Pure, so it runs in tests and on the server alike.
 */
import type { Item, ItemClass } from "@/lib/blueprint";
import type { ModelChoice } from "@/lib/models";

type ClassStats = {
  likely: number; // credits at size m
  low: number; // p50
  high: number; // p90
  fixRate: number;
  seededBuilds: number; // drives confidence
  driver: string; // the main cost driver, in plain words
};

export const CLASS_TABLE: Record<ItemClass, ClassStats> = {
  "screen.list": { likely: 12, low: 10, high: 16, fixRate: 0.15, seededBuilds: 24, driver: "a screen with a list and filters" },
  "screen.detail": { likely: 10, low: 8, high: 14, fixRate: 0.1, seededBuilds: 18, driver: "a detail screen" },
  "screen.form": { likely: 12, low: 10, high: 17, fixRate: 0.2, seededBuilds: 12, driver: "a form with checks on what's typed" },
  "integration.read_email": { likely: 8, low: 6, high: 10, fixRate: 0.2, seededBuilds: 14, driver: "reading email" },
  "integration.calendar": { likely: 10, low: 8, high: 12, fixRate: 0.1, seededBuilds: 21, driver: "reading a calendar" },
  "integration.chat_send": { likely: 12, low: 10, high: 14, fixRate: 0.1, seededBuilds: 30, driver: "sending chat messages" },
  "integration.crm_lookup": { likely: 11, low: 9, high: 13, fixRate: 0.25, seededBuilds: 7, driver: "looking things up in a CRM" },
  "agent.summariser": { likely: 16, low: 12, high: 20, fixRate: 0.4, seededBuilds: 16, driver: "an AI agent that summarises" },
  "agent.researcher": { likely: 24, low: 20, high: 28, fixRate: 0.35, seededBuilds: 4, driver: "an AI agent that researches" },
  "data.table": { likely: 9, low: 7, high: 11, fixRate: 0.05, seededBuilds: 26, driver: "a data table" },
  "data.import": { likely: 6, low: 5, high: 9, fixRate: 0.2, seededBuilds: 8, driver: "importing data" },
  "quality.schedule": { likely: 4, low: 3, high: 6, fixRate: 0.1, seededBuilds: 19, driver: "a schedule" },
};

const SIZE: Record<Item["size"], number> = { s: 0.7, m: 1.0, l: 1.5 };

/** Model price factors: cheaper models are below 1.0 (the free OpenRouter model is cheapest). */
export const MODEL_PRICE_FACTOR: Record<ModelChoice, number> = { openrouter: 0.6, gemini: 0.8, claude: 1.0, gpt: 1.0, private: 0.8 };

/** One credit-weighted unit is a typical 12-credit part; each takes about 45 s to build. */
const CREDITS_PER_UNIT = 12;
const SECONDS_PER_UNIT = 45;

export type Estimate = {
  low: number;
  likely: number;
  high: number;
  confidence: "low" | "medium" | "high";
  driver: string;
  seconds: number;
};

export function estimate(item: Pick<Item, "item_class" | "size">, model: ModelChoice = "gemini"): Estimate {
  const c = CLASS_TABLE[item.item_class];
  const f = SIZE[item.size] * MODEL_PRICE_FACTOR[model];
  const fix = c.likely * f * c.fixRate * 0.3; // expected fix allowance, added to likely and p90
  const likely = c.likely * f + fix;
  return {
    low: Math.max(1, Math.round(c.low * f)),
    likely: Math.max(1, Math.round(likely)),
    high: Math.max(1, Math.round(c.high * f + fix)),
    confidence: c.seededBuilds >= 10 ? "high" : c.seededBuilds >= 5 ? "medium" : "low",
    driver: c.driver,
    seconds: (likely / CREDITS_PER_UNIT) * SECONDS_PER_UNIT,
  };
}

export type PlanTotals = { low: number; likely: number; high: number; minutes: number };

/** Totals for the parts that will be built (set-aside and dropped parts don't count). */
export function totals(estimates: Pick<Estimate, "low" | "likely" | "high" | "seconds">[]): PlanTotals {
  const sum = (k: "low" | "likely" | "high" | "seconds") => estimates.reduce((s, e) => s + e[k], 0);
  return {
    low: Math.round(sum("low")),
    likely: Math.round(sum("likely")),
    high: Math.round(sum("high")),
    minutes: Math.max(1, Math.round(sum("seconds") / 60)),
  };
}

/** Writing the plan itself costs a little and is shown in Usage: about 1 credit per 3,000 tokens, at least 1. */
export function draftingCredits(totalTokens: number | undefined): number {
  return Math.max(1, Math.ceil((totalTokens ?? 0) / 3000));
}
