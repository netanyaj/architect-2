import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, demoWorkspace, type TestUser } from "./helpers";

/* The tour (round 7): the welcome on first sign-in, then three chapters on the adapted shadcn tour component. Every step
   has a place (its route and view state); Next, Back and a resume go there first, then show the card. Next performs a
   step's action once; Back never undoes it. */

const card = (page: Page) => page.locator("[data-tour-card]");

type Card = { title: string; act?: string; count: number; spotlight?: boolean; place: RegExp };

/** Chapter 1 for an Owner, with governance on or off. */
function story(gov: boolean): Card[] {
  const cards: Card[] = [
    { title: "Describe the app once", act: "Write the plan", count: 1, spotlight: true, place: /\/home\?tour=plan$/ },
    // The plan opens at /p/<id> (a draft opens on its plan); Back to it comes to ?view=plan, the same screen.
    { title: "The plan comes first", count: 2, spotlight: true, place: /\/p\/[0-9a-f-]{36}(\?view=plan)?$/ },
    { title: "A question, and a change", act: "Use the recommended answer", count: 3, place: /\?view=plan$/ },
    { title: "The look, before building", count: 4, spotlight: true, place: /\?view=plan$/ },
    { title: "Build, at the price you saw", act: "Build it", count: 5, spotlight: true, place: /\?view=plan$/ },
    { title: "Proof per part", act: "Open this part", count: 6, spotlight: true, place: /\/p\/[0-9a-f-]{36}$/ },
    { title: "A blocker you can fix", act: "Connect it", count: 7, spotlight: true, place: /\/p\/[0-9a-f-]{36}$/ },
    { title: "Connections", count: 8, spotlight: true, place: /\/connections$/ },
    { title: "The live preview", act: "Point at something", count: 9, spotlight: true, place: /\/p\/[0-9a-f-]{36}$/ },
    { title: "Agents", count: 10, spotlight: true, place: /\?view=agents$/ },
    { title: "Developer view", act: "Open Developer view", count: 11, spotlight: true, place: /\/p\/[0-9a-f-]{36}$/ },
    { title: "Developer view: Code", act: "Open Terminal", count: 11, spotlight: true, place: /\?dev=1$/ },
    { title: "Your repo, branches and PRs", count: 12, spotlight: true, place: /\?dev=1&view=terminal$/ },
    { title: "Launch", act: "Go live", count: 13, spotlight: true, place: /\/launch$/ },
  ];
  if (gov) cards.push({ title: "Approvals", act: "Approve it", count: 14, spotlight: true, place: /\/governance\/approvals$/ });
  cards.push({ title: gov ? "Governance" : "Governance is off here", count: gov ? 15 : 14, spotlight: true, place: gov ? /\/governance$/ : /\/settings\/governance$/ });
  return cards;
}

/** Chapter 2: one card per page (Settings has two). */
function around(gov: boolean): Card[] {
  const pages: [string, RegExp][] = [
    ["Home", /\/home$/],
    ["Projects", /\/projects$/],
    ["Agents", /\/agents$/],
    ["Connections", /\/connections$/],
    ["Marketplace", /\/marketplace$/],
    ["Usage", /\/usage$/],
    ...(gov ? ([["Approvals", /\/governance\/approvals$/], ["Governance", /\/governance$/]] as [string, RegExp][]) : []),
  ];
  const cards: Card[] = pages.map(([title, place], i) => ({ title, count: i + 1, spotlight: true, place }));
  const n = pages.length + 1;
  cards.push({ title: "Settings", count: n, spotlight: true, place: /\/settings$/ }, { title: "Settings", count: n, spotlight: true, place: /\/settings$/ });
  return cards;
}

const total = (cards: Card[]) => new Set(cards.map((c) => c.count)).size;

/** The card shows this step at its place, with its place in the tour, and lights up its control when it has one. */
async function atCard(page: Page, chapter: number, cards: Card[], i: number, opts: { spotlight?: boolean } = {}) {
  const c = cards[i];
  await expect(card(page).locator("#tour-step-title")).toHaveText(c.title, { timeout: 240_000 });
  await expect(card(page)).not.toHaveAttribute("data-tour-phase", "moving", { timeout: 60_000 });
  await expect(card(page)).toContainText(`Chapter ${chapter} of 3 · step ${c.count} of ${total(cards)}`);
  await expect(page).toHaveURL(c.place);
  await expect(card(page)).toBeInViewport();
  if (opts.spotlight ?? c.spotlight) {
    const spot = page.locator("[data-tour-spotlight]");
    await expect(spot).toBeVisible({ timeout: 200_000 });
    await expect(spot).toBeInViewport();
  }
}

async function next(page: Page, label: string | RegExp = /^(Next|Finish)$/) {
  const btn = card(page).locator("[data-tour-next]");
  await expect(btn).toHaveText(label);
  await btn.click();
}

/** Back shows the previous step at its place, as it is now; Next comes back without doing the previous action again. */
async function backAndForth(page: Page, chapter: number, cards: Card[], i: number) {
  await card(page).getByRole("button", { name: "Back" }).click();
  // A done Build or a connected blocker has no control left: the card lights up the result instead.
  await atCard(page, chapter, cards, i - 1);
  await expect(card(page).getByRole("button", { name: "Take me there" })).toHaveCount(0);
  await next(page, /^Next$/);
  await atCard(page, chapter, cards, i);
}

