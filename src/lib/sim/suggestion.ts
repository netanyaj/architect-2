import { SCENARIO } from "./timeline";

export type Suggestion = { title: string; button: string; why: string; from: string; to: string };

/** The suggested fix for a Blocked part (screen 6), from the scenario, with the part's check as it would read. */
export function suggestionFor(provedWhen: string): Suggestion & { provedWhen: string } {
  const s = (SCENARIO.variants.paused.override as unknown as Record<string, { suggestion: Suggestion }>)["fix-once"].suggestion;
  const after = provedWhen.includes(s.from) ? provedWhen.replace(s.from, s.to) : `${provedWhen.replace(/\.$/, "")} (up to ${s.to}).`;
  return { ...s, provedWhen: after };
}
