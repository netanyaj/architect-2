import { beforeEach, describe, expect, it, vi } from "vitest";
import { isPublicPath, loginUrl, safeNext } from "@/lib/auth-paths";

/* ---------- mocks: Next's redirect/headers and our Supabase clients ---------- */

class Redirect extends Error {
  constructor(public url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Redirect(url); } }));
vi.mock("next/headers", () => ({ // used by src/server/origin.ts
  headers: async () => new Map([["host", "localhost:3000"]]),
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }),
}));

const auth = {
  signInWithOAuth: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  exchangeCodeForSession: vi.fn(),
};
const rpc = vi.fn();
vi.mock("@/server/db", () => ({
  createServerDb: async () => ({ auth }),
  createAdminDb: () => ({ rpc }),
}));

const { signInWithEmail, signInWithProvider, signOut, friendlyAuthError } = await import("@/server/actions/auth");
const { GET: callback } = await import("@/app/auth/callback/route");
const { displayNameFor, ensureWorkspace, pickWorkspace } = await import("@/server/workspace");

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof Redirect) return e.url;
    throw e;
  }
  throw new Error("expected a redirect");
}

const user = { id: "u1", email: "morgan.lee@acme.example", user_metadata: { full_name: "Morgan Lee" } };

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: "ws1", error: null });
});

/* ---------- paths ---------- */

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/projects?filter=live")).toBe("/projects?filter=live");
  });
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", null, undefined])(
    "falls back to Home for %s",
    (bad) => {
      expect(safeNext(bad as string)).toBe("/home");
    },
  );
  it("never loops back to login or the callback", () => {
    expect(safeNext("/login?next=/x")).toBe("/home");
    expect(safeNext("/auth/callback")).toBe("/home");
  });
});

describe("isPublicPath / loginUrl", () => {
  it("lets signed-out visitors open login, auth, Home and invites only", () => {
    for (const p of ["/login", "/auth/callback", "/home", "/invite/abc", "/"]) expect(isPublicPath(p)).toBe(true);
    for (const p of ["/projects", "/settings", "/p/123", "/usage", "/connections"]) expect(isPublicPath(p)).toBe(false);
  });
  it("carries the page they wanted", () => {
    expect(loginUrl("/p/123?view=files")).toBe("/login?next=%2Fp%2F123%3Fview%3Dfiles");
    expect(loginUrl("https://evil.example")).toBe("/login");
  });
});

/* ---------- workspace helpers ---------- */

describe("displayNameFor", () => {
  it("prefers the provider's name, then the email", () => {
    expect(displayNameFor(user)).toBe("Morgan Lee");
    expect(displayNameFor({ email: "sam@acme.example", user_metadata: {} })).toBe("Sam");
    expect(displayNameFor({ email: undefined, user_metadata: { user_name: "octocat" } })).toBe("octocat");
  });
});

describe("ensureWorkspace", () => {
  it("creates (or returns) the person's own Acme Ops", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(ensureWorkspace({ rpc } as any, user)).resolves.toBe("ws1");
    expect(rpc).toHaveBeenCalledWith("create_demo_workspace", { p_user: "u1", p_email: user.email, p_name: "Morgan Lee" });
  });
  it("says so when it can't", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(ensureWorkspace({ rpc } as any, user)).rejects.toThrow("Couldn't set up your workspace: boom");
  });
});

describe("pickWorkspace", () => {
  const ms = [
    { workspaceId: "invited", workspaceName: "Acme Ops", role: "viewer" as const, label: "Morgan's Acme Ops" },
    { workspaceId: "own", workspaceName: "Acme Ops", role: "owner" as const, label: "Your Acme Ops" },
  ];
  it("uses the chosen workspace while they still belong to it", () => {
    expect(pickWorkspace(ms, "invited")?.workspaceId).toBe("invited");
  });
  it("otherwise defaults to the one they own", () => {
    expect(pickWorkspace(ms, undefined)?.workspaceId).toBe("own");
    expect(pickWorkspace(ms, "gone")?.workspaceId).toBe("own");
  });
});

/* ---------- server actions ---------- */

