import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The 3 demo prompts (docs/build/BLUEPRINT-GENERATION.md) plus two that pin down blocking, with what each fixture test
 * expects of its questions: a pattern a blocking question must match, or null for "nothing may block".
 */
export const DEMO_PROMPTS = [
  { id: "meeting-prep", blocking: /slack/i }, // the Slack workspace: no safe default
  { id: "lead-scorer", blocking: null },
  { id: "support-triage", blocking: null },
  { id: "sms-reminder", blocking: /sms|text|messag|phone/i }, // no SMS service connected: no safe default
  { id: "vendor-list", blocking: null }, // nothing to choose for them
] as const;

export function promptText(id: string): string {
  return readFileSync(join(__dirname, "prompts", `${id}.txt`), "utf8").trim();
}
