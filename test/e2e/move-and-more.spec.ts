import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

/* M5 task 5: F9 (an Architect 1.0 app moved to 2.0 through Import, its repo chosen), comments on plan parts by a
   Viewer (BL-15), Help me decide (BL-2: three questions, three ideas from the gateway), and Download code. */

const INSTALLATION = Number(process.env.E2E_GITHUB_INSTALLATION ?? 167616247);
const REPO = "netanyaj/ticket-triage";

test.describe("Move to 2.0, comments, Help me decide and Download code", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(200_000);
  let user: TestUser;
  let workspace: string;

  test.beforeAll(async () => {
    user = await createTestUser("mover");
  });
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });
  async function signInAndFind(page: Page) {
    await signIn(page, user);
    const { data: m } = await adminDb().from("members").select("workspace_id").eq("user_id", user.id).eq("role", "owner").single();
    workspace = m!.workspace_id;
  }

  test("F9: the Architect 1.0 app keeps running; Move to 2.0 imports its repo as a plan, and it then points there", async ({ page }) => {
    await signInAndFind(page);
    const db = adminDb();
    await db.from("github_installations").upsert({ workspace_id: workspace, installation_id: INSTALLATION, account_login: "netanyaj", account_type: "User", added_by: user.id }, { onConflict: "workspace_id,installation_id" });

    await page.goto("/projects");
    const row = page.getByRole("list", { name: "Projects" }).getByRole("listitem").filter({ hasText: "Ticket triage (Architect 1.0)" });
    await expect(row).toContainText("Move to 2.0");
    await row.getByRole("link", { name: "Ticket triage (Architect 1.0)" }).click();
    await expect(page.getByRole("heading", { name: "Ticket triage (Architect 1.0)" })).toBeVisible();
    await expect(page.getByText("Nothing is forced. This app keeps running unchanged while you move it.")).toBeVisible();
    await page.getByRole("link", { name: "Move to 2.0" }).click();

    // Import, with the app's repo chosen for you.
    await expect(page.getByText("Moving Ticket triage (Architect 1.0) to 2.0.")).toBeVisible();
    await expect(page.getByLabel("Branch")).toHaveValue("main", { timeout: 30_000 });
    await page.getByRole("button", { name: "Understand it", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Architect can run this as it is" })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Write the plan", exact: true }).click();
    await page.waitForURL(/\/p\/[0-9a-f-]{36}$/);
    const newId = page.url().split("/p/")[1];
    await expect(page.getByRole("heading", { level: 1, name: "Ticket triage" })).toBeVisible();

    const { data: legacy } = await db.from("projects").select("id, moved_to, status").eq("workspace_id", workspace).not("legacy_repo", "is", null).single();
    expect(legacy).toMatchObject({ moved_to: newId, status: "live" });
    await page.goto(`/p/${legacy!.id}`);
    await expect(page.getByRole("link", { name: "Open Ticket triage" })).toBeVisible();
  });

  test("BL-15: a Viewer comments on a plan part; it changes nothing in the plan", async ({ page }) => {
    await signInAndFind(page);
    const db = adminDb();
    const { data: p } = await db.from("projects").select("id").eq("workspace_id", workspace).eq("name", "Vendor tracker").single();
    await db.from("members").update({ role: "viewer" }).eq("workspace_id", workspace).eq("user_id", user.id);
    try {
      await page.goto(`/p/${p!.id}`);
      const part = page.locator("li#part-vendor-list");
      await part.getByRole("button", { name: "Comment" }).click();
      await part.getByLabel("Comment on Vendor list").fill("Can we add the contract owner?");
      await part.getByRole("button", { name: "Comment", exact: true }).last().click();
      await expect(part.getByRole("region", { name: "Comments on Vendor list" })).toContainText("Can we add the contract owner?");
      await expect(part.getByRole("button", { name: "Comments (1)" })).toBeVisible();
    } finally {
      await db.from("members").update({ role: "owner" }).eq("workspace_id", workspace).eq("user_id", user.id);
    }
    const { data: comments } = await db.from("part_comments").select("item_key, body").eq("project_id", p!.id);
    expect(comments).toEqual([{ item_key: "vendor-list", body: "Can we add the contract owner?" }]);
  });

  test("Help me decide: three questions, three ideas from the model, and one becomes a project; Download code", async ({ page }) => {
    await signInAndFind(page);
    await page.goto("/home");
    await page.getByRole("button", { name: "Help me decide" }).click();
    await expect(page.getByText("Step 1 of 3")).toBeVisible();
    await page.getByLabel("Your role").fill("Sales operations lead");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByLabel("What takes up your time every week").fill("Preparing for customer meetings takes about 4 hours a week");
    await page.getByRole("button", { name: "Google Calendar" }).click();
    await page.getByRole("button", { name: "Slack", exact: true }).click();
    await page.getByRole("button", { name: "Show me three ideas" }).click();
    await expect(page.getByRole("heading", { name: "Here are three things worth building" })).toBeVisible({ timeout: 60_000 });
    const ideas = page.getByRole("radiogroup", { name: "Ideas" }).getByRole("radio");
    await expect(ideas).toHaveCount(3);
    await expect(ideas.first()).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: "Write the plan for this" }).click();
    await page.waitForURL(/\/p\/[0-9a-f-]{36}/, { timeout: 60_000 });
    await expect(page.getByRole("button", { name: /^Build · ~\d+ credits$/ })).toBeVisible({ timeout: 90_000 });

    // Download code from the project's ⋯ menu: a .zip of Architect's (simulated) code.
    await page.getByRole("button", { name: "More for this project" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: /^Download code/ }).click();
    expect((await download).suggestedFilename()).toMatch(/\.zip$/);
  });
});
