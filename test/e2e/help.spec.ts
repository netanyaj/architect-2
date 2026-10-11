import { expect, test } from "@playwright/test";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

test.describe("Help", () => {
  let user: TestUser;
  test.beforeAll(async () => {
    user = await createTestUser("help");
  });
  test.afterAll(async () => {
    if (user) {
      await adminDb().from("support_tickets").delete().eq("user_id", user.id);
      await deleteTestUser(user);
    }
  });

  test("opens with what's stuck, answers through the gateway, and Talk to a person makes a ticket", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/home$/);
    await page.waitForLoadState("networkidle");

    // Outside projects, Help is the launcher at the bottom-right (M5.5 review).
    await page.getByRole("button", { name: "Help", exact: true }).click();
    const help = page.getByRole("dialog", { name: "Help with Architect" });
    await expect(help).toBeVisible();
    await expect(help.getByText(/Lead scorer.*is blocked at its budget/)).toBeVisible();
    await expect(help.getByText("Simulated").first()).toBeVisible(); // Talk to a person is labelled

    // A real answer from Gemini, grounded in the workspace (mentions the budget).
    await help.getByRole("button", { name: "Why did Lead scorer stop?" }).click();
    const answer = help.locator("div.whitespace-pre-wrap").last();
    await expect(answer).toBeVisible({ timeout: 45_000 });
    // A grounded answer (it mentions the budget) — or, when the free model's limit is used up, the plain
    // "busy" message the app is meant to show. Never a crash or an empty reply.
    const text = await answer.innerText();
    if (/Help is busy right now/.test(text)) test.info().annotations.push({ type: "note", description: "Gemini rate-limited; checked the busy message instead" });
    else expect(text).toMatch(/budget/i);
    await expect(answer).not.toContainText(/can't answer right now/);

    await help.getByRole("button", { name: "Talk to a person" }).click();
    await expect(help.getByRole("status")).toContainText(/Ticket #\d+ is open/);
    const { data: tickets } = await adminDb().from("support_tickets").select("question, transcript").eq("user_id", user.id);
    expect(tickets).toHaveLength(1);
    expect(tickets![0].question).toBe("Why did Lead scorer stop?");
    expect((tickets![0].transcript as unknown[]).length).toBe(2);

    // Esc closes it.
    await page.keyboard.press("Escape");
    await expect(help).toBeHidden();
  });
});
