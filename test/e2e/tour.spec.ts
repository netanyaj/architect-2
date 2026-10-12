import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, sessionUserId, type TestUser } from "./helpers";

/* Tour v3 (M6): one coach card, bottom left, that walks the five steps with a hint on each step's control, keeps the
   project's panes open, follows the build, and moves on by itself. Plus the ways to put it away and bring it back. */

const card = (page: Page) => page.getByRole("region", { name: "Tour", exact: true });
const TITLES = { plan: "Write a plan", build: "Build it", blocker: "Fix a blocker", launch: "Launch with approval", governance: "See Governance and the audit log" } as const;
type Step = keyof typeof TITLES;
const N: Record<Step, number> = { plan: 1, build: 2, blocker: 3, launch: 4, governance: 5 };

/** At every step: the card says which step, its hint is on screen beside a control that's on screen, and on a project page both panes are open. */
async function atStep(page: Page, step: Step, opts: { project?: boolean; done?: boolean } = {}) {
  await expect(card(page)).toBeVisible();
  // Opening the audit log is step 5 itself: by then the card may already say Done, then show the finish.
  if (!opts.done) await expect(card(page)).toContainText(`Step ${N[step]} of 5 · ${TITLES[step]}`, { timeout: 30_000 });
  const hint = page.getByRole("note", { name: `Tour hint: ${TITLES[step]}` });
  await expect(hint).toBeVisible({ timeout: 15_000 });
  await expect(hint).toBeInViewport();
  await expect(page.locator(`[data-tour-hint="${step}"]`).first()).toBeInViewport();
  if (opts.project) {
    await expect(page.getByRole("complementary", { name: "Parts" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Chat" })).toBeVisible();
  }
}

test.describe("Tour v3", () => {
  test.setTimeout(600_000);

  test("a fresh demo account walks all five steps: the card, a hint on a visible control, and open panes at every step", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.getByRole("button", { name: "Try the demo" }).click();
    await page.waitForURL(/\/home/, { timeout: 60_000 }).catch(() => {});
    test.skip(page.url().includes("/login"), "Anonymous sign-ins aren't turned on in Supabase yet.");
    try {
      await page.getByRole("region", { name: /^Take the tour/ }).getByRole("button", { name: "Start the tour" }).click();
      await page.waitForURL(/\/home\?tour=plan/);

      // 1 · Write a plan: the hint is on Write the plan.
      await atStep(page, "plan");
      await page.getByRole("button", { name: /^Write the plan/ }).click();
      await page.waitForURL(/\/p\//, { timeout: 60_000 });
      await expect(page.getByText(/Here's the plan: \d+ parts/)).toBeVisible({ timeout: 150_000 });
      const project = page.url().split("?")[0];

      // 2 · Build it: the card moves on by itself ("Done ✓", then the step), with the hint on Build.
      await atStep(page, "build", { project: true });
      // The fast simulation, so the test doesn't wait for a real build's pace.
      await page.goto(`${project}?view=plan&sim=fast`);
      await atStep(page, "build", { project: true });
      for (let i = 0; i < 4; i++) {
        const build = page.getByRole("button", { name: /^Build · ~\d+ credits$/ });
        if ((await build.isVisible()) && !(await build.getAttribute("aria-disabled"))) break;
        const rec = page.getByRole("button", { name: /Recommended|Use this/ }).first();
        if (await rec.isVisible().catch(() => false)) await rec.click();
        await page.waitForTimeout(1500);
      }
      await page.getByRole("button", { name: /^Build · ~\d+ credits$/ }).click();
      // Build from the Plan tab goes to the App view with Parts and Chat open; the card follows the build.
      await expect(page).not.toHaveURL(/view=plan/);
      await expect(page.getByRole("complementary", { name: "Parts" })).toBeVisible();
      await expect(page.getByRole("complementary", { name: "Chat" })).toBeVisible();
      await expect(card(page).getByText(/Building · \d+ of \d+ parts work/)).toBeVisible({ timeout: 30_000 });

      // 3 · Fix a blocker: once a part waits for an app, the hint is on its Connect button.
      await atStep(page, "blocker", { project: true });
      await page.locator('[data-tour-hint="blocker"]').first().click();
      await page.getByRole("dialog", { name: /^Connect / }).getByRole("button", { name: "Allow" }).click();

      // 4 · Launch with approval: the card's link opens the waiting Live request, with the hint on Approve.
      await expect(card(page)).toContainText("Step 4 of 5 · Launch with approval", { timeout: 30_000 });
      await card(page).getByRole("link", { name: "Open Approvals" }).click();
      await page.waitForURL(/\/governance\/approvals\?id=/);
      await atStep(page, "launch");
      await page.locator('[data-tour-hint="launch"]').click();

      // 5 · Governance and the audit log: the hint is on the audit log.
      await expect(card(page)).toContainText("Step 5 of 5", { timeout: 30_000 });
      await card(page).getByRole("link", { name: "Open the audit log" }).click();
      await page.waitForURL(/\/governance\?section=audit/);
      await atStep(page, "governance", { done: true });

      // The finish, in the card itself; closing it ends the tour.
      await expect(card(page).getByRole("heading", { name: "You've seen the whole story" })).toBeVisible({ timeout: 30_000 });
      await card(page).getByRole("button", { name: "Explore on your own" }).click();
      await expect(card(page)).toHaveCount(0);
    } finally {
      // This test's own demo user, from its session (never another test's).
      const me = await sessionUserId(page);
      if (me) await deleteTestUser({ id: me, email: "", password: "" });
    }
  });

  test.describe("putting it away and bringing it back", () => {
    let user: TestUser;
    test.beforeAll(async () => {
      user = await createTestUser("tour");
    });
    test.afterAll(async () => {
      if (user) await deleteTestUser(user);
    });

    test("× on the Home card, × on the coach card, a page change, Don't show again, and ⌘K", async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await signIn(page, user);
      const db = adminDb();
      const events = async (event: string) => (await db.from("analytics_events").select("detail").eq("user_id", user.id).eq("event", event)).data!.map((e) => e.detail);

      // A normal account: a compact card under the composer; × puts it away to the coach card, recorded.
      await page.goto("/home");
      const homeCard = page.getByRole("region", { name: /^Take the tour/ });
      await expect(homeCard).toContainText("Take the tour · 0 of 5");
      await homeCard.getByRole("button", { name: "Minimise the tour" }).click();
      await expect(homeCard).toHaveCount(0);
      await expect(card(page)).toContainText("Step 1 of 5 · Write a plan");
      await expect.poll(() => events("tour_minimised")).toContain("card");

      // Changing pages never minimises it.
      await page.goto("/connections");
      await expect(card(page)).toContainText("Step 1 of 5 · Write a plan");
      // The card is outside the side nav, clear of the credits meter.
      const nav = await page.getByRole("navigation", { name: "Workspace" }).boundingBox();
      const box = await card(page).boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(nav!.x + nav!.width);

      // Only × minimises it, to a small pill, saved across reloads; the pill brings it back.
      await card(page).getByRole("button", { name: "Minimise the tour" }).click();
      await expect(page.getByRole("button", { name: "Show the tour · 0 of 5" })).toBeVisible();
      await expect.poll(() => events("tour_minimised")).toContain("guide");
      await page.reload();
      await page.getByRole("button", { name: "Show the tour · 0 of 5" }).click();
      await expect(card(page)).toBeVisible();

      // Don't show again, from All steps; it stays gone; ⌘K brings it back with its steps open.
      await card(page).getByRole("button", { name: "All steps" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Don't show again" }).click();
      await expect(card(page)).toHaveCount(0);
      await page.goto("/home");
      await expect(card(page)).toHaveCount(0);
      await page.keyboard.press("ControlOrMeta+k");
      await page.getByRole("combobox", { name: "Search" }).fill("tour");
      await page.getByRole("option", { name: /Take the tour/ }).click();
      await expect(card(page)).toBeVisible();
      await expect(page.getByRole("dialog").filter({ hasText: /^The tour · / })).toBeVisible();
    });
  });
});
