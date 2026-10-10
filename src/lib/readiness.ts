/**
 * Readiness (A-10): what isn't done yet, part by part, each with its reason, for the stepper and for Launch before
 * every deploy. Parts that work and parts dropped from the plan aren't listed. Shared by client and server; no I/O.
 */
import { providerName } from "./providers";

export type NotDoneStatus = "building" | "attention" | "approval" | "blocked" | "todo";
export type NotDone = { key: string; title: string; status: NotDoneStatus; reason: string };

type Part = { key: string; title: string; status: string; statusDetail?: string | null; provider?: string | null };

const ORDER: Record<NotDoneStatus, number> = { blocked: 0, attention: 1, approval: 2, building: 3, todo: 4 };

/** `budgetPaused`: the build stopped at the project's budget, so parts not built are waiting for it. */
export function whatsNotDone(parts: Part[], opts: { budgetPaused?: boolean } = {}): NotDone[] {
  const out: NotDone[] = [];
  for (const p of parts) {
    const app = providerName(p.provider);
    const row = (status: NotDoneStatus, reason: string) => out.push({ key: p.key, title: p.title, status, reason });
    switch (p.status) {
      case "proposed":
      case "agreed":
        row("todo", opts.budgetPaused ? "Not built yet: the build paused at the budget" : "Not built yet");
        break;
      case "building":
        row("building", p.statusDetail ?? "Building now");
        break;
      case "needs_connection":
        row("attention", `Works with sample data until you connect ${app}`);
        break;
      case "sample_data":
        row("attention", "Uses sample data: add your real data, or leave it out");
        break;
      case "needs_approval":
        row("approval", p.provider ? `Waiting for an Owner or Admin to approve ${app}` : "Waiting for an Owner or Admin's approval");
        break;
      case "paused":
      case "failed":
        row("blocked", "Blocked: its check failed 3 times. Open it to decide");
        break;
      case "deferred":
        row("todo", "Set aside: not in this version");
        break;
    }
  }
  return out.sort((a, b) => ORDER[a.status] - ORDER[b.status]);
}
