import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { canBuild } from "@/lib/permissions";
import { createAdminDb } from "@/server/db";
import { GITHUB_STATE_COOKIE, GitHubProblem, installationsForUser, userTokenFromCode } from "@/server/github";
import { getAppContext } from "@/server/workspace";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * GET /api/github/callback: GitHub returns here after the person's sign-in for the App. Their installations of the
 * App (as GitHub reports them for this user) are stored for the workspace; the user token is used once and dropped.
 * Arriving straight from an install without our state starts the sign-in again, so an id in a link is never trusted.
 */
export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/import?${q}`, origin));
    res.cookies.delete({ name: GITHUB_STATE_COOKIE, path: "/api/github" });
    return res;
  };
  const fail = (message: string) => back(`github_error=${encodeURIComponent(message)}`);

  if (searchParams.get("error")) return fail("GitHub sign-in was cancelled. Nothing changed.");
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const saved = request.cookies.get(GITHUB_STATE_COOKIE)?.value ?? "";
  const [savedState, savedWorkspace] = saved.split(".");
  if (!code || !state || !savedState || !same(state, savedState)) {
    // Straight from GitHub's install page (or an old link): confirm access through our own sign-in first.
    return NextResponse.redirect(new URL("/api/github/connect", origin));
  }

  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return fail("Viewers can't connect GitHub. Ask an Owner, Admin or Builder.");
  if (savedWorkspace !== ctx.workspace.id) return fail("You switched workspace while connecting GitHub. Start again from here.");

  let installs;
  try {
    const token = await userTokenFromCode(code, `${origin}/api/github/callback`);
    installs = await installationsForUser(token);
  } catch (err) {
    return fail(err instanceof GitHubProblem ? err.message : "GitHub didn't answer. Try again in a minute.");
  }
  if (!installs.length) return back("github_none=1");

  const admin = createAdminDb();
  for (const i of installs) {
    await admin.from("github_installations").upsert(
      {
        workspace_id: ctx.workspace.id,
        installation_id: i.installationId,
        account_login: i.accountLogin,
        account_type: i.accountType,
        repository_selection: i.repositorySelection,
        added_by: ctx.user.id,
      },
      { onConflict: "workspace_id,installation_id" },
    );
  }
  await admin.from("audit_log").insert({ workspace_id: ctx.workspace.id, actor: ctx.name, action: "github.connected", target: installs.map((i) => i.accountLogin).join(", "), details: { installations: installs.map((i) => i.installationId) } });
  return back(`github_connected=${installs.length}`);
}
