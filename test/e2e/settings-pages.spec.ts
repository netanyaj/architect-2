import { expect, test } from "@playwright/test";
import { signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, demoWorkspace, type TestUser } from "./helpers";

/* M6: Settings is a page per topic with a menu (on the left, or at the top on a phone); budgets live in one place;
   Connections has three headed sections; the MCP and API-key forms clear on Cancel. */

test.describe("Settings pages and Connections sections", () => {
  test.setTimeout(120_000);
  let user: TestUser;
  test.beforeAll(async () => {
    user = await createTestUser("settings-pages");
  });
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });

  test("a page per topic, grouped; /settings is General; budgets in one place", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, user);
    const ws = await demoWorkspace(user);
    await page.goto("/settings");
    const menu = page.getByRole("navigation", { name: "Settings" });
    await expect(menu.getByRole("link", { name: "General" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "General", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Plan" })).toBeVisible();
    // The Owner of a demo workspace sees Demo data; the groups are Workspace and You.
    const labels = await menu.getByRole("link").allTextContents();
    expect(labels).toEqual(["General", "Members", "Budgets", "Governance", "GitHub", "Demo data", "Appearance", "Account"]);
    await menu.getByRole("link", { name: "Members" }).click();
    await page.waitForURL(/\/settings\/members$/);
    await expect(page.getByRole("heading", { name: "People in Acme Ops (Enterprise)" })).toBeVisible();

    // Governance on: Budgets only points to Governance › Budgets, with no fields of its own.
    await page.goto("/settings/budgets");
    await expect(page.getByText("Owners and Admins set budgets in Governance › Budgets.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Governance › Budgets" })).toHaveAttribute("href", "/governance?section=budgets");
    await expect(page.getByRole("main").getByRole("textbox")).toHaveCount(0);
    // Governance off: the per-project editor is here (and Governance › Budgets isn't reachable).
    await adminDb().from("workspaces").update({ governance_enabled: false }).eq("id", ws);
    await page.reload();
    await expect(page.getByText("Owners and Admins set budgets in Governance")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Save/ }).first()).toBeVisible();
    await adminDb().from("workspaces").update({ governance_enabled: true }).eq("id", ws);

    // On a phone, the menu is at the top.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/settings");
    await expect(menu).toBeHidden();
    await page.getByRole("button", { name: "Settings: General. Choose a page" }).click();
    await page.getByRole("menuitem", { name: "Appearance" }).click();
    await page.waitForURL(/\/settings\/appearance$/);
    await expect(page.getByRole("heading", { name: "Appearance", level: 2 })).toBeVisible();
  });

  test("Connections: Lyzr Studio, Apps, then MCP servers; the forms use the body font and clear on Cancel", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, user);
    await page.goto("/connections");
    const headings = await page.getByRole("main").getByRole("heading", { level: 2 }).allTextContents();
    expect(headings.filter((h) => ["Lyzr Studio", "Apps", "MCP servers"].includes(h))).toEqual(["Lyzr Studio", "Apps", "MCP servers"]);
    const apps = page.getByRole("region", { name: "Apps" });
    const mcp = page.getByRole("region", { name: "MCP servers" });

    // MCP: Figtree for every field and placeholder; Cancel clears the fields and the error.
    await mcp.getByRole("button", { name: "Add an MCP server" }).click();
    for (const field of ["Name", "URL", "Auth header (optional)"]) {
      const font = await mcp.getByLabel(field).evaluate((el) => getComputedStyle(el).fontFamily);
      expect(font).toMatch(/figtree/i);
      const placeholder = await mcp.getByLabel(field).evaluate((el) => getComputedStyle(el, "::placeholder").fontFamily);
      expect(placeholder).toMatch(/figtree/i);
    }
    await mcp.getByLabel("Name").fill("Local");
    await mcp.getByLabel("URL").fill("https://127.0.0.1/mcp");
    await mcp.getByLabel("Auth header (optional)").fill("Authorization: Bearer x");
    await mcp.getByRole("button", { name: "Add and test" }).click();
    await expect(mcp.getByRole("alert")).toBeVisible();
    await mcp.getByRole("button", { name: "Cancel" }).click();
    await mcp.getByRole("button", { name: "Add an MCP server" }).click();
    for (const field of ["Name", "URL", "Auth header (optional)"]) await expect(mcp.getByLabel(field)).toHaveValue("");
    await expect(mcp.getByRole("alert")).toHaveCount(0);
    await mcp.getByRole("button", { name: "Cancel" }).click();

    // API key: "Add an API key" sits in the Apps header; Cancel clears the form and its error.
    await apps.getByRole("button", { name: "Add an API key" }).click();
    await apps.getByLabel("Service").fill("Clearbit");
    await apps.getByRole("button", { name: "Save key" }).click();
    await expect(apps.getByRole("alert")).toBeVisible();
    await apps.getByRole("button", { name: "Cancel" }).click();
    await apps.getByRole("button", { name: "Add an API key" }).click();
    await expect(apps.getByLabel("Service")).toHaveValue("");
    await expect(apps.getByLabel("API key", { exact: true })).toHaveValue("");
    await expect(apps.getByRole("alert")).toHaveCount(0);
  });
});
