import { expect, test, type Page } from "@playwright/test";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

const MEETING_PREP =
  "Before each meeting on my calendar, send me a Slack brief with each attendee's last email thread, a summary of any attached agenda PDF, and three talking points.";

async function signIn(page: Page, user: TestUser) {
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/home$/);
  await page.waitForLoadState("networkidle");
}

async function writePlan(page: Page, prompt: string) {
  await page.getByLabel("Describe your app").fill(prompt);
  await page.getByRole("button", { name: "Write the plan" }).click();
  await page.waitForURL(/\/p\/[0-9a-f-]{36}$/);
  return page.url().split("/p/")[1];
}

test.describe("M2: plans and chat", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(150_000);
  let user: TestUser;
  let projectId: string;

  test.beforeAll(async () => {
    user = await createTestUser("planner");
  });
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });

  test("the plan streams in, a blocking question holds Build, and only the click starts a build", async ({ page }) => {
    await signIn(page, user);
    const started = Date.now();
    projectId = await writePlan(page, MEETING_PREP);

    // Within 60 s: every part with a price, and the Slack workspace question (no safe default).
    await expect(page.getByText(/Here's the plan: \d+ parts/)).toBeVisible({ timeout: 60_000 });
    expect(Date.now() - started).toBeLessThan(60_000);
    await expect(page.getByRole("heading", { name: "Which Slack workspace should this post to?" })).toBeVisible();
    await expect(page.getByText(/~\d+ cr/).first()).toBeVisible();

    const build = page.getByRole("button", { name: /^Build · ~\d+ credits$/ });
    await expect(build).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText(/^Answer 1 question to build · [\d,]+ credits available$/)).toBeVisible();

    const db = adminDb();
    expect((await db.from("runs").select("id").eq("project_id", projectId)).data).toEqual([]);
    const { data: usage } = await db.from("usage_ledger").select("kind").eq("project_id", projectId);
    expect(usage!.map((u) => u.kind)).toEqual(["blueprint"]); // drafting is shown; nothing else charged

    await page.getByRole("button", { name: /The workspace you connected/ }).click();
    await expect(build).not.toHaveAttribute("aria-disabled", "true");
    expect((await db.from("runs").select("id").eq("project_id", projectId)).data).toEqual([]); // still nothing

    await build.click();
    await expect(page.getByRole("heading", { name: "Your build is queued" })).toBeVisible();
    const { data: runs } = await db.from("runs").select("kind, status, started_by").eq("project_id", projectId);
    expect(runs).toEqual([{ kind: "build", status: "queued", started_by: user.id }]);
    const { data: plan } = await db.from("blueprints").select("status, agreed_at").eq("project_id", projectId).single();
    expect(plan!.status).toBe("agreed");
    expect(plan!.agreed_at).not.toBeNull();
  });

  test("a chat request returns a change card with a price; Apply makes a new version and builds nothing yet", async ({ page }) => {
    await signIn(page, user);
    const id = await writePlan(page, "Every Monday, send me a Slack message in #ops listing vendor renewals due this month.");
    await expect(page.getByText(/Here's the plan: \d+ parts/)).toBeVisible({ timeout: 60_000 });

    const chat = page.getByRole("complementary", { name: "Chat" });
    await chat.getByLabel("Message Architect").fill("Also send me a Friday recap of the renewals that were handled.");
    await chat.getByRole("button", { name: "Send" }).click();
    const card = chat.locator("div.rounded-card").filter({ hasText: "Suggested change" });
    await expect(card).toBeVisible({ timeout: 45_000 });
    await expect(card).toContainText(/~\d+ credits|No extra cost/);

    await card.getByRole("button", { name: "Apply" }).click();
    await expect(chat.getByText("Applied. This is now plan v2.")).toBeVisible();
    const db = adminDb();
    expect((await db.from("blueprints").select("version").eq("project_id", id)).data!.map((b) => b.version).sort()).toEqual([1, 2]);
    expect((await db.from("runs").select("id").eq("project_id", id)).data).toEqual([]);
  });

  test("a free-tier rate limit shows the paused banner with Switch model, not a crash", async ({ page }) => {
    test.skip(Boolean(process.env.E2E_BASE_URL?.startsWith("https://")), "Uses a dev-only test hook; production has no way to fake a 429.");
    await signIn(page, user);
    await writePlan(page, "Send me a Slack note every Friday. [[simulate-429]]");
    const banner = page.getByRole("status").filter({ hasText: "is busy right now" });
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner.getByRole("button", { name: "Switch model" })).toBeVisible();
    await expect(banner).toContainText("Nothing was built or charged.");
    await expect(page.getByRole("button", { name: "Build", exact: true })).toHaveAttribute("aria-disabled", "true");
  });
});
