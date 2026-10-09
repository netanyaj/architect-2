import "server-only";

import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { filesToRead, READ_CAPS, type RepoEntry } from "@/lib/repo-analysis";
import { serverEnv } from "./env";

/**
 * The GitHub App (B-1), read-only: contents and metadata on the repos the person chose. Short-lived installation
 * tokens are minted per call by @octokit/auth-app and never leave the server. The `repo` OAuth scope is never
 * requested: the person's own GitHub sign-in for the App is used only to confirm which installations they can use.
 */

/** The one-time state for the person's GitHub sign-in, with the workspace it was started from. */
export const GITHUB_STATE_COOKIE = "ax_gh_state";

export type GitHubProblemKind = "not_set_up" | "not_installed" | "access_lost" | "empty" | "rate_limited" | "unavailable";

/** A GitHub failure in plain words: what happened and what to do. */
export class GitHubProblem extends Error {
  constructor(
    public kind: GitHubProblemKind,
    message: string,
  ) {
    super(message);
    this.name = "GitHubProblem";
  }
}

function app() {
  const cfg = serverEnv.githubApp();
  if (!cfg) throw new GitHubProblem("not_set_up", "The GitHub App isn't set up on this server. Add its settings to the environment.");
  return cfg;
}

export function installUrl(): string {
  return `https://github.com/apps/${app().slug}/installations/new`;
}

/** Where to change which repos the App can read. */
export function manageUrl(install: { installationId: number; accountLogin: string; accountType: string }): string {
  return install.accountType === "Organization"
    ? `https://github.com/organizations/${install.accountLogin}/settings/installations/${install.installationId}`
    : `https://github.com/settings/installations/${install.installationId}`;
}

function installationClient(installationId: number): Octokit {
  const cfg = app();
  return new Octokit({ authStrategy: createAppAuth, auth: { appId: cfg.appId, privateKey: cfg.privateKey, installationId }, request: { timeout: 20_000 } });
}

type HttpError = { status?: number; message?: string; response?: { headers?: Record<string, string | number | undefined> } };

/** Turns an Octokit error into a GitHubProblem. `repo` names the repo in the message when there is one. */
export function toProblem(err: unknown, repo?: string): GitHubProblem {
  if (err instanceof GitHubProblem) return err;
  const e = (err ?? {}) as HttpError;
  const headers = e.response?.headers ?? {};
  const remaining = headers["x-ratelimit-remaining"];
  const reset = Number(headers["x-ratelimit-reset"] ?? 0);
  const message = String(e.message ?? "");
  if (e.status === 429 || (e.status === 403 && (String(remaining) === "0" || /rate limit/i.test(message)))) {
    const at = reset ? new Date(reset * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC" : "in an hour";
    return new GitHubProblem("rate_limited", `GitHub's limit for reading repos is used up for now. Nothing was lost. Try again after ${at}.`);
  }
  if (e.status === 409 || /repository is empty/i.test(message)) {
    return new GitHubProblem("empty", `${repo ?? "This repo"} is empty, so there's nothing to import yet. Push some code to it, then try again.`);
  }
  if (e.status === 404 || e.status === 403 || e.status === 401) {
    return repo
      ? new GitHubProblem("access_lost", `Architect can't read ${repo} any more: it was taken off the GitHub App, renamed or deleted. Add it back with Manage access, then choose it again.`)
      : new GitHubProblem("not_installed", "The GitHub App isn't installed on this account any more. Install it on the repos you want to import.");
  }
  return new GitHubProblem("unavailable", "GitHub didn't answer. Nothing was lost. Try again in a minute.");
}

export type RepoSummary = { fullName: string; private: boolean; defaultBranch: string; language: string | null; pushedAt: string | null };

export async function listRepos(installationId: number): Promise<RepoSummary[]> {
  try {
    const octo = installationClient(installationId);
    const repos = await octo.paginate(octo.apps.listReposAccessibleToInstallation, { per_page: 100 });
    return repos
      .map((r) => ({ fullName: r.full_name, private: r.private, defaultBranch: r.default_branch, language: r.language ?? null, pushedAt: r.pushed_at ?? null }))
      .sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? ""));
  } catch (err) {
    throw toProblem(err);
  }
}

function split(fullName: string) {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) throw new GitHubProblem("access_lost", "That isn't a repo name. Choose a repo from the list.");
  return { owner, repo };
}

