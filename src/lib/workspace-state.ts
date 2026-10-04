import type { Stage } from "@/components/ax/stepper";
import type { Role } from "./db";
import { buildBlockedReason } from "./permissions";
import type { ProjectInput, ProjectSummary } from "./project-status";

export type StageAction = {
  label: string;
  /** Why it can't be pressed (always set while disabled; shown as the title and beside the button). */
  disabledReason?: string;
  /** The short line beside the button, e.g. "Answer 1 question to build · 1,240 credits available". */
  beside?: string;
};

export type WorkspaceState = { stage: Stage; progress?: string; paused: boolean; action: StageAction };

/**
 * Where the project is (the stepper) and its one stage action (BUILD-SPEC §2).
 * Nothing builds without a click, and in M1 nothing can build yet: Build arrives with the plan (M2) and the
 * simulated build (M3), so the action is shown with its cost and the honest reason it's off.
 */
export function workspaceState(input: {
  status: ProjectInput["status"];
  role: Role;
  summary: ProjectSummary;
  planTotal: number | null;
  hasPlan: boolean;
  creditsLeft: number;
}): WorkspaceState {
  const { status, role, summary, planTotal, hasPlan, creditsLeft } = input;
  const viewerReason = buildBlockedReason(role);
  const available = `${creditsLeft.toLocaleString("en-US")} credits available`;

  if (status === "draft") {
    const label = hasPlan && planTotal ? `Build · ~${Math.round(planTotal).toLocaleString("en-US")} credits` : "Build";
    const reason = viewerReason ?? (hasPlan ? "Building starts with the simulated build (M3). Nothing has been built or charged." : "Write the plan first. Plans are written in M2.");
    return {
      stage: "plan",
      progress: hasPlan ? `${summary.total} ${summary.total === 1 ? "part" : "parts"}` : "no plan yet",
      paused: false,
      action: { label, disabledReason: reason, beside: viewerReason ? "Viewers can't build" : `${hasPlan ? "Not built yet" : "Plan first"} · ${available}` },
    };
  }

  if (status === "building" || status === "paused") {
    const paused = status === "paused";
    return {
      stage: "build",
      progress: paused ? "paused at budget" : `${summary.works} of ${summary.total} working`,
      paused,
      action: {
        label: "Launch",
        disabledReason: viewerReason ?? (paused ? "The build is paused at its budget. Raise it or set parts aside first." : "Launch opens when every part works."),
        beside: viewerReason ? "Viewers can't launch" : paused ? "Blocked: budget used" : `${summary.works} of ${summary.total} parts work`,
      },
    };
  }

  // built or live
  return {
    stage: "launch",
    progress: status === "live" ? "Live" : `${summary.works} of ${summary.total} working`,
    paused: false,
    action: {
      label: "Share with your team",
      disabledReason: viewerReason ?? "Sharing and going Live come with Launch (M3).",
      beside: viewerReason ? "Viewers can't share" : summary.next.text,
    },
  };
}
