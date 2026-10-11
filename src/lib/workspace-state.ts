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
  /** Navigation, not an action: the button opens Launch (it's never disabled; M5.5 review). */
  opensLaunch?: boolean;
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

/** The build as it plays (from the replayed run), for the stepper and the stage action. */
export type BuildProgress = {
  works: number;
  total: number;
  /** Parts Blocked after 3 fixes. */
  blocked: number;
  /** "about 6 min", while the run plays. */
  eta: string | null;
  playing: boolean;
  budgetPaused: boolean;
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
  build?: BuildProgress;
  /** Parts that need something before they work (what's not done, not counting parts set aside). */
  toFix?: number;
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

  // After Build, the stage action is navigation: it opens Launch, whose checklist is the release gate. It carries
  // how many things are left to fix, and is never disabled (M5.5 review). Blockers are acted on in Parts.
  const toFix = input.toFix ?? 0;
  const openLaunch: StageAction = { label: toFix ? `Launch · ${toFix} to fix` : "Launch", opensLaunch: true };

  if ((status === "building" || status === "paused") && input.build) {
    const b = input.build;
    const working = `${b.works} of ${b.total} working`;
    if (b.budgetPaused) return { stage: "build", progress: `paused at budget · ${working}`, paused: true, action: openLaunch };
    if (b.playing) return { stage: "build", progress: b.eta ? `${working} · ${b.eta}` : working, paused: false, action: openLaunch };
    if (b.blocked) return { stage: "build", progress: `${working} · ${b.blocked} blocked`, paused: true, action: openLaunch };
  }

  if (status === "building" || status === "paused") {
    const paused = status === "paused";
    const queued = input.runStatus === "queued";
    return { stage: "build", progress: paused ? "paused at budget" : queued ? "build queued" : `${summary.works} of ${summary.total} working`, paused, action: openLaunch };
  }

  // Built or live: the Launch stage, where sharing and going Live happen (screen 4).
  return { stage: "launch", progress: status === "live" ? "Live" : `${summary.works} of ${summary.total} working`, paused: false, action: openLaunch };
}
