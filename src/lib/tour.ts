/**
 * The guided tour (M5.10, v2 in M6): five steps through the product's story, each deep-linking to where it happens.
 * A step is done when the person has done it in the current workspace (read from their own product events), so
 * progress survives reloads. Once started, a small guide stays at the bottom left of every app page.
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
  launch: { title: "Launch with approval", line: "Live waits for an Owner or Admin. You're the Owner: approve it yourself.", action: "Open Approvals" },
  governance: { title: "See Governance and the audit log", line: "The organisation's rules, and everything that happened.", action: "Open the audit log" },
};

/** What the person chose about the tour (user_preferences.tour). */
export type TourPrefs = {
  /** "Don't show again". Take the tour (Resources, ⌘K) brings it back. */
  dismissed?: boolean;
  /** Started (Start the tour), or put away to the guide with ×. Until then, Home shows the tour card. */
  started?: boolean;
  /** The guide is shrunk to a dot. */
  minimised?: boolean;
  /** The finish card was closed: the tour has gone away. */
  finished?: boolean;
  /** Steps whose "done" message was shown, so each shows once. */
  celebrated?: TourStep[];
  /** Hints closed with "Got it". */
  hints?: TourStep[];
};

export type TourView = {
  done: TourStep[];
  links: Record<TourStep, string>;
  /** A demo visitor (anonymous sign-in): their workspace is deleted after 7 days. */
  demoVisitor: boolean;
  started: boolean;
  minimised: boolean;
  finished: boolean;
  celebrated: TourStep[];
  hints: TourStep[];
  /** The Owner can reset the demo data (Settings), offered on the finish card. */
  canResetDemo: boolean;
};

/** The guide shows on every app page once the tour is started, until its finish card is closed. */
export function guideActive(t: TourView | null): t is TourView {
  return Boolean(t && t.started && !t.finished);
}

/** "Fix a blocker" → "fix a blocker", for "Next: …" inside a sentence. */
export function stepPhrase(s: TourStep): string {
  const title = TOUR_COPY[s].title;
  return title[0].toLowerCase() + title.slice(1);
}

export function nextStep(done: readonly TourStep[]): TourStep | null {
  return TOUR_STEPS.find((s) => !done.includes(s)) ?? null;
}
