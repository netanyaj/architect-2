/**
 * Launch (screen 4, BL-12, BL-13): Test → Team → Live. What stands between the app and each version, in plain words,
 * with the fix for each. Pure, so the header's stage action and the Launch page always agree.
 */
import { z } from "zod";
import type { Role } from "./db";
import { blockedLine, type FlowPath } from "./egress";
import { canBuild, canManageMembers } from "./permissions";
import { providerName } from "./providers";

export type LaunchPart = { id: string; key: string; title: string; status: string; provider: string | null; estimate: number | null };

export type Deployment = {
  id: string;
  environment: "staging" | "production";
  version: number;
  status: string;
  createdAt: string;
  by: string | null;
  /** A failed deploy: the step that failed and why (the version before stays live). */
  failure?: { step: string; reason: string } | null;
};

/* Launch settings (one object per project), all simulated: who can open it, analytics, the listing, domains. */
export const ACCESS = {
  link: { label: "Anyone with the link", detail: "No sign-in. Good for customer-facing apps." },
  domain: { label: "Signed-in people at your domain", detail: "They sign in with Google or email at your company's domain." },
  invited: { label: "Invited people only", detail: "Only people you add can open it." },
} as const;
export type Access = keyof typeof ACCESS;

export const MARKETPLACE_CATEGORIES = ["Productivity", "Sales", "Support", "Operations", "Marketing", "HR", "Finance", "Engineering"] as const;

export const Listing = z.object({
  scope: z.enum(["off", "workspace", "public"]),
  category: z.enum(MARKETPLACE_CATEGORIES),
  description: z.string().trim().min(1, "Add a description.").max(2000),
  summary: z.string().trim().min(1, "Add a short description.").max(160, "Keep the short description to 160 characters."),
  tags: z.array(z.string().trim().min(1).max(30)).max(8, "Use up to 8 tags."),
});
export type Listing = z.infer<typeof Listing>;

export type DomainState = { name: string; status: "dns" | "checking" | "secured"; since: string };

export type LaunchSettings = {
  access?: Access;
  analytics?: boolean;
  listing?: Listing;
  domains?: Partial<Record<"staging" | "production", DomainState>>;
  /** How the app's own users sign in (BL-10): Google by default; SSO with governance on. */
  signIn?: "google" | "email" | "sso";
};

/** "meeting-prep.acme.com", "app.example.co.uk": a host name with at least one dot, no scheme or path. */
export const DomainName = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, "Use a web address like app.yourcompany.com, without https://.");

/** The steps every deploy goes through (docs/SIMULATOR.md "Deploys"). `?sim=deployfail` fails the health check. */
export const DEPLOY_STEPS = ["Build", "Database changes", "Web address", "Health check"] as const;

/** The CNAME every custom domain points at (simulated). */
export const CNAME_TARGET = "cname.architect.app";
/** How long "Checking" takes in the simulation. */
export const DOMAIN_CHECK_MS = 4000;

/**
 * About how many credits a month the live app costs at current use (shown before going live, review gap 5).
 * A simple per-part rate: agents run on every trigger, integrations poll, screens and checks cost little.
 */
export function runningCredits(parts: { status: string; grp: string }[]): number {
  const rate: Record<string, number> = { agents: 12, integrations: 4, data: 2, features: 1, quality: 1 };
  return parts.filter((p) => p.status !== "deferred" && p.status !== "dropped").reduce((s, p) => s + (rate[p.grp] ?? 1), 0);
}

export type CheckRow =
  | { id: string; kind: "connect"; status: "attention"; title: string; detail: string; itemId: string; provider: string }
  | { id: string; kind: "sample"; status: "attention"; title: string; detail: string; itemId: string }
  | { id: string; kind: "blocked"; status: "blocked"; title: string; detail: string; itemKey: string }
  | { id: string; kind: "unbuilt"; status: "blocked"; title: string; detail: string; count: number }
  | { id: string; kind: "egress"; status: "blocked"; title: string; detail: string; path: FlowPath }
  | { id: string; kind: "keys"; status: "attention"; title: string; detail: string; names: string[] }
  | { id: string; kind: "external"; status: "approval"; title: string; detail: string; provider: string; waiting: boolean }
  | { id: string; kind: "fine"; status: "works"; title: string; detail: string };

export type Action = { label: string; disabledReason?: string };

