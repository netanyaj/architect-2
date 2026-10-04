import type { Stage } from "@/components/ax/stepper";
import type { Role } from "./db";
import { buildBlockedReason } from "./permissions";
import type { ProjectInput, ProjectSummary } from "./project-status";

export type StageAction = {
  label: string;
  /** Why it can't be pressed (set only while disabled; shown as the title and beside the button). */
  disabledReason?: string;
  /** The short line beside the button, e.g. "Answer 1 question to build · 1,240 credits available". */
  beside?: string;
};

export type WorkspaceState = { stage: Stage; progress?: string; paused: boolean; action: StageAction };

export type PlanState = {
  generation: "writing" | "ready" | "failed";
  /** Blocking questions still without an answer (they hold Build, A-0). */
  blockingOpen: number;
  total: number | null;
  parts: number;
  agreed: boolean;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Where the project is (the stepper) and its one stage action (BUILD-SPEC §2).
 * Build is the only way a build starts, and only once the plan is written and every blocking question answered.
 */
export function workspaceState(input: {
  status: ProjectInput["status"];
  role: Role;
  summary: ProjectSummary;
  plan: PlanState | null;
  /** The writer in this tab is streaming (before the database says so). */
  writingNow?: boolean;
  runStatus?: string | null;
  creditsLeft: number;
}): WorkspaceState {
  const { status, role, summary, plan, creditsLeft } = input;
  const viewerReason = buildBlockedReason(role);
  const available = `${creditsLeft.toLocaleString("en-US")} credits available`;

  if (status === "draft") {
    const writing = input.writingNow || plan?.generation === "writing";
    const label = plan?.generation === "ready" && plan.total ? `Build · ~${Math.round(plan.total).toLocaleString("en-US")} credits` : "Build";
    if (!plan && !writing) {
      return { stage: "plan", progress: "no plan yet", paused: false, action: { label, disabledReason: viewerReason ?? "The plan comes first.", beside: viewerReason ? "Viewers can't build" : `Plan first · ${available}` } };
    }
    if (writing) {
      return {
        stage: "plan",
        progress: "writing the plan…",
        paused: false,
        action: { label, disabledReason: viewerReason ?? "The plan is still being written.", beside: viewerReason ? "Viewers can't build" : "Writing the plan…" },
      };
    }
    if (plan!.generation === "failed") {
      return {
        stage: "plan",
        progress: `stopped at ${plural(plan!.parts, "part")}`,
        paused: false,
        action: { label: "Build", disabledReason: viewerReason ?? "Finish the plan first: try again, or switch model.", beside: viewerReason ? "Viewers can't build" : undefined },
      };
    }
    const open = plan!.blockingOpen;
    const questionReason = open ? `Answer ${plural(open, "question")} to build` : undefined;
    return {
      stage: "plan",
      progress: open ? `${plural(open, "question")} left` : plural(plan!.parts, "part"),
      paused: false,
      action: {
        label,
        disabledReason: viewerReason ?? (questionReason ? `${questionReason}. Build waits because there's no safe default.` : undefined),
        beside: viewerReason ? "Viewers can't build" : questionReason ? `${questionReason} · ${available}` : available,
      },
    };
  }

  if (status === "building" || status === "paused") {
    const paused = status === "paused";
    const queued = input.runStatus === "queued";
    return {
      stage: "build",
      progress: paused ? "paused at budget" : queued ? "build queued" : `${summary.works} of ${summary.total} working`,
      paused,
      action: {
        label: "Launch",
        disabledReason: viewerReason ?? (paused ? "The build is paused at its budget. Raise it or set parts aside first." : "Launch opens when every part works."),
        beside: viewerReason ? "Viewers can't launch" : paused ? "Blocked: budget used" : queued ? "Build queued" : `${summary.works} of ${summary.total} parts work`,
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
