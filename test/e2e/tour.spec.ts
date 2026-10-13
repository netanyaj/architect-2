import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, demoWorkspace, type TestUser } from "./helpers";

/* The tour (round 7): the welcome on first sign-in, then three chapters on the adapted shadcn tour component. Next
   performs each step's action on the real control; Back, Skip this chapter and Skip tour; progress survives a reload;
   chapter 2 has one step per side-nav item and leaves out what the person can't see. */

const card = (page: Page) => page.locator("[data-tour-card]");

/** The story, as an Owner with governance on (the seeded Acme Ops). */
const STORY = [
  "Describe the app once",
  "The plan comes first",
  "A question, and a change",
  "The look, before building",
  "Build, at the price you saw",
  "Proof per part",
  "A blocker you can fix",
  "Connections",
  "The live preview",
  "Agents",
  "Developer view, and Import a repo",
  "Launch",
  "Approvals",
  "Governance",
];
/** What Next says on the steps that act (Rule 1: the button names the action). */
const ACTS: Record<string, string> = {
  "Describe the app once": "Write the plan",
  "A question, and a change": "Use the recommended answer",
  "Build, at the price you saw": "Build it",
  "Proof per part": "Open this part",
  "A blocker you can fix": "Connect it",
  "The live preview": "Point at something",
  Launch: "Go live",
  Approvals: "Approve it",
};
/** Chapter 2: the nav item, then its page (Settings shows its menu too). */
const AROUND_ON = ["Home", "Projects", "Agents", "Connections", "Marketplace", "Usage", "Approvals", "Governance", "Settings"];
const AROUND_OFF = ["Home", "Projects", "Agents", "Connections", "Marketplace", "Usage", "Settings"];
/** Steps whose control may not exist (no question in this plan; no agents in the list yet). */
const OPTIONAL_SPOT = new Set(["A question, and a change"]);

/** The card shows this step and its place in the tour, inside the screen, and spotlights a control on screen when it has one. */
async function atCard(page: Page, chapter: number, step: number, of: number, title: string, opts: { spotlight?: boolean } = {}) {
  await expect(card(page).locator("#tour-step-title")).toHaveText(title, { timeout: 240_000 });
  await expect(card(page)).toContainText(`Chapter ${chapter} of 3 · step ${step} of ${of}`);
  await expect(card(page)).toBeInViewport();
  if (opts.spotlight) {
    const spot = page.locator("[data-tour-spotlight]");
    await expect(spot).toBeVisible({ timeout: 20_000 });
    await expect(spot).toBeInViewport();
  }
}

async function next(page: Page, label?: string) {
  const btn = card(page).locator("[data-tour-next]");
  await expect(btn).toHaveText(label ?? /^(Next|Open .+|Finish)$/);
  await btn.click();
}

