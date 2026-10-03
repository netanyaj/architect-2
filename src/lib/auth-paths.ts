/** Where people land, and which pages work signed out. Shared by the proxy, the login page and the callback. */

export const HOME = "/home";

/** Signed-out visitors may open these. Home works signed out so a typed prompt survives sign-in. */
const PUBLIC_PREFIXES = ["/login", "/auth/", "/home", "/invite/", "/kit"];

export function isPublicPath(pathname: string): boolean {
  return pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p));
}

/**
 * Only same-site paths are allowed after sign-in, so a crafted link can't send someone elsewhere.
 * "/projects?x=1" is fine; "https://evil.example", "//evil.example" and "/\\evil" are not.
 */
export function safeNext(next: string | null | undefined, fallback = HOME): string {
  if (!next || typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (next.startsWith("/login") || next.startsWith("/auth/")) return fallback;
  return next;
}

export function loginUrl(next?: string): string {
  const target = safeNext(next, "");
  return target ? `/login?next=${encodeURIComponent(target)}` : "/login";
}

/** Session storage key for the prompt typed on Home before signing in. */
export const PENDING_PROMPT_KEY = "ax.pendingPrompt";
