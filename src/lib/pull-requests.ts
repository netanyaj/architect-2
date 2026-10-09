/**
 * Changes as pull requests (B-4, B-5), simulated: for a project imported from a repo, each build or applied change
 * is a branch and a PR into main. Shared by client and server; no I/O.
 */
import { slugOf } from "./dev-view";

export type PrPart = { key: string; title: string; status: string; tests: string[] };
export type PrChecks = "running" | "passing" | "failing";

export type PullRequestView = {
  id: string;
  number: number;
  branch: string;
  base: string;
  title: string;
  status: "open" | "merged" | "closed";
  checks: PrChecks;
  parts: PrPart[];
  createdAt: string;
  mergedAt: string | null;
  mergedBy: string | null;
  /** A Builder asked to merge under governance; an Owner or Admin approves the push. */
  pushRequested: boolean;
};

/** The branch a version's work goes on (Developer view shows the same). */
export function prBranch(projectName: string, version: number): string {
  return `architect/${slugOf(projectName)}-v${version}`;
}

/** The PR's checks: running while its build plays, then passing only if every part it implements works. */
export function prChecks(runStatus: string | null, parts: { status: string }[]): PrChecks {
  if (runStatus === "running" || runStatus === "queued") return "running";
  return parts.every((p) => p.status === "built" || p.status === "sample_data") ? "passing" : "failing";
}

/** A PR's title from the kind of run and its parts. */
export function prTitle(kind: string, parts: { title: string }[]): string {
  const names = parts.slice(0, 2).map((p) => p.title);
  const more = parts.length > 2 ? ` and ${parts.length - 2} more` : "";
  return `${kind === "change" ? "Change" : "Build"}: ${names.join(", ")}${more}`.slice(0, 120);
}

/** Why a PR can't be merged yet, or null. Merging is the push to main: it always needs the person's click. */
export function mergeBlocker(pr: Pick<PullRequestView, "status" | "checks" | "pushRequested">, canMerge: boolean): string | null {
  if (pr.status === "merged") return "Already merged into main.";
  if (pr.status === "closed") return "This pull request was closed.";
  if (pr.checks === "running") return "Wait for its checks to finish.";
  if (pr.checks === "failing") return "Its checks are failing. Fix or set aside the parts that don't work first.";
  if (pr.pushRequested && !canMerge) return "Your request is waiting for an Owner or Admin.";
  return null;
}

/**
 * The sync banner (B-5), simulated with ?sim=sync: commits landed on main from outside Architect, so the checks of
 * the parts they touch ran again. Picks a part that already works, with a check.
 */
export function syncNotice(parts: { key: string; title: string; status: string }[]) {
  const touched = parts.find((p) => p.status === "built");
  const commits = [
    { sha: "77be1f0", message: "Bump express to 4.21.2", author: "dependabot" },
    { sha: "a41c9e2", message: "Fix typo in README", author: "Sam" },
  ];
  return {
    title: `${commits.length} commits on main from outside Architect · checks re-run for ${touched ? "1 part" : "0 parts"}`,
    commits,
    rerun: touched ? { key: touched.key, title: touched.title, result: "passed" as const } : null,
  };
}
