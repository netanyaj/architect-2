import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

/* M5.5 polish: two workspaces per person, and the rest of the polish list. */

test.describe("M5.5", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);
  let user: TestUser;

  test.beforeAll(async () => {
    user = await createTestUser("polish");
  });
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });
  async function start(page: Page) {
    await signIn(page, user);
  }

  test("two workspaces: the demo first, and an empty Personal with governance off and its starting points", async ({ page }) => {
    await start(page);
    const nav = page.getByRole("navigation", { name: "Workspace" });
    await expect(nav.getByText("Acme Ops (Enterprise)", { exact: true })).toBeVisible();
    await nav.getByRole("button", { name: /Switch workspace/ }).click();
    await page.getByRole("menuitem").filter({ hasText: "Personal" }).click();
    await page.waitForURL(/\/home$/);
    await expect(nav.getByText("Personal", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Personal workspace · governance off · go live in one step" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Help me decide" }).last()).toBeVisible();
    await page.goto("/settings");
    await expect(page.getByRole("button", { name: "Reset demo data" })).toHaveCount(0);
    await page.goto("/home");
    await page.getByRole("button", { name: "See a team workspace → Acme Ops (Enterprise)" }).click();
    await expect(nav.getByText("Acme Ops (Enterprise)", { exact: true })).toBeVisible();
    const { data } = await adminDb().from("members").select("workspaces!inner(name, kind, governance_enabled, plan)").eq("user_id", user.id);
    expect(data!.map((m) => m.workspaces).sort((a, b) => a.kind.localeCompare(b.kind))).toEqual([
      { name: "Acme Ops (Enterprise)", kind: "demo", governance_enabled: true, plan: "enterprise" },
      { name: "Personal", kind: "personal", governance_enabled: false, plan: "free" },
    ]);
  });
});
