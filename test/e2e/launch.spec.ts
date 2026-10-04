import { expect, test, type Page } from "@playwright/test";
import { seedPlan, signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

/* F2 to a live address, then F7: a change after launch is built and shared as v2 (M3 acceptance). */

const stepper = (page: Page) => page.getByRole("navigation", { name: "Project stage" });

async function buildAndFinish(page: Page, id: string) {
  await page.goto(`/p/${id}?sim=fast`);
  await page.getByRole("button", { name: /^Build · ~\d+ credits$/ }).click();
  await expect(page.getByRole("link", { name: "Launch", exact: true })).toBeVisible({ timeout: 90_000 });
}

test.describe("M3: Launch", () => {
  test.setTimeout(240_000);
  let user: TestUser;

  test.beforeAll(async () => {
    user = await createTestUser("launcher");
  });
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });

  test("F2 and F7: the checklist holds sharing, then Team, Live, a change as v2, and go back (screen 4)", async ({ page }) => {
    await signIn(page, user);
    const id = await seedPlan(user, "Meeting Prep L");
    await buildAndFinish(page, id);

    // Launch: Gmail still uses sample data, so the team version waits for it; the fix is the primary.
    await page.getByRole("link", { name: "Launch", exact: true }).click();
    await page.waitForURL(new RegExp(`/p/${id}/launch$`));
    await expect(page.getByRole("heading", { name: /^Launch Meeting Prep L/ })).toBeVisible();
    await expect(stepper(page)).toContainText("1 thing before sharing");
    const share = page.getByRole("button", { name: "Share with your team" });
    await expect(share).toHaveAttribute("aria-disabled", "true");
    await expect(share).toHaveAttribute("title", "Fix 1 thing in the checklist first.");
    await page.getByRole("button", { name: "Connect Gmail" }).click();
    await expect(stepper(page)).toContainText("ready to share");

    await share.click();
    await expect(page.getByText("v1 shared", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Go live", exact: true }).click();
    await expect(page.getByText("v1 is live", { exact: true })).toBeVisible();
    await expect(stepper(page)).toContainText("Live");
    const db = adminDb();
    expect((await db.from("projects").select("status").eq("id", id).single()).data!.status).toBe("live");

    // F7: a change after launch. The change card is seeded (no model needed); Apply builds it as v2.
    const { data: msg } = await db.from("messages").insert({ project_id: id, role: "architect", mode: "build", content: "I'll add a Friday recap." }).select("id").single();
    await db.from("change_proposals").insert({
      project_id: id,
      message_id: msg!.id,
      reply: "I'll add a Friday recap.",
      estimate_likely: 9,
      est_minutes: 1,
      status: "proposed",
      diff: {
        add: [{ key: "friday-recap", grp: "features", title: "Friday recap of the week's meetings", description: "A short recap every Friday.", proved_when: "Done when a recap arrives every Friday at 16:00", source_quote: "", item_class: "screen.list", size: "s" }],
        change: [],
        remove: [],
        base_version: 1,
      },
    });
    await page.goto(`/p/${id}?sim=fast`);
    const chat = page.getByRole("complementary", { name: "Chat" });
    await chat.getByRole("button", { name: "Apply" }).click();
    await expect(chat.getByText("Applied as plan v2. Building the change now.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Launch" })).toBeVisible({ timeout: 90_000 });
    const { data: runs } = await db.from("runs").select("kind, status").eq("project_id", id).order("started_at");
    expect(runs).toEqual([
      { kind: "build", status: "done" },
      { kind: "change", status: "done" },
    ]);

    await page.getByRole("link", { name: "Open Launch" }).click();
    await page.getByRole("button", { name: "Share v2 with your team" }).click();
    await page.getByRole("button", { name: "Update Live to v2" }).click();
    await expect(page.getByText("v2 is live", { exact: true })).toBeVisible();

    // Go back (BL-13): the live v1 returns in one click.
    const history = page.locator("#history");
    await history.getByRole("listitem").filter({ hasText: "Live · v1" }).getByRole("button", { name: "Go back to this" }).click();
    await expect(history.getByRole("listitem").filter({ hasText: "Live · v1 · running now" })).toBeVisible();
  });
});
