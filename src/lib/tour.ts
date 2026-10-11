/**
 * The guided tour on Home (M5.10): five steps through the product's story, each deep-linking to where it happens.
 * A step is done when the person has done it (read from their own product events), so progress survives reloads.
 */
export const TOUR_STEPS = ["plan", "build", "blocker", "launch", "governance"] as const;
export type TourStep = (typeof TOUR_STEPS)[number];

/** Uses Gmail, which the demo workspace hasn't connected: the build stops on a blocker to fix in step 3. */
export const TOUR_PROMPT =
  "Every morning, read new supplier invoices in Gmail, check each one against our rate card, and post any mismatches to #finance in Slack.";

export const TOUR_COPY: Record<TourStep, { title: string; line: string; action: string }> = {
  plan: { title: "Write a plan", line: "One prompt becomes parts, checks and a cost, before anything is built.", action: "Write it" },
  build: { title: "Build it", line: "Click Build and watch each part get built and proved.", action: "Open the plan" },
  blocker: { title: "Fix a blocker", line: "A part waits for an app. Connect it and the build carries on.", action: "Connect the app" },
  launch: { title: "Launch with approval", line: "A Live deploy waits for an Admin. You're one: approve it yourself.", action: "Open Approvals" },
  governance: { title: "See Governance and the audit log", line: "The organisation's rules, and everything that happened.", action: "Open the audit log" },
};

export type TourView = {
  done: TourStep[];
  links: Record<TourStep, string>;
  /** A demo visitor (anonymous sign-in): their workspace is deleted after 7 days. */
  demoVisitor: boolean;
};

export function nextStep(done: readonly TourStep[]): TourStep | null {
  return TOUR_STEPS.find((s) => !done.includes(s)) ?? null;
}
