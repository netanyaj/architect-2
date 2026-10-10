import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

/* M5 follow-up (gap analysis, 11 Oct): API key connections, and the rest of the build list. One seeded workspace. */

test.describe("M5 follow-up", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);
  let user: TestUser;
  let workspace: string;

  test.beforeAll(async () => {
    user = await createTestUser("followup");
  });
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });
  async function start(page: Page) {
    await signIn(page, user);
    const { data: m } = await adminDb().from("members").select("workspace_id").eq("user_id", user.id).eq("role", "owner").single();
    workspace = m!.workspace_id;
  }

  test("BL-9: an API key connection is Set or Not set, by whom and when; the key is never stored", async ({ page }) => {
    await start(page);
    await page.goto("/connections");
    const clearbit = page.getByRole("listitem").filter({ hasText: "Clearbit" });
    await expect(clearbit).toContainText("API key");
    await expect(clearbit).toContainText("Set by Jordan (IT)");
    await expect(clearbit).toContainText("Used by Lead scorer");

    // A service that isn't an allowed app is refused, with who can fix it.
    await page.getByRole("button", { name: "Add an API key" }).click();
    await page.getByLabel("Service").fill("Apollo");
    await page.getByLabel("API key", { exact: true }).fill("apollo-test-key");
    await page.getByRole("button", { name: "Save key" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Apollo" })).toHaveText("Apollo isn't on your organisation's allowed apps. An Owner or Admin can add it in Governance › Apps.");
    await page.getByRole("button", { name: "Cancel" }).click();

    // Replace: set by you now. Remove: Not set.
    await clearbit.getByRole("button", { name: "Replace key" }).click();
    await clearbit.getByLabel("Clearbit API key").fill("cb-test-value-123");
    await clearbit.getByRole("button", { name: "Save key" }).click();
    await expect(clearbit).toContainText(/Set by Followup Tester · (just now|\d+ min)/);
    await clearbit.getByRole("button", { name: "Remove" }).click();
    await expect(clearbit).toContainText("Not set");
    await expect(clearbit.getByRole("button", { name: "Add the key" })).toBeVisible();

    const { data: conn } = await adminDb().from("connections").select("*").eq("workspace_id", workspace).eq("provider", "clearbit").single();
    expect(JSON.stringify(conn)).not.toContain("cb-test-value-123");
    const { data: audit } = await adminDb().from("audit_log").select("action, details").eq("workspace_id", workspace).like("action", "connection.api_key%");
    expect(audit!.map((a) => a.action).sort()).toEqual(["connection.api_key_removed", "connection.api_key_replaced"]);
    expect(JSON.stringify(audit)).not.toContain("cb-test-value-123");
  });
});
