import { expect, test } from "@playwright/test";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

test.describe("sign-in", () => {
  let user: TestUser;

  test.beforeAll(async () => {
    user = await createTestUser("signin");
  });
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });

  test("signed-out visitors are sent to login, keeping the page they wanted", async ({ page }) => {
    await page.goto("/projects?filter=live");
    await expect(page).toHaveURL(/\/login\?next=%2Fprojects%3Ffilter%3Dlive$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
  });

  test("a wrong password says what to do", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveText("That email and password don't match. Try again, or create an account.");
  });

  test("the prompt typed on Home survives sign-in, and first sign-in seeds a private Acme Ops", async ({ page }) => {
    const prompt = "Every Friday, email me a summary of this week's closed support tickets.";
    await page.goto("/home", { waitUntil: "networkidle" }); // the dev server compiles on first visit
    await page.getByLabel("Describe your app").fill(prompt);
    await page.getByRole("button", { name: "Write the plan" }).click();
    await expect(page).toHaveURL(/\/login\?next=%2Fhome/);
    await expect(page.getByText("Your idea is kept.")).toBeVisible();

    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByLabel("Describe your app")).toHaveValue(prompt);
    await expect(page.getByText(/Good (morning|afternoon|evening), Signin/)).toBeVisible();

    // The side nav reads the seeded workspace from the database.
    const nav = page.getByRole("navigation", { name: "Workspace" });
    await expect(nav.getByRole("link", { name: /Projects\s*5/ })).toBeVisible();
    await expect(nav.getByRole("link", { name: /Approvals\s*3/ })).toBeVisible();

    const db = adminDb();
    // Two workspaces, both theirs: the seeded demo they land on, and an empty Personal (0021).
    const { data: all } = await db.from("members").select("role, workspace_id, workspaces!inner(kind)").eq("user_id", user.id);
    expect(all!.map((m) => [m.role, m.workspaces.kind]).sort()).toEqual([["owner", "demo"], ["owner", "personal"]]);
    const members = all!.filter((m) => m.workspaces.kind === "demo");

    // Credits left = allowance minus this period's usage (the period ends on the reset date).
    const ws = members![0].workspace_id;
    const { data: w } = await db.from("workspaces").select("credits_total, credits_reset_on").eq("id", ws).single();
    const reset = new Date(`${w!.credits_reset_on}T00:00:00Z`);
    const start = new Date(Date.UTC(reset.getUTCFullYear(), reset.getUTCMonth() - 1, reset.getUTCDate())).toISOString();
    const { data: usage } = await db.from("usage_ledger").select("credits").eq("workspace_id", ws).gte("created_at", start);
    const left = Number(w!.credits_total) - (usage ?? []).reduce((s, r) => s + Number(r.credits), 0);
    await expect(nav.getByText(`${left.toLocaleString("en-US")} / 2,000`)).toBeVisible();
    const { count } = await db.from("projects").select("id", { count: "exact", head: true }).eq("workspace_id", members![0].workspace_id);
    // The four seeded projects and the Architect 1.0 app (F9, migration 0018).
    expect(count).toBe(5);
  });

  test("signing in again reuses the same workspace, and sign out ends the session", async ({ page }) => {
    await page.goto("/login?next=%2Fsettings");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByText("Acme Ops (Enterprise) · you're an Owner.", { exact: false })).toBeVisible();

    // Two workspaces: the seeded demo and an empty Personal (0021).
    const { count } = await adminDb().from("members").select("id", { count: "exact", head: true }).eq("user_id", user.id);
    expect(count).toBe(2);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/);
  });

  test("GitHub hands off to github.com", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Continue with GitHub" }).click();
    await page.waitForURL(/github\.com/);
    expect(new URL(page.url()).host).toBe("github.com");
  });
});
