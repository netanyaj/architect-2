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

  test("A-7: edit a built part's check; the cost shows first, then the checker runs the new check", async ({ page }) => {
    await start(page);
    const db = adminDb();
    const { data: p } = await db.from("projects").select("id").eq("workspace_id", workspace).eq("name", "Meeting Prep").single();
    await page.goto(`/p/${p!.id}`);
    const openBriefWriter = async () => {
      const more = page.getByRole("button", { name: /^Show \d+ more$/ });
      if (await more.isVisible()) await more.click();
      await page.getByRole("button", { name: /^Brief writer/ }).first().click();
    };
    await openBriefWriter();
    const drawer = page.getByRole("dialog", { name: "Brief writer" });
    await expect(drawer).toContainText("Written by the verifier");
    await drawer.getByRole("button", { name: "Edit the check" }).click();
    const box = drawer.getByLabel("Done when");
    await box.fill(`${await box.inputValue()} Each brief lists the attendee's open deals.`);
    await drawer.getByRole("button", { name: "See the cost" }).click();
    await expect(drawer).toContainText(/Running the new check costs ~\d+ credits/);
    const { data: before } = await db.from("usage_ledger").select("id").eq("project_id", p!.id);
    await drawer.getByRole("button", { name: /^Re-run the check · ~\d+ credits$/ }).click();

    // Charged once, on the click; the part re-runs its check (simulated, a few seconds), then works again.
    await expect.poll(async () => (await db.from("usage_ledger").select("note").eq("project_id", p!.id)).data?.map((u) => u.note), { timeout: 30_000 }).toContain("Check re-run · Brief writer");
    const { data: after } = await db.from("usage_ledger").select("id").eq("project_id", p!.id);
    expect(after!.length).toBe(before!.length + 1);
    await expect.poll(async () => (await db.from("items").select("status, status_detail").eq("project_id", p!.id).eq("key", "brief-writer").single()).data, { timeout: 30_000 }).toEqual({ status: "built", status_detail: null });
    await page.reload();
    await openBriefWriter();
    await expect(page.getByRole("dialog", { name: "Brief writer" })).toContainText("Edited by Followup Tester", { timeout: 15_000 });
    await expect(page.getByRole("dialog", { name: "Brief writer" })).toContainText("Passed the edited check against the code already built");
  });

  test("A-10: the stepper lists what's not done with a reason, and Launch shows it before any deploy; BL-13's checks are named", async ({ page }) => {
    await start(page);
    const db = adminDb();
    const { data: lead } = await db.from("projects").select("id").eq("workspace_id", workspace).eq("name", "Lead scorer").single();
    await page.goto(`/p/${lead!.id}`);
    await page.getByRole("navigation", { name: "Project stage" }).getByRole("button", { name: "Not done · 3" }).click();
    const list = page.getByRole("list", { name: "What's not done" });
    await expect(list.getByRole("listitem")).toHaveCount(3);
    await expect(list.getByRole("listitem").first()).toContainText("Not built yet: the build paused at the budget");
    await list.getByRole("button", { name: /^Reason for each score/ }).click();
    await expect(page.getByRole("dialog", { name: "Reason for each score" })).toBeVisible();

    const { data: triage } = await db.from("projects").select("id").eq("workspace_id", workspace).eq("name", "ticket-triage").single();
    await page.goto(`/p/${triage!.id}/launch`);
    const notDone = page.getByRole("region", { name: "What's not done" });
    await expect(notDone).toContainText("1 part of this version doesn't work yet. A deploy ships what works.");
    await expect(notDone).toContainText("Production deploy");
    await expect(notDone).toContainText("Waiting for an Owner or Admin's approval");
    for (const check of ["Tests passed", "Security scan passed", "Personal data is hidden in logs"]) await expect(page.getByText(check, { exact: true })).toBeVisible();
  });
});
