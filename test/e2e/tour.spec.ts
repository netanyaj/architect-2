import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, demoWorkspace, type TestUser } from "./helpers";

/* Tour v2 (M6): the whole path in a signed-in account's demo workspace. The card on Home, × to the guide, the guide on
   every page, minimised to a dot and back, Don't show again, back through ⌘K, each step done for real (a plan written
   by the model, a build, a blocker, a Live approval, the audit log), a message after each step, and the finish card. */

const guide = (page: Page) => page.getByRole("group", { name: "Tour" });
const steps = (page: Page) => page.getByRole("dialog").filter({ hasText: /^The tour · / });

test.describe("Tour v2", () => {
  test.setTimeout(300_000);
  let user: TestUser;
  let ws: string;
  test.beforeAll(async () => {
    user = await createTestUser("tour");
  });
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });

  test("start, minimise, come back through ⌘K, do all five steps, and finish", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await signIn(page, user);
    ws = await demoWorkspace(user);
    const db = adminDb();
    const events = async (event: string) => (await db.from("analytics_events").select("detail").eq("user_id", user.id).eq("event", event)).data!.map((e) => e.detail);

    // A normal account: a compact card under the composer, and Write the plan stays the page's primary.
    await page.goto("/home");
    const card = page.getByRole("region", { name: /^Take the tour/ });
    await expect(card).toContainText("Take the tour · 0 of 5");
    await expect(page.getByRole("button", { name: /^Write the plan/ })).toHaveClass(/bg-primary/);
    await expect(guide(page)).toHaveCount(0);

    // × puts it away to the guide (it doesn't hide it), and that's recorded.
    await card.getByRole("button", { name: "Minimise the tour" }).click();
    await expect(card).toHaveCount(0);
    await expect(guide(page)).toContainText("Tour · 0 of 5");
    await expect(guide(page)).toContainText("Next: Write a plan");
    await expect.poll(() => events("tour_minimised")).toContain("card");

    // On every app page, not just Home.
    await page.goto("/connections");
    await expect(guide(page)).toBeVisible();

    // Minimised to a dot, saved across reloads, and back.
    await guide(page).getByRole("button", { name: "Minimise the tour" }).click();
    await expect(page.getByRole("button", { name: "Show the tour · 0 of 5" })).toBeVisible();
    await expect.poll(() => events("tour_minimised")).toContain("guide");
    await page.reload();
    await page.getByRole("button", { name: "Show the tour · 0 of 5" }).click();
    await expect(guide(page)).toBeVisible();

    // Don't show again, from the steps; it stays gone; ⌘K brings it back with its steps open.
    await guide(page).getByRole("button", { name: /^Tour · 0 of 5 · Next: Write a plan/ }).click();
    await expect(steps(page)).toBeVisible();
    await steps(page).getByRole("button", { name: "Don't show again" }).click();
    await expect(guide(page)).toHaveCount(0);
    await page.goto("/home");
    await expect(guide(page)).toHaveCount(0);
    await expect(page.getByRole("region", { name: /^Take the tour/ })).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("combobox", { name: "Search" }).fill("tour");
    await page.getByRole("option", { name: /Take the tour/ }).click();
    await expect(guide(page)).toBeVisible();
    await expect(steps(page)).toBeVisible();

    // Step 1: its action opens Home with the tour's prompt; the model writes the plan.
    await steps(page).getByRole("link", { name: "Write it" }).click();
    await page.waitForURL(/\/home\?tour=plan/);
    await expect(page.getByLabel("Describe your app")).toHaveValue(/Gmail/);
    await page.getByRole("button", { name: /^Write the plan/ }).click();
    await page.waitForURL(/\/p\//, { timeout: 60_000 });
    await expect(page.getByText(/Here's the plan: \d+ parts/)).toBeVisible({ timeout: 120_000 });
    const projectUrl = page.url().split("?")[0];

    // The step's message, then the arrow to step 2. The guide sits in the Parts pane here.
    const parts = page.getByRole("complementary", { name: "Parts" });
    await expect(parts.getByRole("status")).toContainText("Step 1 done · Next: build it", { timeout: 20_000 });
    await expect(parts.getByRole("group", { name: "Tour" })).toContainText("Tour · 1 of 5");
    // The hint points at Build; Got it closes it for good.
    const hint = page.getByRole("note", { name: "Tour hint: Build it" });
    await expect(hint).toBeVisible();
    await hint.getByRole("button", { name: "Got it" }).click();
    await expect(hint).toHaveCount(0);
    await parts.getByRole("status").getByRole("button", { name: "Close" }).click();

    // Step 2: build (fast simulation). Questions that hold Build take their recommended answers.
    await page.goto(`${projectUrl}?sim=fast`);
    for (let i = 0; i < 4; i++) {
      const build = page.getByRole("button", { name: /^Build · ~\d+ credits$/ });
      if ((await build.isVisible()) && !(await build.getAttribute("aria-disabled"))) break;
      const rec = page.getByRole("button", { name: /Recommended|Use this/ }).first();
      if (await rec.isVisible().catch(() => false)) await rec.click();
      await page.waitForTimeout(1500);
    }
    await page.getByRole("button", { name: /^Build · ~\d+ credits$/ }).click();
    await expect(page.getByText(/^(Build finished|The change is built)\./).first()).toBeVisible({ timeout: 150_000 });
    await expect(parts.getByRole("status")).toContainText("Step 2 done · Next: fix a blocker", { timeout: 20_000 });

    // Step 3: the message's button goes there; connect Gmail.
    await parts.getByRole("status").getByRole("link", { name: "Connect the app" }).click();
    await expect(page.getByRole("note", { name: "Tour hint: Fix a blocker" })).toBeVisible();
    await parts.getByRole("button", { name: "Connect Google account" }).first().click();
    await page.getByRole("dialog", { name: "Connect Gmail" }).getByRole("button", { name: "Allow" }).click();
    await expect(parts.getByRole("status")).toContainText("Step 3 done · Next: launch with approval", { timeout: 20_000 });

    // Step 4: Live waits for an Owner or Admin; approve it.
    await guide(page).getByRole("button", { name: /^Tour · 3 of 5/ }).click();
    await expect(steps(page)).toContainText("Live waits for an Owner or Admin. You're the Owner: approve it yourself.");
    await steps(page).getByRole("link", { name: "Open Approvals" }).click();
    await page.waitForURL(/\/governance\/approvals/);
    await page.getByRole("region", { name: "Requests" }).getByRole("button", { name: /Make ticket-triage live/ }).click();
    await expect(page.getByRole("note", { name: "Tour hint: Launch with approval" })).toBeVisible();
    await page.getByRole("region", { name: "Request", exact: true }).getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Step 4 done · Next: see Governance and the audit log" })).toBeVisible({ timeout: 20_000 });

    // Step 5: the arrow goes straight to the audit log. Then the finish card, and the tour goes away.
    await guide(page).getByRole("link", { name: "Go to the next step: See Governance and the audit log" }).click();
    await page.waitForURL(/\/governance\?section=audit/);
    const finish = page.getByRole("region", { name: "You've seen the whole story" });
    await expect(finish).toBeVisible({ timeout: 20_000 });
    for (const link of ["Read the README", "See the architecture"]) await expect(finish.getByRole("link", { name: link })).toBeVisible();
    await expect(finish.getByRole("button", { name: "Reset demo data" })).toBeVisible();
    await finish.getByRole("button", { name: "Explore on your own" }).click();
    await expect(finish).toHaveCount(0);
    await expect(guide(page)).toHaveCount(0);
    await page.goto("/home");
    await expect(guide(page)).toHaveCount(0);
    await expect(page.getByRole("region", { name: /^Take the tour/ })).toHaveCount(0);
    await expect.poll(() => events("tour_finished")).toEqual(["explore"]);

    // Steps count only in the workspace they were done in: the Personal workspace starts from nothing.
    const { data: done } = await db.from("analytics_events").select("workspace_id").eq("user_id", user.id).in("event", ["plan_written", "build_started", "blocker_resolved", "launch"]);
    expect(new Set(done!.map((d) => d.workspace_id))).toEqual(new Set([ws]));
  });
});
