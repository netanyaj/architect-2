import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The 3 demo prompts (docs/BLUEPRINT-GENERATION.md), with what each fixture test expects of its questions. */
export const DEMO_PROMPTS = [
  { id: "meeting-prep", blocking: /slack/i }, // the Slack workspace: no safe default
  { id: "lead-scorer", blocking: null },
  { id: "support-triage", blocking: null },
] as const;

export function promptText(id: string): string {
  return readFileSync(join(__dirname, "prompts", `${id}.txt`), "utf8").trim();
}
