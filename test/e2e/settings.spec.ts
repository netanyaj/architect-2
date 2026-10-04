import { expect, test, type Page } from "@playwright/test";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

async function signIn(page: Page, user: TestUser, next = "/home") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.waitForLoadState("networkidle");
}

test.describe("reset demo data", () => {
  let owner: TestUser;
  test.beforeAll(async () => {
    owner = await createTestUser("reset");
  });
  test.afterAll(async () => {
    if (owner) await deleteTestUser(owner);
  });

  test("the Owner resets demo data after confirming, and the seeded projects come back", async ({ page }) => {
    await signIn(page, owner, "/settings");
    const db = adminDb();
    const { data: m } = await db.from("members").select("workspace_id").eq("user_id", owner.id).single();
    const ws = m!.workspace_id;
    // Change the demo: delete a project and add one.
    await db.from("projects").delete().eq("workspace_id", ws).eq("name", "Vendor tracker");
    await db.from("projects").insert({ workspace_id: ws, name: "My experiment", owner_id: owner.id });

    await page.getByRole("button", { name: "Reset demo data" }).click();
    const dialog = page.getByRole("dialog", { name: "Reset demo data?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Reset demo data" }).click();
    await expect(page.getByText("Demo data is back to how it started.")).toBeVisible();

    const { data: projects } = await db.from("projects").select("name").eq("workspace_id", ws);
    expect(projects!.map((p) => p.name).sort()).toEqual(["Lead scorer", "Meeting Prep", "Vendor tracker", "ticket-triage"].sort());
    const { count } = await db.from("audit_log").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("action", "workspace.reset");
    expect(count).toBe(1);
  });

  test("if the session ended in another tab, Reset sends you to sign in instead of crashing", async ({ page, context }) => {
    await signIn(page, owner, "/settings");
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await context.clearCookies(); // as if they signed out in another tab
    await page.getByRole("button", { name: "Reset demo data" }).click();
    await page.getByRole("dialog", { name: "Reset demo data?" }).getByRole("button", { name: "Reset demo data" }).click();

    await page.waitForURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(errors.filter((e) => e.includes("unexpected response"))).toEqual([]);
  });
});