describe("signInWithEmail", () => {
  it("checks the email and password before calling Supabase", async () => {
    expect(await signInWithEmail({ status: "idle" }, form({ email: "nope", password: "longenough", mode: "sign_in" }))).toEqual({
      status: "error",
      message: "Enter an email address like you@company.com.",
      field: "email",
    });
    expect(await signInWithEmail({ status: "idle" }, form({ email: "a@b.co", password: "short", mode: "sign_in" }))).toMatchObject({
      field: "password",
    });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("signs in, sets up the workspace and goes where they were headed", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user }, error: null });
    const url = await redirectOf(
      signInWithEmail({ status: "idle" }, form({ email: user.email, password: "password123", mode: "sign_in", next: "/projects" })),
    );
    expect(url).toBe("/projects");
    expect(rpc).toHaveBeenCalledWith("create_demo_workspace", expect.objectContaining({ p_user: "u1" }));
  });

  it("refuses an off-site next", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user }, error: null });
    const url = await redirectOf(
      signInWithEmail({ status: "idle" }, form({ email: user.email, password: "password123", mode: "sign_in", next: "https://evil.example" })),
    );
    expect(url).toBe("/home");
  });

  it("explains a wrong password in plain words", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: "Invalid login credentials" } });
    expect(await signInWithEmail({ status: "idle" }, form({ email: user.email, password: "password123", mode: "sign_in" }))).toEqual({
      status: "error",
      message: "That email and password don't match. Try again, or create an account.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("asks them to check their email when confirmation is on", async () => {
    auth.signUp.mockResolvedValue({ data: { user, session: null }, error: null });
    expect(await signInWithEmail({ status: "idle" }, form({ email: user.email, password: "password123", mode: "sign_up" }))).toEqual({
      status: "check_email",
      email: user.email,
    });
    expect(auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: { emailRedirectTo: "http://localhost:3000/auth/callback?next=%2Fhome" },
      }),
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("goes straight in when confirmation is off", async () => {
    auth.signUp.mockResolvedValue({ data: { user, session: {} }, error: null });
    expect(await redirectOf(signInWithEmail({ status: "idle" }, form({ email: user.email, password: "password123", mode: "sign_up" })))).toBe(
      "/home",
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("signInWithProvider", () => {
  it("sends the browser to the provider with a callback that keeps next", async () => {
    auth.signInWithOAuth.mockResolvedValue({ data: { url: "https://accounts.google.com/o/oauth2" }, error: null });
    expect(await redirectOf(signInWithProvider("google", "/projects"))).toBe("https://accounts.google.com/o/oauth2");
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "http://localhost:3000/auth/callback?next=%2Fprojects", queryParams: { prompt: "select_account" } },
    });
  });
  it("comes back to login with a reason when the provider is off", async () => {
    auth.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: { message: "Unsupported provider: provider is not enabled" } });
    const url = await redirectOf(signInWithProvider("github", "/home"));
    expect(url).toContain("/login?error=");
    expect(decodeURIComponent(url)).toContain("That sign-in option isn't turned on yet.");
  });
  it("rejects anything but Google and GitHub", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await redirectOf(signInWithProvider("facebook" as any, "/home"))).toContain("/login?error=");
    expect(auth.signInWithOAuth).not.toHaveBeenCalled();
  });
});

describe("signOut", () => {
  it("ends the session and returns to login", async () => {
    auth.signOut.mockResolvedValue({ error: null });
    expect(await redirectOf(signOut())).toBe("/login");
    expect(auth.signOut).toHaveBeenCalled();
  });
});

describe("friendlyAuthError", () => {
  it("never shows Supabase's raw text", async () => {
    expect(await friendlyAuthError("Some internal thing: 500")).toBe("Sign-in didn't work. Try again, or use another sign-in option.");
    expect(await friendlyAuthError("User already registered")).toBe("There's already an account with that email. Sign in instead.");
  });
  it("says plainly when the confirmation email can't be sent", async () => {
    expect(await friendlyAuthError("email rate limit exceeded", "over_email_send_rate_limit")).toContain(
      "We couldn't send the confirmation email",
    );
    expect(await friendlyAuthError("Email address not authorized")).toBe(
      "This prototype can't send email to that address yet. Continue with GitHub instead.",
    );
    expect(await friendlyAuthError("Request rate limit reached", "over_request_rate_limit")).toBe(
      "Too many tries in a row. Wait a minute, then try again.",
    );
  });
});

/* ---------- OAuth / email-link callback ---------- */

describe("GET /auth/callback", () => {
  const req = (qs: string) => ({ nextUrl: new URL(`http://localhost:3000/auth/callback?${qs}`) }) as never;

  it("swaps the code for a session, sets up the workspace and goes to next", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: { user }, error: null });
    const res = await callback(req("code=abc&next=%2Fprojects"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/projects");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("sends an expired link back to login with a reason", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: { message: "invalid" } });
    const loc = (await callback(req("code=old"))).headers.get("location")!;
    expect(decodeURIComponent(loc)).toContain("That sign-in link has expired or was already used.");
  });
  it("handles a cancelled provider screen", async () => {
    const loc = (await callback(req("error=access_denied"))).headers.get("location")!;
    expect(decodeURIComponent(loc)).toContain("Sign-in was cancelled");
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
  it("never redirects off-site", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: { user }, error: null });
    const res = await callback(req("code=abc&next=%2F%2Fevil.example"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/home");
  });
});
