import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

/* Data (screen 13, Simulated): tables per version, Rows and Columns, a filter, Export CSV, Live read-only, and the
   app's sign-ins; the sign-in setting (BL-10) changed from Launch. */

test.describe("M4: Data and sign-in", () => {
  test.setTimeout(120_000);
  let user: TestUser;

  test.beforeAll(async () => {
    user = await createTestUser("datauser");
  });
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });

  test("switch versions, filter, export CSV, Live read-only, and change sign-in from Launch", async ({ page }) => {
    await signIn(page, user);
    const db = adminDb();
    const { data: m } = await db.from("members").select("workspace_id").eq("user_id", user.id).eq("role", "owner").single();
    const { data: p } = await db.from("projects").select("id").eq("workspace_id", m!.workspace_id).eq("name", "Meeting Prep").single();
    await page.goto(`/p/${p!.id}?view=data`);

    const version = page.getByLabel("Which version's data");
    await expect(version).toHaveValue("test");
    const tables = page.getByRole("navigation", { name: "Tables" });
    await expect(tables).toContainText("Briefs");
    await expect(tables).toContainText("Meeting notes");
    const briefs = page.getByRole("region", { name: "Briefs" });
    await expect(briefs).toContainText("1–8 of 128");
    await expect(briefs.getByRole("columnheader", { name: "Attendees" })).toBeVisible();

    // Columns, then a filter.
    await briefs.getByRole("tab", { name: "Columns" }).click();
    await expect(briefs.getByRole("columnheader", { name: "What it holds" })).toBeVisible();
    await briefs.getByRole("tab", { name: "Rows" }).click();
    await briefs.getByLabel("Filter rows").fill("Hiring sync");
    await expect(briefs).toContainText(/matching “Hiring sync”/);
    const rows = briefs.locator("tbody tr");
    const n = await rows.count();
    for (let i = 0; i < n; i++) await expect(rows.nth(i)).toContainText("Hiring sync");

    // Export CSV: the filtered rows.
    const [download] = await Promise.all([page.waitForEvent("download"), briefs.getByRole("button", { name: "Export CSV" }).click()]);
    expect(download.suggestedFilename()).toBe("meeting-prep-briefs-test.csv");
    const csv = readFileSync((await download.path())!, "utf8").trim().split("\r\n");
    expect(csv[0]).toBe("Meeting,Attendees,Status,Sent");
    expect(csv.length).toBeGreaterThan(1);
    expect(csv.slice(1).every((line) => line.startsWith("Hiring sync,"))).toBe(true);
    await briefs.getByLabel("Filter rows").fill("");

    // Test data can be changed here.
    await briefs.getByRole("button", { name: "Add a row" }).click();
    await expect(briefs).toContainText("1–8 of 129");

    // Team, then Live: Live is read-only.
    await version.selectOption("team");
    await expect(page.getByRole("region", { name: "Briefs" })).toContainText("of 45");
    await version.selectOption("live");
    const live = page.getByRole("region", { name: "Briefs" });
    await expect(live).toContainText("Live data is read-only here.");
    await expect(live.getByRole("button", { name: "Add a row" })).toHaveAttribute("aria-disabled", "true");
    await expect(live.getByRole("button", { name: "Remove this row" }).first()).toHaveAttribute("aria-disabled", "true");

    // The app's sign-ins.
    await tables.getByRole("button", { name: /People who can sign in/ }).click();
    await expect(tables).toContainText("Google sign-in");
    await expect(page.getByRole("region", { name: "People who can sign in" }).getByRole("cell", { name: "Google" }).first()).toBeVisible();

    // Sign-in from Launch: email instead of Google (SSO is offered: governance is on).
    await page.goto(`/p/${p!.id}/launch`);
    const signInGroup = page.getByRole("radiogroup", { name: "Sign-in for the people using it" });
    await expect(signInGroup.getByRole("radio", { name: /Google sign-in/ })).toHaveAttribute("aria-checked", "true");
    await expect(signInGroup.getByRole("radio", { name: /single sign-on/ })).toBeVisible();
    await expect(page.getByText("Not in this prototype yet: sign-in options are planned next.")).toHaveCount(0);
    await signInGroup.getByRole("radio", { name: /Email and password/ }).click();
    await expect(signInGroup.getByRole("radio", { name: /Email and password/ })).toHaveAttribute("aria-checked", "true");
    expect(((await db.from("projects").select("launch_settings").eq("id", p!.id).single()).data!.launch_settings as { signIn?: string }).signIn).toBe("email");
    await page.goto(`/p/${p!.id}?view=data`);
    await expect(page.getByRole("navigation", { name: "Tables" })).toContainText("Email and password");
  });
});
