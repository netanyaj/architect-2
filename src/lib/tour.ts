/**
 * The guided tour (M5.10; rebuilt in round 7 on the shadcn tour component). Three chapters: the story (one prompt to an
 * approved launch), "Find your way around" (one step per side-nav item), and Help and finish. It starts on everyone's
 * first sign-in, Skip is always there, and "Take the tour" stays in the side nav, Resources and ⌘K. Progress is saved
 * in user_preferences.tour, so a reload picks up where the person was.
 */

/** The product's story, as events: used by analytics and by the Governance page's "seen" mark. */
export const TOUR_STEPS = ["plan", "build", "blocker", "launch", "governance"] as const;
export type TourStep = (typeof TOUR_STEPS)[number];

/** Uses Gmail, which the demo workspace hasn't connected: the build stops on a blocker the tour then fixes. */
export const TOUR_PROMPT =
  "Every morning, read new supplier invoices in Gmail, check each one against our rate card, and post any mismatches to #finance in Slack.";

export const CHAPTERS = ["story", "around", "finish"] as const;
export type Chapter = (typeof CHAPTERS)[number];
export const CHAPTER_TITLE: Record<Chapter, string> = { story: "The story", around: "Find your way around", finish: "Help and finish" };

/** Where the person is in the tour (user_preferences.tour). */
export type TourPrefs = {
  /** The welcome was shown once (first sign-in), whatever they chose. */
  welcomed?: boolean;
  /** Started, and not yet finished or skipped. */
  started?: boolean;
  /** "Skip tour". Take the tour brings it back, from where they were. */
  dismissed?: boolean;
  /** Reached the end. Take the tour starts again from the beginning. */
  finished?: boolean;
  /** The step they're on: a chapter and a step id, so a reload resumes there. */
  chapter?: Chapter;
  step?: string;
  /** The project the tour made in chapter 1, for the steps that come back to it. */
  projectId?: string;
};

/** What the tour needs to know about the person and their workspace, from the server. */
export type TourView = {
  /** Show the welcome now: first sign-in. */
  welcome: boolean;
  /** Mid-tour: resume at `chapter`/`step`. */
  active: boolean;
  chapter: Chapter | null;
  step: string | null;
  projectId: string | null;
  /** A demo visitor (anonymous sign-in): their workspace is deleted after 7 days. */
  demoVisitor: boolean;
  governance: boolean;
  role: "owner" | "admin" | "builder" | "viewer";
  personal: boolean;
  /** The seeded Acme Ops this person owns, to switch to when the tour starts in Personal. */
  demoWorkspaceId: string | null;
  canResetDemo: boolean;
};

export const NEW_IN_2 = "New in Architect 2.0";
