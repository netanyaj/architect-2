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
    // The server decides what blocks (the model only labels): exactly one blocking question, the Slack workspace one
    // (the request asks for Slack and names no channel). Its wording is the model's, so read it from the database.
    const { data: bpRow } = await adminDb().from("blueprints").select("id").eq("project_id", projectId).single();
    const { data: blocking } = await adminDb().from("questions").select("text").eq("blueprint_id", bpRow!.id).eq("blocking", true);
    expect(blocking).toHaveLength(1);
    expect(blocking![0].text).toMatch(/slack/i);
    await expect(page.getByRole("heading", { name: blocking![0].text })).toBeVisible();
    await expect(page.getByText(/~\d+ cr/).first()).toBeVisible();

    const build = page.getByRole("button", { name: /^Build · ~\d+ credits$/ });
    await expect(build).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText(/^Answer 1 question to build · [\d,]+ credits available$/)).toBeVisible();

    const db = adminDb();
    expect((await db.from("runs").select("id").eq("project_id", projectId)).data).toEqual([]);
    const { data: usage } = await db.from("usage_ledger").select("kind").eq("project_id", projectId);
    expect(usage!.map((u) => u.kind)).toEqual(["blueprint"]); // drafting is shown; nothing else charged

    // Answer it with its first option, whatever the model called it.
    const question = page.locator("section").filter({ has: page.getByRole("heading", { name: blocking![0].text }) }).first();
    await question.getByRole("button").first().click();
    await expect(build).not.toHaveAttribute("aria-disabled", "true");
    expect((await db.from("runs").select("id").eq("project_id", projectId)).data).toEqual([]); // still nothing

    await build.click();
    // Only the click starts the build, and it starts playing at once (M3).
    await expect(page.getByRole("navigation", { name: "Project stage" })).toContainText(/\d+ of \d+ working/);
    const { data: runs } = await db.from("runs").select("kind, status, started_by").eq("project_id", projectId);
    expect(runs).toEqual([{ kind: "build", status: "running", started_by: user.id }]);
    const { data: plan } = await db.from("blueprints").select("status, agreed_at").eq("project_id", projectId).single();
    expect(plan!.status).toBe("agreed");
    expect(plan!.agreed_at).not.toBeNull();
  });

  test("a chat request returns a change card with a price; Apply makes a new version; a removal needs a decision", async ({ page }) => {
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

    // Conflict guard (A-3): removing a part needs Keep / Set aside / Drop before Apply.
    await chat.getByLabel("Message Architect").fill("Remove the Monday Slack message, I'll check renewals myself.");
    await chat.getByRole("button", { name: "Send" }).click();
    await expect(chat.getByText(/This change (removes|weakens) it/).first()).toBeVisible({ timeout: 45_000 });
    const apply = chat.getByRole("button", { name: "Apply" }).last();
    await expect(apply).toHaveAttribute("aria-disabled", "true");
    await expect(apply).toHaveAttribute("title", /^Decide what happens to/);
    // The model may remove a part and also weaken another: every one needs its own decision.
    const guards = chat.getByRole("group", { name: /^What happens to / });
    const n = await guards.count();
    for (let i = 0; i < n; i++) {
      await guards.nth(i).getByRole("button", { name: "Drop" }).click();
      await chat.getByLabel(/Why \(saved on the plan\)/).nth(i).fill("I'll check renewals myself");
    }
    await apply.click();
    await expect(chat.getByText("Applied. This is now plan v3.")).toBeVisible();
    const { data: v3 } = await db.from("blueprints").select("id").eq("project_id", id).eq("version", 3).single();
    // Dropped parts are struck through; dropped weakenings are applied with the reason saved on them.
    const { data: decided } = await db.from("items").select("status, drop_reason").eq("blueprint_id", v3!.id).not("drop_reason", "is", null);
    expect(decided!.length).toBeGreaterThan(0);
    expect(decided!.every((d) => (d.status === "dropped" ? d.drop_reason === "I'll check renewals myself" : d.drop_reason === "Weakened: I'll check renewals myself"))).toBe(true);
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