test.describe("Tour", () => {
  test.setTimeout(900_000);
  let user: TestUser | undefined;
  test.afterEach(async () => {
    if (user) await deleteTestUser(user);
    user = undefined;
  });

  test("a fresh account: the welcome, every step of all three chapters, Back, and a reload that resumes", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    user = await createTestUser("tour", { fresh: true });
    await signIn(page, user);
    const db = adminDb();

    // First sign-in: the welcome, with Start the tour and Skip.
    const welcome = page.getByRole("alertdialog");
    await expect(welcome).toContainText("Welcome to Architect 2.0");
    await expect(welcome.getByRole("button", { name: "Skip" })).toBeVisible();
    await welcome.getByRole("button", { name: "Start the tour" }).click();

    // Chapter 1, the story. New-in-2.0 steps carry the icon; steps that act name the action on Next.
    await atCard(page, 1, 1, STORY.length, STORY[0], { spotlight: true });
    await expect(card(page).getByRole("img", { name: "New in Architect 2.0" })).toBeVisible();
    for (let i = 0; i < STORY.length; i++) {
      const title = STORY[i];
      await atCard(page, 1, i + 1, STORY.length, title, { spotlight: !OPTIONAL_SPOT.has(title) });
      if (title === "The look, before building") {
        // Back shows the previous card; Next comes back.
        await card(page).getByRole("button", { name: "Back" }).click();
        await atCard(page, 1, i, STORY.length, STORY[i - 1]);
        await next(page, ACTS[STORY[i - 1]]);
        await atCard(page, 1, i + 1, STORY.length, title, { spotlight: true });
      }
      if (title === "Proof per part") {
        // Build from the Plan tab opened the App view, with Parts and Chat open.
        await expect(page).not.toHaveURL(/view=plan/);
        await expect(page.getByRole("complementary", { name: "Parts" })).toBeVisible();
        await expect(page.getByRole("complementary", { name: "Chat" })).toBeVisible();
      }
      if (title === "A blocker you can fix") {
        // A reload mid-tour resumes on the same step.
        await page.reload();
        await atCard(page, 1, i + 1, STORY.length, title, { spotlight: true });
      }
      await next(page, ACTS[title]);
    }

    // Chapter 2: each nav item, then its page.
    for (let i = 0; i < AROUND_ON.length; i++) {
      const label = AROUND_ON[i];
      await atCard(page, 2, i + 1, AROUND_ON.length, label, { spotlight: true });
      await next(page, `Open ${label}`);
      await atCard(page, 2, i + 1, AROUND_ON.length, label, { spotlight: label !== "Agents" });
      if (label === "Settings") {
        await expect(page).toHaveURL(/\/settings\/members$/);
        await next(page);
        await atCard(page, 2, i + 1, AROUND_ON.length, label, { spotlight: true });
        await expect(card(page)).toContainText("Docs, What's new, Trash and the community live in Resources");
      }
      await next(page);
    }

    // Chapter 3: Help and ⌘K, then the finish.
    await atCard(page, 3, 1, 2, "Help and ⌘K", { spotlight: true });
    await next(page);
    await atCard(page, 3, 2, 2, "You've seen the whole story");
    await expect(card(page).getByRole("link", { name: /Read the README/ })).toBeVisible();
    await expect(card(page).getByRole("button", { name: "Reset demo data" })).toBeVisible();
    await next(page, "Explore on your own");
    await expect(card(page)).toHaveCount(0);
    await expect.poll(async () => ((await db.from("user_preferences").select("tour").eq("user_id", user!.id).single()).data!.tour as { finished?: boolean }).finished).toBe(true);
    // Take the tour stays in the side nav.
    await page.goto("/home");
    await expect(page.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name: "Take the tour" })).toBeVisible();
  });

  test("Skip on the welcome; Take the tour; Skip this chapter; Skip tour mid-way and Take the tour resumes there", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    user = await createTestUser("tourskip", { fresh: true });
    await signIn(page, user);
    const welcome = page.getByRole("alertdialog");
    await welcome.getByRole("button", { name: "Skip" }).click();
    await expect(welcome).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);

    // Resources has Take the tour; so does the side nav, which opens the welcome again.
    await page.getByRole("button", { name: "Resources" }).click();
    await expect(page.getByRole("menuitem", { name: "Take the tour" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name: "Take the tour" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Start the tour" }).click();
    await atCard(page, 1, 1, STORY.length, STORY[0], { spotlight: true });

    // Skip this chapter: straight to chapter 2.
    await card(page).getByRole("button", { name: "Skip this chapter" }).click();
    await atCard(page, 2, 1, AROUND_ON.length, "Home", { spotlight: true });
    await next(page, "Open Home");
    await atCard(page, 2, 1, AROUND_ON.length, "Home", { spotlight: true });
    await next(page);
    await atCard(page, 2, 2, AROUND_ON.length, "Projects", { spotlight: true });
    // Skip tour, then Take the tour (here from ⌘K) picks up where it was.
    await card(page).getByRole("button", { name: "Skip tour" }).click();
    await expect(card(page)).toHaveCount(0);
    await expect.poll(async () => ((await adminDb().from("user_preferences").select("tour").eq("user_id", user!.id).single()).data!.tour as { dismissed?: boolean }).dismissed).toBe(true);
    await page.reload();
    await expect(card(page)).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("combobox", { name: "Search" }).fill("tour");
    await page.getByRole("option", { name: /Take the tour/ }).click();
    await atCard(page, 2, 2, AROUND_ON.length, "Projects", { spotlight: true });
  });

  test("chapter 2 with governance off: no Approvals or Governance, and Settings says what turning it on adds", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    user = await createTestUser("touroff");
    await signIn(page, user);
    const ws = await demoWorkspace(user);
    const db = adminDb();
    await db.from("workspaces").update({ governance_enabled: false }).eq("id", ws);
    await db.from("user_preferences").upsert({ user_id: user.id, tour: { welcomed: true, started: true, chapter: "around", step: "nav-home" } });
    await page.goto("/home");
    for (let i = 0; i < AROUND_OFF.length; i++) {
      const label = AROUND_OFF[i];
      await atCard(page, 2, i + 1, AROUND_OFF.length, label, { spotlight: true });
      if (label === "Settings") await expect(card(page)).toContainText("Turning governance on here adds Approvals and Governance to the nav.");
      await next(page, `Open ${label}`);
      await atCard(page, 2, i + 1, AROUND_OFF.length, label);
      if (label === "Settings") {
        await next(page);
        await atCard(page, 2, i + 1, AROUND_OFF.length, label);
      }
      await next(page);
    }
    await atCard(page, 3, 1, 2, "Help and ⌘K", { spotlight: true });
  });
});
