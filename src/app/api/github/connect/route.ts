import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { canBuild } from "@/lib/permissions";
import { authorizeUrl, GITHUB_STATE_COOKIE, GitHubProblem } from "@/server/github";
import { getAppContext } from "@/server/workspace";

/**
 * GET /api/github/connect: starts the person's GitHub sign-in for the App, to confirm which installations they can
 * use (after installing it, or to add one that's already installed). A one-time state ties the answer to this
 * browser and workspace. No OAuth scope is requested.
 */
export async function GET(request: NextRequest) {
  const { origin } = request.nextUrl;
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return NextResponse.redirect(new URL(`/import?github_error=${encodeURIComponent("Viewers can't connect GitHub. Ask an Owner, Admin or Builder.")}`, origin));
  const state = randomBytes(18).toString("base64url");
  let url: string;
  try {
    url = authorizeUrl(state, `${origin}/api/github/callback`);
  } catch (err) {
    const message = err instanceof GitHubProblem ? err.message : "GitHub couldn't be reached. Try again.";
    return NextResponse.redirect(new URL(`/import?github_error=${encodeURIComponent(message)}`, origin));
  }
  const res = NextResponse.redirect(url);
  res.cookies.set(GITHUB_STATE_COOKIE, `${state}.${ctx.workspace.id}`, { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https"), path: "/api/github", maxAge: 600 });
  return res;
}
