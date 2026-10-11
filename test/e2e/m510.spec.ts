import { expect, test } from "@playwright/test";
import { signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, demoWorkspace, type TestUser } from "./helpers";

/* M5.10 (doc 26): the demo link and the tour, ⌘K, panes that stay as you left them, the way back to Build, labels that
   say what's simulated, and the Developer panel. */

test.describe("M5.10: fixes before M6", () => {
  test.setTimeout(150_000);
  let user: TestUser;
  let ws: string;
  const ids: Record<string, string> = {};

  test.beforeAll(async () => {
    user = await createTestUser("m510");
  });
  /** Signs in (the first sign-in seeds the demo workspace), then notes its projects' ids. */
  const start = async (page: import("@playwright/test").Page) => {
    await signIn(page, user);
    ws = await demoWorkspace(user);
    const { data } = await adminDb().from("projects").select("id, name").eq("workspace_id", ws);
    for (const p of data ?? []) ids[p.name] = p.id;
  };
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });

  test("Try the demo: an anonymous visitor gets their own seeded workspace and the tour; the tour can be hidden", async ({ page }) => {
    const started = new Date().toISOString();
    await page.goto("/login");
    await page.getByRole("button", { name: "Try the demo" }).click();
    await page.waitForURL(/\/home/, { timeout: 60_000 }).catch(() => {});
    test.skip(page.url().includes("/login"), "Anonymous sign-ins aren't turned on in Supabase yet.");
    const tour = page.getByRole("region", { name: /^Take the tour/ });
    await expect(tour).toContainText("Take the tour · 0 of 5");
    await expect(tour).toContainText("You're in the demo as Priya");
    // Step 1 opens Home with the tour's prompt filled in (it uses Gmail, so step 3 has a blocker).
    await tour.getByRole("link", { name: "Write it" }).click();
    await page.waitForURL(/\/home\?tour=plan/);
    await expect(page.getByLabel("Describe your app")).toHaveValue(/Gmail/);
    // Hidden for good, per person.
    await page.getByRole("button", { name: "Hide the tour" }).click();
    await expect(page.getByRole("region", { name: /^Take the tour/ })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("region", { name: /^Take the tour/ })).toHaveCount(0);

    // Recorded as a demo user, and cleaned up here (the daily cron does it after 7 days).
    const db = adminDb();
    const { data: ev } = await db.from("analytics_events").select("user_id, is_demo").eq("event", "demo_started").gte("created_at", started).order("created_at", { ascending: false }).limit(1).single();
    expect(ev!.is_demo).toBe(true);
    await deleteTestUser({ id: ev!.user_id!, email: "", password: "" });
  });

  test("⌘K finds a project and opens it; panes stay as you left them across tabs, projects and reloads", async ({ page }) => {
    await start(page);
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: "Search" });
    await palette.getByRole("combobox", { name: "Search" }).fill("meeting prep");
    await expect(palette.getByRole("group", { name: "Projects" }).getByRole("option", { name: /Meeting Prep/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await page.waitForURL(new RegExp(`/p/${ids["Meeting Prep"]}`));

    // Collapse Chat: it stays collapsed on another tab, after a reload and in another project.
    await page.getByRole("button", { name: "Collapse chat" }).click();
    await expect(page.getByRole("button", { name: "Open chat" })).toBeVisible();
    await page.getByRole("tab", { name: "Agents" }).click();
    await expect(page.getByRole("button", { name: "Open chat" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Open chat" })).toBeVisible();
    await page.goto(`/p/${ids["ticket-triage"]}`);
    await expect(page.getByRole("button", { name: "Open chat" })).toBeVisible();
    await page.getByRole("button", { name: "Open chat" }).click();
    await expect.poll(async () => (await adminDb().from("user_preferences").select("panes").eq("user_id", user.id).single()).data!.panes).toEqual({ chat: "open" });

    // The Search row in the side nav opens the same palette.
    await page.goto("/home");
    await page.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible();
  });

  test("the way back to Build, Plan v1, the plan's model, and Simulated only on the build", async ({ page }) => {
    await start(page);
    const id = ids["Meeting Prep"];
    await page.goto(`/p/${id}/launch`);
    // Done steps are the way back: a tooltip, and one quiet line under the Launch title.
    await expect(page.getByRole("navigation", { name: "Project stage" }).getByRole("button", { name: /^Build/ })).toHaveAttribute("title", "Go to Build");
    await page.getByRole("link", { name: "Go back to Build" }).click();
    await page.waitForURL(new RegExp(`/p/${id}$`));
    await expect(page.getByRole("complementary", { name: "Parts" })).toContainText("Plan v1");
    await expect(page.getByRole("complementary", { name: "Parts" })).not.toContainText("agreed");
    const chat = page.getByRole("complementary", { name: "Chat" });
    await expect(chat.getByText("Written by", { exact: false })).toBeVisible();
    await expect(chat.getByText("Builds simulated")).toHaveCount(0);
    await expect(page.getByText("Simulated build").first()).toBeVisible();
  });

  test("Developer panel: a clean terminal with saved sessions; the console's errors become change cards; live logs per environment", async ({ page }) => {
    await start(page);
    const id = ids["Meeting Prep"];
    const db = adminDb();
    await page.goto(`/p/${id}?dev=1&view=terminal`);
    const term = page.getByRole("log", { name: "Terminal" });
    await expect(term).toContainText("Architect terminal.");
    await expect(page.getByLabel(/Command/)).toBeVisible();
    await expect(page.getByText("~/meeting-prep (main) $").first()).toBeVisible();
    await page.getByLabel(/Command/).fill("ls");
    await page.getByLabel(/Command/).press("Enter");
    await expect(term).toContainText("agents/");
    // Saved per project: after Clear it's an earlier session, read-only.
    await expect.poll(async () => (await db.from("terminal_sessions").select("id").eq("project_id", id)).data!.length).toBe(1);
    await page.getByRole("button", { name: "Clear" }).click();
    await page.getByRole("button", { name: "Current session" }).click();
    await page.getByRole("menuitem", { name: /1 command · read-only/ }).click();
    await expect(page.getByRole("log", { name: /read-only/ })).toContainText("agents/");

    // Console: a failing part is an error with Fix with AI, which asks chat for a change card.
    const { data: bp } = await db.from("blueprints").select("id").eq("project_id", id).order("version", { ascending: false }).limit(1).single();
    await db.from("items").update({ status: "failed", status_detail: "2 of 3 assertions passed" }).eq("blueprint_id", bp!.id).eq("key", (await db.from("items").select("key").eq("blueprint_id", bp!.id).eq("grp", "features").limit(1).single()).data!.key);
    await page.reload();
    await page.getByRole("tab", { name: "Console" }).click();
    await page.getByRole("button", { name: "Errors 1" }).click();
    await expect(page.getByRole("list", { name: "Console" })).toContainText("2 of 3 assertions passed");
    await page.getByRole("button", { name: "Fix with AI" }).click();
    await expect(page.getByText("Change card in chat")).toBeVisible({ timeout: 60_000 });

    // Live logs: Meeting Prep is live, so Live has lines.
    await page.getByRole("tab", { name: "Live logs" }).click();
    await page.getByRole("button", { name: "Live", exact: true }).click();
    await expect(page.getByRole("list", { name: "Live logs, Live" })).toContainText(/GET \/|agent /);
  });
});