export async function listBranches(installationId: number, fullName: string): Promise<string[]> {
  try {
    const octo = installationClient(installationId);
    const branches = await octo.paginate(octo.repos.listBranches, { ...split(fullName), per_page: 100 });
    return branches.map((b) => b.name).slice(0, 200);
  } catch (err) {
    throw toProblem(err, fullName);
  }
}

/** The repo's files at a branch (paths and sizes), and its folders for the subfolder picker. */
export async function readTree(installationId: number, fullName: string, branch: string): Promise<{ sha: string; entries: RepoEntry[]; folders: string[]; truncated: boolean }> {
  const octo = installationClient(installationId);
  try {
    const { data: ref } = await octo.repos.getBranch({ ...split(fullName), branch });
    const sha = ref.commit.sha;
    const { data: tree } = await octo.git.getTree({ ...split(fullName), tree_sha: sha, recursive: "true" });
    const blobs = tree.tree.filter((t) => t.type === "blob" && t.path).map((t) => ({ path: t.path!, size: t.size ?? 0 }));
    if (!blobs.length) throw new GitHubProblem("empty", `${fullName} has no files on ${branch}, so there's nothing to import yet. Push some code, then try again.`);
    const folders = tree.tree.filter((t) => t.type === "tree" && t.path && !/(^|\/)(node_modules|\.git)(\/|$)/.test(t.path)).map((t) => t.path!);
    return { sha, entries: blobs.slice(0, READ_CAPS.maxTreeEntries), folders: folders.slice(0, 500), truncated: Boolean(tree.truncated) || blobs.length > READ_CAPS.maxTreeEntries };
  } catch (err) {
    throw toProblem(err, fullName);
  }
}

/** Reads the files analysis needs (filesToRead's caps), from one subfolder or the whole repo. Paths come back relative to the folder. */
export async function readRepoFiles(
  installationId: number,
  fullName: string,
  sha: string,
  entries: RepoEntry[],
  folder: string,
): Promise<{ paths: string[]; files: Record<string, string>; skippedLarge: number }> {
  const prefix = folder === "/" ? "" : `${folder.replace(/^\/|\/$/g, "")}/`;
  const scoped = entries.filter((e) => e.path.startsWith(prefix)).map((e) => ({ path: e.path.slice(prefix.length), size: e.size }));
  if (!scoped.length) throw new GitHubProblem("empty", `${folder} has no files in ${fullName}. Choose another folder or the whole repo.`);
  const { read, skippedLarge } = filesToRead(scoped);
  const octo = installationClient(installationId);
  const files: Record<string, string> = {};
  try {
    await Promise.all(
      read.map(async (path) => {
        const { data } = await octo.repos.getContent({ ...split(fullName), path: prefix + path, ref: sha });
        if (!Array.isArray(data) && data.type === "file" && "content" in data && data.encoding === "base64") {
          files[path] = Buffer.from(data.content, "base64").toString("utf8");
        }
      }),
    );
  } catch (err) {
    throw toProblem(err, fullName);
  }
  return { paths: scoped.map((e) => e.path), files, skippedLarge };
}

/** The person's own GitHub sign-in for the App: swap the one-time code for a user token (kept only for this request). */
export async function userTokenFromCode(code: string, redirectUri: string): Promise<string> {
  const cfg = app();
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: redirectUri }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!res.ok || !data.access_token) throw new GitHubProblem("not_installed", "GitHub didn't confirm your access. Start again from Import a repo.");
  return data.access_token;
}

export type UserInstallation = { installationId: number; accountLogin: string; accountType: string; repositorySelection: string };

/** The App's installations this GitHub user can use (GET /user/installations), so nobody can claim someone else's. */
export async function installationsForUser(userToken: string): Promise<UserInstallation[]> {
  const cfg = app();
  try {
    const octo = new Octokit({ auth: userToken, request: { timeout: 15_000 } });
    const list = await octo.paginate(octo.apps.listInstallationsForAuthenticatedUser, { per_page: 100 });
    return list
      .filter((i) => String(i.app_id) === String(cfg.appId))
      .map((i) => ({
        installationId: i.id,
        accountLogin: (i.account && "login" in i.account ? i.account.login : null) ?? "GitHub",
        accountType: (i.account && "type" in i.account ? i.account.type : null) ?? "User",
        repositorySelection: i.repository_selection,
      }));
  } catch (err) {
    throw toProblem(err);
  }
}

/** Starts the person's GitHub sign-in for the App. No scope is asked for: a GitHub App's user token has only the App's read-only rights. */
export function authorizeUrl(state: string, redirectUri: string): string {
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", app().clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}
