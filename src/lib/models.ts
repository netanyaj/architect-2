/** The models the picker offers. Shared by client and server; availability (real vs simulated) comes from the gateway. */
/** "private" is the organisation's own or self-hosted model, registered in Governance › Models (C-2). */
export const MODEL_CHOICES = ["gemini", "openrouter", "claude", "gpt", "private"] as const;
export type ModelChoice = (typeof MODEL_CHOICES)[number];

export const MODEL_LABEL: Record<ModelChoice, string> = {
  gemini: "Gemini",
  openrouter: "OpenRouter (free)",
  claude: "Claude Sonnet",
  gpt: "GPT",
  private: "Your private model",
};

/** A short note under a model in the picker. */
export const MODEL_NOTE: Partial<Record<ModelChoice, string>> = { openrouter: "Free · can be slow", private: "Registered by your admin" };

/** Relative cost in words (M5.8, never numbers in the picker), from the estimator's price factors. */
export const MODEL_COST_WORDS: Record<ModelChoice, string> = {
  openrouter: "Uses the fewest credits · can be slow",
  gemini: "Uses fewer credits",
  private: "Uses fewer credits · registered by your admin",
  claude: "Uses more credits",
  gpt: "Uses more credits",
};

/**
 * Auto (M5.8), first in the picker and the default for new projects: "Picks a model for each step". In this prototype
 * every step goes to the workspace's Architect model (Gemini unless the policy picks another allowed one).
 */
export const AUTO = "auto" as const;
export type ModelPick = ModelChoice | typeof AUTO;
export const AUTO_LABEL = "Auto";
export const AUTO_NOTE = "Picks a model for each step";

export function toModelPick(value: string | null | undefined): ModelPick {
  return value === AUTO ? AUTO : toModelChoice(value);
}

/** The model a step runs on: Auto resolves to the preferred model if it's allowed, else the first allowed one. */
export function resolvePick(value: string | null | undefined, allowed: readonly ModelChoice[], preferred: ModelChoice = DEFAULT_MODEL): ModelChoice {
  if (value !== AUTO) return toModelChoice(value);
  return allowed.includes(preferred) ? preferred : allowed.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : (allowed[0] ?? DEFAULT_MODEL);
}

/** Gemini is the default everywhere a model isn't chosen yet. */
export const DEFAULT_MODEL: ModelChoice = "gemini";

export type ModelOption = { choice: ModelChoice; label: string; simulated: boolean };

/** Older rows say "claude-sonnet"; anything unknown falls back to Gemini. */
export function toModelChoice(value: string | null | undefined): ModelChoice {
  if (!value) return "gemini";
  if (value.startsWith("claude")) return "claude";
  if (value.startsWith("gpt")) return "gpt";
  return (MODEL_CHOICES as readonly string[]).includes(value) ? (value as ModelChoice) : "gemini";
}
