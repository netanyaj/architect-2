/** The models the picker offers. Shared by client and server; availability (real vs simulated) comes from the gateway. */
export const MODEL_CHOICES = ["gemini", "openrouter", "claude", "gpt"] as const;
export type ModelChoice = (typeof MODEL_CHOICES)[number];

export const MODEL_LABEL: Record<ModelChoice, string> = {
  gemini: "Gemini",
  openrouter: "OpenRouter (free)",
  claude: "Claude Sonnet",
  gpt: "GPT",
};

export type ModelOption = { choice: ModelChoice; label: string; simulated: boolean };

/** Older rows say "claude-sonnet"; anything unknown falls back to Gemini. */
export function toModelChoice(value: string | null | undefined): ModelChoice {
  if (!value) return "gemini";
  if (value.startsWith("claude")) return "claude";
  if (value.startsWith("gpt")) return "gpt";
  return (MODEL_CHOICES as readonly string[]).includes(value) ? (value as ModelChoice) : "gemini";
}