export type LaunchState = {
  /** No governance: Test → Go live, the team version optional (review gap 1). */
  fast: boolean;
  rows: CheckRow[];
  /** Rows the person has to deal with before the team version. */
  toFix: number;
  team: { version: number | null; current: boolean };
  live: { version: number | null; current: boolean; blocker: string | null; requested: boolean; behind: number; decision: LiveDecision | null };
  /** The newest deploy failed (the version before it is still serving). */
  failure: { environment: "staging" | "production"; version: number; step: string; reason: string } | null;
  /** The stepper's progress words. */
  progress: string;
  share: Action;
  goLive: Action & { request: boolean };
  repo: RepoRoute | null;
};

/** The newest decision on a Live deploy request for this version (C-5): who, and why when rejected. */
export type LiveDecision = { status: "approved" | "rejected"; by: string; reason: string | null; version: number | null };

/** The decision that counts for this version: the newest one for it (a request that named no version counts too). */
export function decisionFor(decisions: LiveDecision[], version: number): LiveDecision | null {
  return decisions.find((d) => d.version === null || d.version === version) ?? null;
}

/** The deploy route of a project from a repo (decided in M3, review gap 6). */
export type RepoRoute = { prNumber: number | null; branch: string | null; merged: boolean };

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
  /** The workspace's governance setting (Settings). Off: no approvals, and the team version is optional. */
  governance: boolean;
  /** A Live deploy request is waiting for an Owner or Admin. */
  liveRequested: boolean;
  /** An admin decided this version's request, or an allow-rule lets this project go live without one (C-10). */
  liveDecisions?: LiveDecision[];
  liveRule?: boolean;
  /** Keys and passwords Live can't run without (must-fix for Live, not for the team version). */
  keysMissingForLive?: string[];
  /** The permission rule on Live deploys (C-10). Off, a Builder goes live without asking. Default on. */
  deployNeedsApproval?: boolean;
  /** Services called with an API key that wait for an admin's OK before Live (C-10). Must-fix for Live only. */
  externalCalls?: { provider: string; parts: string[]; waiting: boolean }[];
  /** Checks that passed (built parts' proofs). */
  testsPassed: number;
  /** Where the app's data would go (C-4), with governance on. A path the policy doesn't allow blocks every deploy. */
  flows?: FlowPath[];
  /** A project from a repo ships through its PR: the team version builds from the PR branch, Live from main after merge. */
  repo?: RepoRoute | null;
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
  // Data that would go somewhere the organisation doesn't allow (C-4): fixed before any deploy.
  const egress = (input.flows ?? []).filter((f) => !f.allowed);
  for (const f of egress) rows.push({ id: `egress-${f.id}`, kind: "egress", status: "blocked", ...blockedLine(f), path: f });
  const keysMissing = input.keysMissingForLive ?? [];
  if (keysMissing.length) {
    rows.push({ id: "keys-live", kind: "keys", status: "attention", title: `${plural(keysMissing.length, "key")} ${keysMissing.length === 1 ? "isn't" : "aren't"} set for Live`, detail: `${keysMissing.join(", ")}. Live can't run without ${keysMissing.length === 1 ? "it" : "them"}. Set ${keysMissing.length === 1 ? "it" : "them"} in Keys and passwords.`, names: keysMissing });
  }
  const external = input.externalCalls ?? [];
  for (const x of external) {
    const name = providerName(x.provider);
    rows.push({
      id: `external-${x.provider}`,
      kind: "external",
      status: "approval",
      title: `${name} is called with a key: an Owner or Admin allows it first`,
      detail: `${x.parts.join(", ")} ${x.parts.length === 1 ? "calls" : "call"} ${name} with an API key. Live waits until it's allowed (the external-calls rule).`,
      provider: x.provider,
      waiting: x.waiting,
    });
  }
  const unbuilt = active.filter((p) => ["agreed", "proposed", "building"].includes(p.status));
  if (unbuilt.length) {
    rows.push({ id: "unbuilt", kind: "unbuilt", status: "blocked", title: `${plural(unbuilt.length, "part")} ${unbuilt.length === 1 ? "isn't" : "aren't"} built`, detail: `${unbuilt.map((p) => p.title).join(", ")}. Build ${unbuilt.length === 1 ? "it" : "them"}, or leave ${unbuilt.length === 1 ? "it" : "them"} out for now.`, count: unbuilt.length });
  }
  // The pre-publish checks that passed (BL-13), each named: tests, the security scan, and personal data.
  rows.push({ id: "tests", kind: "fine", status: "works", title: "Tests passed", detail: `${plural(input.testsPassed, "test")}, each part's check included` });
  rows.push({ id: "security", kind: "fine", status: "works", title: "Security scan passed", detail: "No keys or passwords in the code; they live in Keys and passwords" });
  rows.push({ id: "privacy", kind: "fine", status: "works", title: "Personal data is hidden in logs", detail: "Email addresses, phone numbers and card numbers are taken out before anything is logged" });

  const toFix = rows.filter((r) => r.kind !== "fine").length;
  // A key missing for Live, or an external call waiting for an admin, doesn't hold the team version.
  const toFixTeam = rows.filter((r) => r.kind !== "fine" && r.kind !== "keys" && r.kind !== "external").length;
  const team = liveVersion(input.deployments, "staging", input.envLive.staging, currentVersion);
  const live = liveVersion(input.deployments, "production", input.envLive.production, currentVersion);
  const fast = !input.governance;
  const approval = active.filter((p) => p.status === "needs_approval");
  const blocker = !fast && approval.length ? `Needs IT approval for ${approval.map((p) => providerName(p.provider) ?? p.title).join(", ")}` : null;
  const teamCurrent = team === currentVersion;
  const liveCurrent = live === currentVersion;

  const viewer = canBuild(role) ? undefined : "Viewers can't share or launch.";
  const share: Action = {
    label: team !== null && !teamCurrent ? `Share v${currentVersion} with your team` : "Share with your team",
    disabledReason:
      viewer ??
      (toFixTeam ? `Fix ${plural(toFixTeam, "thing")} in the checklist first.` : teamCurrent ? `Your team already has v${currentVersion}.` : undefined),
  };
  // Without governance there's nobody to approve: anyone who can build goes live (review gap 1).
  // An approval for this version, or an allow-rule for this project, lets a Builder go live without asking again.
  const decision = input.liveRequested ? null : decisionFor(input.liveDecisions ?? [], currentVersion);
  const admin = fast || canManageMembers(role) || decision?.status === "approved" || Boolean(input.liveRule) || input.deployNeedsApproval === false;
  const behind = live !== null && !liveCurrent ? Math.max(1, currentVersion - live) : 0;
  const goLive = {
    label: behind ? "Update live" : admin ? "Go live" : "Ask to go live",
    request: !admin,
    disabledReason:
      viewer ??
      (egress.length
        ? "Data would go somewhere your organisation doesn't allow. Fix it in the checklist first."
        : keysMissing.length && !(fast && toFix)
        ? `Set ${plural(keysMissing.length, "key")} for Live first, in Keys and passwords.`
        : external.length
        ? `${external.map((x) => providerName(x.provider)).join(", ")} ${external.length === 1 ? "is" : "are"} called with a key. An Owner or Admin allows ${external.length === 1 ? "it" : "them"} first.`
        : fast && toFix
        ? `Fix ${plural(toFix, "thing")} in the checklist first.`
        : !fast && !teamCurrent
          ? "Share this version with your team first. Live always follows the team version."
          : blocker
            ? `${blocker}. An Owner or Admin approves it in Approvals.`
            : liveCurrent
              ? `v${currentVersion} is already live.`
              : input.liveRequested && !admin
                ? "Your request is waiting for an Owner or Admin."
                : input.repo && !input.repo.merged
                  ? input.repo.prNumber
                    ? `Merge PR #${input.repo.prNumber} into main first. Live deploys from main.`
                    : "Build first. Live deploys from main after the build's pull request merges."
                  : undefined),
  };

  const newest = [...input.deployments].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const failure = newest?.status === "failed" ? { environment: newest.environment, version: newest.version, step: newest.failure?.step ?? "Deploy", reason: newest.failure?.reason ?? "It didn't finish." } : null;

  const progress = liveCurrent
    ? "Live"
    : failure
      ? "deploy failed"
      : (fast || teamCurrent ? toFix : toFixTeam)
        ? `${plural(fast || teamCurrent ? toFix : toFixTeam, "thing")} before ${fast || teamCurrent ? "going live" : "sharing"}`
        : !fast && !teamCurrent
          ? "ready to share"
          : behind
            ? `live is ${plural(behind, "version")} behind`
            : fast || teamCurrent
            ? blocker
              ? "waiting for IT"
              : "ready to go live"
            : "ready to share";

  return {
    fast,
    rows,
    toFix,
    team: { version: team, current: teamCurrent },
    live: { version: live, current: liveCurrent, blocker, requested: input.liveRequested, behind, decision },
    failure,
    progress,
    share,
    goLive,
    repo: input.repo ?? null,
  };
}
