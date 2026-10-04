import { expect, test, type Page } from "@playwright/test";
import { seedPlan, signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

/* The simulated build (M3) over a recorded Meeting Prep plan, at ?sim=fast so a run takes ~25 s. */

const panel = (page: Page) => page.getByRole("complementary", { name: "Plan" });

test.describe("M3: the simulated build", () => {
  test.setTimeout(150_000);
  let user: TestUser;

  test.beforeAll(async () => {
    user = await createTestUser("builder");
  });
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });

  test("Build plays every part with its check, a fix, a connection to make, then settles once (screen 3)", async ({ page }) => {
    await signIn(page, user);
    const id = await seedPlan(user, "Meeting Prep A");
    await page.goto(`/p/${id}?sim=fast`);
    await page.getByRole("button", { name: /^Build · ~60 credits$/ }).click();

    // While it plays: live progress in the stepper, a part building, then the fix.
    await expect(page.getByRole("navigation", { name: "Project stage" })).toContainText(/\d of 6 working/, { timeout: 20_000 });
    // The fix lasts ~1.5 s at ?sim=fast: watch the page itself rather than polling with backoff.
    await page.waitForFunction(() => document.querySelector('aside[aria-label="Plan"]')?.textContent?.includes("A check failed (too long). Fixing it, try 1 of 3."), null, {
      polling: 100,
      timeout: 60_000,
    });
    await expect(panel(page).getByRole("button", { name: "Connect Google account" })).toBeVisible();
    await expect(page.getByTitle("Launch opens when the build finishes.")).toBeVisible();

    // Settled: the Launch stage, and the database has the real outcome.
    await expect(page.getByRole("link", { name: "Launch", exact: true })).toBeVisible({ timeout: 60_000 });
    const db = adminDb();
    const { data: runs } = await db.from("runs").select("status, kind").eq("project_id", id);
    expect(runs).toEqual([{ status: "done", kind: "build" }]);
    const { data: usage } = await db.from("usage_ledger").select("kind, note").eq("project_id", id).order("kind");
    expect(usage!.map((u) => u.kind)).toEqual(["build", "fix"]);
    expect(usage![1].note).toBe("Fix · Talking points generator, try 1 of 3");
    const { data: gmail } = await db.from("items").select("status").eq("project_id", id).eq("key", "attendee-email-threads").single();
    expect(gmail!.status).toBe("needs_connection");

    // Connect flips the part to Works (BL-9).
    await panel(page).getByRole("button", { name: "Connect Google account" }).click();
    await expect(panel(page).getByRole("button", { name: "Connect Google account" })).toHaveCount(0);
    const { data: after } = await db.from("items").select("status").eq("project_id", id).eq("key", "attendee-email-threads").single();
    expect(after!.status).toBe("built");

    // The chat says what it did, with the steps behind it.
    const chat = page.getByRole("complementary", { name: "Chat" });
    await chat.getByRole("button", { name: /Show what I did \(\d+ steps\)/ }).click();
    await expect(chat.getByText("Building", { exact: true }).first()).toBeVisible();
  });

  test("?sim=paused: a part is Blocked after 3 fixes; the suggested fix makes it work (screen 6)", async ({ page }) => {
    await signIn(page, user);
    const id = await seedPlan(user, "Meeting Prep B");
    await page.goto(`/p/${id}?sim=paused,fast`);
    await page.getByRole("button", { name: /^Build · ~60 credits$/ }).click();

    const blocked = panel(page).getByRole("button", { name: /Talking points generator is blocked/ });
    await expect(blocked).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("navigation", { name: "Project stage" })).toContainText("1 blocked");
    await expect(page.getByRole("link", { name: "Launch", exact: true }).or(page.getByTitle(/no part is blocked/))).toBeVisible({ timeout: 60_000 });
    await blocked.click();

    const drawer = page.getByRole("dialog", { name: "Talking points generator is blocked" });
    await expect(drawer.getByText("What I tried")).toBeVisible();
    await expect(drawer.getByRole("listitem")).toHaveCount(3);
    await expect(drawer.getByText("236 words · 2 cr").or(drawer.getByText("236 words · 3 cr"))).toBeVisible();
    await expect(drawer.getByText("Allow up to 250 words")).toBeVisible();
    await drawer.getByRole("button", { name: "Allow 250 words" }).click();

    await expect(blocked).toHaveCount(0);
    const db = adminDb();
    const { data: part } = await db.from("items").select("status, proved_when, fix_attempts").eq("project_id", id).eq("key", "talking-points-generator").single();
    expect(part).toEqual({ status: "built", proved_when: "Done when briefs stay under 250 words and name every attendee.", fix_attempts: 3 });
    const { data: fixes } = await db.from("usage_ledger").select("note").eq("project_id", id).eq("kind", "fix");
    expect(fixes).toHaveLength(3);
  });

  test("?sim=budget: the build pauses at the budget, keeps what works, and continues when raised (screen 7)", async ({ page }) => {
    await signIn(page, user);
    const id = await seedPlan(user, "Meeting Prep C");
    await page.goto(`/p/${id}?sim=budget,fast`);
    await page.getByRole("button", { name: /^Build · ~60 credits$/ }).click();

    const banner = page.getByRole("status").filter({ hasText: /^Paused: this project used its \d+-credit budget/ });
    await expect(banner).toBeVisible({ timeout: 90_000 });
    await expect(panel(page).getByRole("heading", { name: "Waiting for budget" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Project stage" })).toContainText("paused at budget");
    const chat = page.getByRole("complementary", { name: "Chat" });
    await expect(chat.getByText("Still to build")).toBeVisible();

    const raise = banner.getByRole("button", { name: /^Raise budget to \d+ and continue$/ });
    await raise.click();
    await expect(banner).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByRole("link", { name: "Launch", exact: true })).toBeVisible({ timeout: 90_000 });
    const db = adminDb();
    const { data: runs } = await db.from("runs").select("status").eq("project_id", id).order("started_at");
    expect(runs!.map((r) => r.status)).toEqual(["paused_budget", "done"]);
  });
});
