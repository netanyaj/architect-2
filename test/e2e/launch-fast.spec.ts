import { expect, test, type Page } from "@playwright/test";
import { seedPlan, signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

/* Launch without governance (from the launch flow review): Test → Go live, a failed deploy and its
   retry, the success state, who can open it, a custom domain, the Marketplace listing and the view-only test link. */

const stepper = (page: Page) => page.getByRole("navigation", { name: "Project stage" });

test.describe("M3: Launch, fast path and options", () => {
  test.setTimeout(240_000);
  let user: TestUser;

  test.beforeAll(async () => {
    user = await createTestUser("shipper");
  });
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });

  test("governance off: Test → Go live, a failure keeps nothing broken, then live with options", async ({ page, browser }) => {
    await signIn(page, user);
    // Settings: turn governance off for this workspace.
    await page.goto("/settings");
    const toggle = page.getByRole("switch", { name: "Approvals and a team version before Live" });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    const id = await seedPlan(user, "Fast Prep");
    await page.goto(`/p/${id}?sim=fast`);
    await page.getByRole("button", { name: /^Build · ~\d+ credits$/ }).click();
    await expect(page.getByText(/^(Build finished|The change is built)\./).first()).toBeVisible({ timeout: 90_000 });

    // ?sim=deployfail: the health check fails; nothing was live before, so nothing broke.
    await page.goto(`/p/${id}/launch?sim=deployfail`);
    await expect(page.getByText("Optional", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Connect Gmail" }).click();
    await page.getByRole("dialog", { name: "Connect Gmail" }).getByRole("button", { name: "Allow" }).click();
    await expect(page.getByRole("dialog", { name: "Connect Gmail" })).toHaveCount(0);
    await expect(stepper(page)).toContainText("ready to go live");
    await page.getByRole("button", { name: "Go live", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Going live failed at the health check" })).toBeVisible();
    await expect(stepper(page)).toContainText("deploy failed");

    // Try again (no failure this time): the success state.
    await page.goto(`/p/${id}/launch`);
    await page.getByRole("button", { name: "Go live", exact: true }).click();
    await expect(page.getByRole("status", { name: "It's live" })).toContainText("v1 is live");
    await expect(page.getByText(/About \d+ credits a month \(estimate\)/)).toBeVisible();
    const db = adminDb();
    const { data: deps } = await db.from("deployments").select("environment, status").eq("project_id", id).order("created_at");
    expect(deps).toEqual([
      { environment: "production", status: "failed" },
      { environment: "production", status: "live" },
    ]);

    // Who can open it.
    await page.getByRole("radio", { name: /Invited people only/ }).click();
    await expect(page.getByRole("radio", { name: /Invited people only/ })).toHaveAttribute("aria-checked", "true");

    // A custom domain: enter → record → checking → secured.
    await page.getByRole("button", { name: "Use your own domain" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Web address").fill("prep.example.com");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByText("cname.architect.app")).toBeVisible();
    await dialog.getByRole("button", { name: /I've added it/ }).click();
    await expect(dialog.getByText(/Secured · HTTPS on/)).toBeVisible({ timeout: 20_000 });
    await dialog.getByRole("button", { name: "Done" }).click();

    // Marketplace: Public Agentlets with today's form.
    const market = page.getByRole("region", { name: "Marketplace" });
    await market.getByRole("button", { name: "Public Agentlets" }).click();
    await market.getByLabel(/Short description/).fill("Briefs before every meeting");
    await market.getByLabel("Description", { exact: true }).fill("A Slack brief before each meeting, with email context and talking points.");
    await market.getByLabel(/Tags/).fill("meetings, sales");
    await market.getByRole("button", { name: "List in Public Agentlets" }).click();
    await expect(market.getByText("Listed in Public Agentlets")).toBeVisible();
    const { data: p } = await db.from("projects").select("launch_settings").eq("id", id).single();
    expect(p!.launch_settings).toMatchObject({ access: "invited", domains: { production: { name: "prep.example.com", status: "secured" } }, listing: { scope: "public", tags: ["meetings", "sales"] } });

    // The view-only test link works signed out, with the sample-data banner, and stops when sharing stops.
    await page.getByRole("button", { name: "Share test link" }).click();
    const link = page.getByRole("link", { name: "View-only link shared" });
    const href = await link.getAttribute("href");
    const guest = await browser.newContext();
    const g = await guest.newPage();
    await g.goto(href!);
    await expect(g.getByText("Test version · view only")).toBeVisible();
    await page.getByRole("button", { name: "Stop sharing" }).click();
    await expect(page.getByRole("button", { name: "Share test link" })).toBeVisible();
    const gone = await g.goto(href!);
    expect(gone!.status()).toBe(404);
    await guest.close();
  });
});
