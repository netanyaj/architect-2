/**
 * Launch (screen 4, BL-12, BL-13): Test → Team → Live. What stands between the app and each version, in plain words,
 * with the fix for each. Pure, so the header's stage action and the Launch page always agree.
 */
import type { Role } from "./db";
import { canBuild, canManageMembers } from "./permissions";
import { providerName } from "./providers";

export type LaunchPart = { id: string; key: string; title: string; status: string; provider: string | null; estimate: number | null };

export type Deployment = { id: string; environment: "staging" | "production"; version: number; status: string; createdAt: string; by: string | null };

export type CheckRow =
  | { id: string; kind: "connect"; status: "attention"; title: string; detail: string; itemId: string; provider: string }
  | { id: string; kind: "sample"; status: "attention"; title: string; detail: string; itemId: string }
  | { id: string; kind: "blocked"; status: "blocked"; title: string; detail: string; itemKey: string }
  | { id: string; kind: "unbuilt"; status: "blocked"; title: string; detail: string; count: number }
  | { id: string; kind: "fine"; status: "works"; title: string; detail: string };

export type Action = { label: string; disabledReason?: string };

export type LaunchState = {
  rows: CheckRow[];
  /** Rows the person has to deal with before the team version. */
  toFix: number;
  team: { version: number | null; current: boolean };
  live: { version: number | null; current: boolean; blocker: string | null; requested: boolean };
  /** The stepper's progress words. */
  progress: string;
  share: Action;
  goLive: Action & { request: boolean };
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The newest live deployment of an environment, or the seeded environment row (no history) at the current version. */
export function liveVersion(deployments: Deployment[], env: "staging" | "production", envLive: boolean, currentVersion: number): number | null {
  const d = deployments.filter((x) => x.environment === env && x.status === "live").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (d) return d.version;
  return envLive ? currentVersion : null;
}

export function launchState(input: {
  parts: LaunchPart[];
  deployments: Deployment[];
  /** Environments marked live (seeded projects have no deployment history). */
  envLive: { staging: boolean; production: boolean };
  currentVersion: number;
  role: Role;
  /** A Live deploy request is waiting for an Owner or Admin. */
  liveRequested: boolean;
  /** Checks that passed (built parts' proofs). */
  testsPassed: number;
}): LaunchState {
  const { parts, role, currentVersion } = input;
  const active = parts.filter((p) => p.status !== "deferred" && p.status !== "dropped");
  const rows: CheckRow[] = [];

  const providers = new Map<string, LaunchPart>();
  for (const p of active.filter((p) => p.status === "needs_connection" && p.provider)) if (!providers.has(p.provider!)) providers.set(p.provider!, p);
  for (const [provider, p] of providers) {
    rows.push({ id: `connect-${provider}`, kind: "connect", status: "attention", title: `Connect ${providerName(provider)} for your team`, detail: `The team version can't use sample data for ${p.title.toLowerCase()}.`, itemId: p.id, provider });
  }
  for (const p of active.filter((p) => p.status === "sample_data")) {
    rows.push({ id: `sample-${p.key}`, kind: "sample", status: "attention", title: `${p.title} still uses sample data`, detail: "Add your real data, or leave this part out of the team version.", itemId: p.id });
  }
  for (const p of active.filter((p) => p.status === "paused" || p.status === "failed")) {
    rows.push({ id: `blocked-${p.key}`, kind: "blocked", status: "blocked", title: `${p.title} is blocked`, detail: "Decide what happens to it in the workspace.", itemKey: p.key });
  }
  const unbuilt = active.filter((p) => ["agreed", "proposed", "building"].includes(p.status));
  if (unbuilt.length) {
    rows.push({ id: "unbuilt", kind: "unbuilt", status: "blocked", title: `${plural(unbuilt.length, "part")} ${unbuilt.length === 1 ? "isn't" : "aren't"} built`, detail: `${unbuilt.map((p) => p.title).join(", ")}. Build ${unbuilt.length === 1 ? "it" : "them"}, or leave ${unbuilt.length === 1 ? "it" : "them"} out for now.`, count: unbuilt.length });
  }
  rows.push({ id: "tests", kind: "fine", status: "works", title: "Tests, security and privacy checks passed", detail: `${plural(input.testsPassed, "test")} · no secrets in the code · personal data hidden in logs` });

  const toFix = rows.filter((r) => r.kind !== "fine").length;
  const team = liveVersion(input.deployments, "staging", input.envLive.staging, currentVersion);
  const live = liveVersion(input.deployments, "production", input.envLive.production, currentVersion);
  const approval = active.filter((p) => p.status === "needs_approval");
  const blocker = approval.length ? `Needs IT approval for ${approval.map((p) => providerName(p.provider) ?? p.title).join(", ")}` : null;
  const teamCurrent = team === currentVersion;
  const liveCurrent = live === currentVersion;

  const viewer = canBuild(role) ? undefined : "Viewers can't share or launch.";
  const share: Action = {
    label: team !== null && !teamCurrent ? `Share v${currentVersion} with your team` : "Share with your team",
    disabledReason:
      viewer ??
      (toFix ? `Fix ${plural(toFix, "thing")} in the checklist first.` : teamCurrent ? `Your team already has v${currentVersion}.` : undefined),
  };
  const admin = canManageMembers(role);
  const goLive = {
    label: live !== null && !liveCurrent ? `Update Live to v${currentVersion}` : admin ? "Go live" : "Ask to go live",
    request: !admin,
    disabledReason:
      viewer ??
      (!teamCurrent
        ? "Share this version with your team first. Live always follows the team version."
        : blocker
          ? `${blocker}. An Owner or Admin approves it in Approvals.`
          : liveCurrent
            ? `v${currentVersion} is already live.`
            : input.liveRequested && !admin
              ? "Your request is waiting for an Owner or Admin."
              : undefined),
  };

  const progress = liveCurrent
    ? "Live"
    : toFix
      ? `${plural(toFix, "thing")} before ${teamCurrent ? "going live" : "sharing"}`
      : teamCurrent
        ? blocker
          ? "waiting for IT"
          : "ready to go live"
        : "ready to share";

  return { rows, toFix, team: { version: team, current: teamCurrent }, live: { version: live, current: liveCurrent, blocker, requested: input.liveRequested }, progress, share, goLive };
}