async function walk(page: Page, gov: boolean, opts: { backs: boolean; reloadAt?: string }) {
  const s = story(gov);
  for (let i = 0; i < s.length; i++) {
    await atCard(page, 1, s, i);
    if (i === 0) await expect(card(page).getByRole("img", { name: "New in Architect 2.0" })).toBeVisible();
    if (opts.backs && i > 0) await backAndForth(page, 1, s, i);
    if (s[i].title === "Proof per part") {
      // Build from the Plan tab opened the App view, with Parts and Chat open.
      await expect(page.getByRole("complementary", { name: "Parts" })).toBeVisible();
      await expect(page.getByRole("complementary", { name: "Chat" })).toBeVisible();
    }
    if (s[i].title === opts.reloadAt) {
      // Straight after Back and Next, while their saves may still be queued: the tab's own copy resumes here.
      await page.reload();
      await atCard(page, 1, s, i);
    }
    await next(page, s[i].act ?? /^Next$/);
  }
  const a = around(gov);
  for (let i = 0; i < a.length; i++) {
    await atCard(page, 2, a, i);
    if (opts.backs && i > 0) await backAndForth(page, 2, a, i);
    if (i === a.length - 1) await expect(card(page)).toContainText("Docs, What's new, Trash and the community live in Resources");
    await next(page);
  }
  await expect(card(page).locator("#tour-step-title")).toHaveText("Help and ⌘K", { timeout: 60_000 });
  await expect(card(page)).toContainText("Chapter 3 of 3 · step 1 of 2");
  await next(page);
  await expect(card(page).locator("#tour-step-title")).toHaveText("You've seen the whole story");
  await expect(card(page).getByRole("link", { name: /Read the README/ })).toBeVisible();
  await next(page, "Explore on your own");
  await expect(card(page)).toHaveCount(0);
}

test.describe("Tour", () => {
  test.setTimeout(1_200_000);
  let user: TestUser | undefined;
  test.afterEach(async () => {
    if (user) await deleteTestUser(user);
    user = undefined;
  });

  test("governance on, a fresh account: every step, Back from each to the one before, and a reload mid-tour", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    user = await createTestUser("tour", { fresh: true });
    await signIn(page, user);
    const welcome = page.getByRole("alertdialog");
    await expect(welcome).toContainText("Welcome to Architect 2.0");
    await welcome.getByRole("button", { name: "Start the tour" }).click();
    await walk(page, true, { backs: true, reloadAt: "A blocker you can fix" });
    await expect
      .poll(async () => ((await adminDb().from("user_preferences").select("tour").eq("user_id", user!.id).single()).data!.tour as { finished?: boolean }).finished)
      .toBe(true);
    await page.goto("/home");
    await expect(page.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name: "Take the tour" })).toBeVisible();
  });

  test("governance off: the whole tour, Launch goes straight to Live, no Approvals, and Governance shows the switch", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    user = await createTestUser("touroff", { fresh: true });
    await signIn(page, user);
    await page.getByRole("alertdialog").waitFor();
    await adminDb().from("workspaces").update({ governance_enabled: false }).eq("id", await demoWorkspace(user));
    await page.reload();
    await page.getByRole("alertdialog").getByRole("button", { name: "Start the tour" }).click();
    await walk(page, false, { backs: false });
  });

  test("Back and Next pressed quickly 10 times: only the last request wins, and the card matches its page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    user = await createTestUser("tourfast");
    await signIn(page, user);
    await adminDb().from("user_preferences").upsert({ user_id: user.id, tour: { welcomed: true, started: true, chapter: "around", step: "nav-connections" } });
    await page.goto("/connections");
    const a = around(true);
    await atCard(page, 2, a, 3);
    const back = card(page).getByRole("button", { name: "Back" });
    const fwd = card(page).locator("[data-tour-next]");
    for (let i = 0; i < 10; i++) {
      await (i % 2 ? fwd : back).click({ force: true, timeout: 2_000 }).catch(() => {});
    }
    await expect(card(page)).not.toHaveAttribute("data-tour-phase", "moving", { timeout: 30_000 });
    const title = (await card(page).locator("#tour-step-title").textContent())!.trim();
    const shown = a.find((c) => c.title === title)!;
    expect(shown).toBeTruthy();
    await expect(page).toHaveURL(shown.place);
    await expect(page.locator("[data-tour-spotlight]")).toBeVisible();
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
    await atCard(page, 1, story(true), 0);

    // Skip this chapter: straight to chapter 2.
    const a = around(true);
    await card(page).getByRole("button", { name: "Skip this chapter" }).click();
    await atCard(page, 2, a, 0);
    await next(page);
    await atCard(page, 2, a, 1);
    // Skip tour, then Take the tour (here from ⌘K) picks up where it was.
    await card(page).getByRole("button", { name: "Skip tour" }).click();
    await expect(card(page)).toHaveCount(0);
    await expect.poll(async () => ((await adminDb().from("user_preferences").select("tour").eq("user_id", user!.id).single()).data!.tour as { dismissed?: boolean }).dismissed).toBe(true);
    await page.reload();
    await expect(card(page)).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("combobox", { name: "Search" }).fill("tour");
    await page.getByRole("option", { name: /Take the tour/ }).click();
    await atCard(page, 2, a, 1);
  });
});
