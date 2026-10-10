/**
 * Editing a built part's check (A-7). The person can change what a part is checked for; the checker then runs the new
 * check against the code already built (simulated), after the cost is shown and the person clicks. The builder can
 * never edit a check. Shared by client and server; no I/O.
 */
import { weakensCheck } from "./plan-diff";

/** Parts with code to check again. One not built yet gets its new check when it's built. */
export const RECHECKABLE = ["built", "sample_data", "needs_connection"];

/** What running a check again costs: a fifth of the part's build, at least 2 credits; about 10 seconds. */
export function checkRerunEstimate(estimateLikely: number | null): { low: number; likely: number; high: number; seconds: number } {
  const likely = Math.max(2, Math.round((estimateLikely ?? 10) * 0.2));
  return { low: Math.max(1, likely - 1), likely, high: likely + 2, seconds: 10 };
}

/** Why a new check can't be saved, or null. */
export function checkEditProblem(before: string, after: string): string | null {
  const a = after.trim();
  if (a.length < 8) return "Say what the part must do to pass, in a sentence.";
  if (a.length > 160) return "Keep the check under 160 characters.";
  if (a === before.trim()) return "Nothing changed in the check yet.";
  return null;
}

/** Whether the new check asks for less than the old one (A-3): then the person says why, and it's saved on the part. */
export function checkEditWeakens(before: string, after: string): boolean {
  return weakensCheck(before, after.trim());
}
