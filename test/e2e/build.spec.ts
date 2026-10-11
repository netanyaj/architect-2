import { expect, test, type Page } from "@playwright/test";
import { seedPlan, signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

/* The simulated build (M3) over a recorded Meeting Prep plan, at ?sim=fast so a run takes ~25 s. */

const panel = (page: Page) => page.getByRole("complementary", { name: "Parts" });

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
    await page.waitForFunction(() => document.querySelector('aside[aria-label="Parts"]')?.textContent?.includes("A check failed (too long). Fixing it, try 1 of 3."), null, {
      polling: 100,
      timeout: 60_000,
    });
    await expect(panel(page).getByRole("button", { name: "Connect Google account" })).toBeVisible();
    // Launch is navigation even mid-build, with what's left to fix (M5.5 review); nothing is written beside it.
    await expect(page.getByRole("link", { name: /^Launch · \d+ to fix$/ })).toBeVisible();

    // Settled: the Launch stage, and the database has the real outcome.
    await expect(page.getByText(/^(Build finished|The change is built)\./).first()).toBeVisible({ timeout: 60_000 });
    const db = adminDb();
    // The chat says so as the replay ends; the server settles the run a moment later.
    await expect.poll(async () => (await db.from("runs").select("status, kind").eq("project_id", id)).data, { timeout: 30_000 }).toEqual([{ status: "done", kind: "build" }]);
    const { data: usage } = await db.from("usage_ledger").select("kind, note").eq("project_id", id).order("kind");
    expect(usage!.map((u) => u.kind)).toEqual(["build", "fix"]);
    expect(usage![1].note).toBe("Fix · Talking points generator, try 1 of 3");
    const { data: gmail } = await db.from("items").select("status").eq("project_id", id).eq("key", "attendee-email-threads").single();
    expect(gmail!.status).toBe("needs_connection");

    // Connect flips the part to Works (BL-9).
    await panel(page).getByRole("button", { name: "Connect Google account" }).click();
    // The simulated OAuth step: what's being granted, tagged Simulated, then Allow.
    const consent = page.getByRole("dialog", { name: "Connect Gmail" });
    await expect(consent).toContainText("In the real product this opens Gmail's own sign-in");
    await consent.getByRole("button", { name: "Allow" }).click();
    await expect(consent).toHaveCount(0); // closed once connected (the page behind is hidden while it's open)
    await expect(panel(page).getByRole("button", { name: "Connect Google account" })).toHaveCount(0);
    const { data: after } = await db.from("items").select("status").eq("project_id", id).eq("key", "attendee-email-threads").single();
    expect(after!.status).toBe("built");

    // The chat says what it did, with the steps behind it.
    const chat = page.getByRole("complementary", { name: "Chat" });
    await chat.getByRole("button", { name: /Show what I did \(\d+ steps\)/ }).click();
    // One line per part (M5.8); each opens to its steps.
    const groups = chat.getByRole("list", { name: "Steps by part" }).locator(":scope > li > button");
    expect(await groups.count()).toBeGreaterThan(1);
    await chat.getByRole("list", { name: "Steps by part" }).getByRole("button", { name: /Talking points generator/ }).click();
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
    await expect(page.getByText(/^(Build finished|The change is built)\./).first()).toBeVisible({ timeout: 60_000 });
    await blocked.click();

    const drawer = page.getByRole("dialog", { name: "Talking points generator is blocked" });
    await expect(drawer.getByRole("heading", { name: "What I tried" })).toBeVisible();
    await expect(drawer.getByRole("listitem")).toHaveCount(3);
    await expect(drawer.getByText("236 words · 2 cr").or(drawer.getByText("236 words · 3 cr"))).toBeVisible();
    await expect(drawer.getByText("Allow up to 250 words")).toBeVisible();
    await drawer.getByRole("button", { name: "Allow 250 words" }).click();
    await expect(drawer).toHaveCount(0);
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
    await expect(page.getByText(/^(Build finished|The change is built)\./).first()).toBeVisible({ timeout: 90_000 });
    const db = adminDb();
    await expect
      .poll(async () => ((await db.from("runs").select("status").eq("project_id", id).order("started_at")).data ?? []).map((r) => r.status), { timeout: 30_000 })
      .toEqual(["paused_budget", "done"]);
  });

  test("A-9 and the preview dock: a Blocked part's choice works while the build plays; sizes, Point at something, problems, Test the app", async ({ page }) => {
    await signIn(page, user);
    const id = await seedPlan(user, "Field Notes");
    // Three more screens after the agents keep the build playing for a few seconds after the part is Blocked.
    const db = adminDb();
    const { data: bp } = await db.from("blueprints").select("id").eq("project_id", id).single();
    await db.from("items").insert(
      ["Weekly view", "Search", "Settings page"].map((title, n) => ({
        blueprint_id: bp!.id, project_id: id, key: `extra-${n}`, grp: "features", title, proved_when: `Done when the ${title.toLowerCase()} loads`, item_class: "screen.list", size: "m", estimate_likely: 10, position: 20 + n,
      })),
    );
    await page.goto(`/p/${id}?sim=paused,fast`);
    await page.getByRole("button", { name: /^Build · ~\d+ credits$/ }).click();

    // The generic shell shows this project's name, not Meeting Prep.
    const app = page.frameLocator('iframe[title="Field Notes, test version"]');
    await expect(app.getByRole("heading", { name: "Field Notes", level: 2 })).toBeVisible({ timeout: 30_000 });

    // Blocked while the other parts still build: decide at once.
    const blocked = panel(page).getByRole("button", { name: /Talking points generator is blocked/ });
    await expect(blocked).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("navigation", { name: "Project stage" })).toContainText(/working · /); // still playing
    await blocked.click();
    const drawer = page.getByRole("dialog", { name: "Talking points generator is blocked" });
    await expect(drawer.getByRole("listitem")).toHaveCount(3);
    await drawer.getByRole("button", { name: "Allow 250 words" }).click();
    await expect(drawer).toHaveCount(0);
    const { data: changed } = await db.from("audit_log").select("details").eq("action", "check.changed").eq("target", "Talking points generator").order("created_at", { ascending: false }).limit(1);
    expect(changed![0].details).toMatchObject({ during_build: true });

    // The build finishes with that part working.
    await expect(page.getByText(/^(Build finished|The change is built)\./).first()).toBeVisible({ timeout: 90_000 });
    // The chat says so as the replay ends; the server records it a moment later.
    await expect.poll(async () => (await db.from("items").select("status").eq("project_id", id).eq("key", "talking-points-generator").single()).data?.status, { timeout: 30_000 }).toBe("built");

    // The sizes are in the header beside the tabs (M5.8); the dock has Point at something. Then Test the app.
    const sizes = page.getByRole("banner").getByRole("group", { name: "Preview size" });
    await sizes.getByRole("button", { name: "Phone size" }).click();
    await expect(page.locator('iframe[title="Field Notes, test version"]')).toHaveClass(/w-\[390px\]/);
    await sizes.getByRole("button", { name: "Desktop size" }).click();
    // The app's Light / Dark view: Field Notes has no dark theme, so the Dark view says so and offers Add to plan.
    await page.getByRole("button", { name: "Dark view of the app" }).click();
    await expect(page.getByRole("status").filter({ hasText: "This app has no dark theme yet" })).toBeVisible();
    await page.getByRole("button", { name: "Light view of the app" }).click();
    const dock = page.getByRole("toolbar", { name: "Preview tools" });
    await dock.getByRole("button", { name: "Point at something" }).click();
    await app.locator('section[data-part="extra-1"]').click();
    await expect(page.getByLabel("Message Architect")).toHaveValue(/About “Search” in the app:/);
    await page.getByRole("button", { name: "Test the app" }).click();
    await expect(page.getByText(/checks pass/)).toBeVisible();
  });

  test("N problems opens the console, and Fix with AI hands the problem to chat", async ({ page }) => {
    await signIn(page, user);
    const id = await seedPlan(user, "Problem Prep");
    await page.goto(`/p/${id}?sim=paused,fast`);
    await page.getByRole("button", { name: /^Build · ~\d+ credits$/ }).click();
    const problems = page.getByRole("toolbar", { name: "Preview tools" }).getByRole("button", { name: "1 problem" });
    await expect(problems).toBeVisible({ timeout: 90_000 });
    await problems.click();
    const console_ = page.getByRole("dialog", { name: "Problems" });
    await expect(console_).toContainText("Talking points generator");
    await console_.getByRole("button", { name: "Fix with AI" }).click();
    await expect(page.getByLabel("Message Architect")).toHaveValue(/^Fix Talking points generator: /);
  });
});
